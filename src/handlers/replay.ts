import type { DatabaseClient } from '../db/client';
import { createDatabaseClient, generateId } from '../db/client';
import { replayChunks } from '../db/schema';
import {
  findSessionById,
  markSessionHasReplay,
} from '../repositories/session-repository';
import { getSessionStub } from '../utils/durable-object';
import { logger } from '../utils/logger';
import {
  createErrorResponse,
  createSuccessResponse,
  createValidationErrorResponse,
} from '../utils/responses';
import { replayBatchRequestSchema } from '../validation/schemas';

const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15MB — rrweb DOM snapshots can be large

function isPayloadTooLarge(request: Request): boolean {
  const contentLength = request.headers.get('content-length');
  return Boolean(
    contentLength && Number.parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES
  );
}

function buildR2Key(sessionId: string, chunkIndex: number): string {
  return `replay/${sessionId}/chunk_${chunkIndex}.json`;
}

async function storeReplayChunkInR2(
  r2Bucket: R2Bucket,
  r2Key: string,
  replayEvents: unknown[]
): Promise<number> {
  const json = JSON.stringify(replayEvents);
  const encoded = new TextEncoder().encode(json);
  await r2Bucket.put(r2Key, encoded, {
    httpMetadata: { contentType: 'application/json' },
  });
  return encoded.byteLength;
}

function getTimestampRange(replayEvents: any[]): {
  startTimestamp: number;
  endTimestamp: number;
} {
  let startTimestamp = Infinity;
  let endTimestamp = -Infinity;

  for (const event of replayEvents) {
    const ts = event.timestamp ?? 0;
    if (ts < startTimestamp) startTimestamp = ts;
    if (ts > endTimestamp) endTimestamp = ts;
  }

  if (startTimestamp === Infinity) startTimestamp = Date.now();
  if (endTimestamp === -Infinity) endTimestamp = Date.now();

  return { startTimestamp, endTimestamp };
}

// Stores replay events to R2 and records metadata in the database
async function storeAndRecordReplayChunk(
  database: DatabaseClient,
  r2Bucket: R2Bucket,
  sessionId: string,
  chunkIndex: number,
  replayEvents: unknown[]
): Promise<string> {
  const r2Key = buildR2Key(sessionId, chunkIndex);
  const sizeBytes = await storeReplayChunkInR2(r2Bucket, r2Key, replayEvents);
  const { startTimestamp, endTimestamp } = getTimestampRange(replayEvents);

  const chunkId = generateId('rchk');
  await database
    .insert(replayChunks)
    .values({
      id: chunkId,
      sessionId,
      chunkIndex,
      r2Key,
      eventCount: replayEvents.length,
      sizeBytes,
      startTimestamp,
      endTimestamp,
    })
    .run();

  if (chunkIndex === 0) {
    await markSessionHasReplay(database, sessionId);
  }

  logger.info({ chunkId, r2Key, sizeBytes }, 'Replay chunk stored');

  return chunkId;
}

export async function handleReplayBatch(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    if (isPayloadTooLarge(request)) {
      return createErrorResponse('Payload too large. Maximum 15MB.', 413);
    }

    const requestBody = await request.json();
    const validatedData = replayBatchRequestSchema.parse(requestBody);

    logger.info(
      {
        sessionId: validatedData.sessionId,
        chunkIndex: validatedData.chunkIndex,
        eventCount: validatedData.events.length,
      },
      'Replay batch request'
    );

    const database = createDatabaseClient(environment.DB);

    const session = await findSessionById(database, validatedData.sessionId);

    if (!session) {
      logger.warn({ sessionId: validatedData.sessionId }, 'Session not found');
      return createErrorResponse(
        'Session not found. Please start a session first.',
        404
      );
    }

    const stub = getSessionStub(environment, validatedData.sessionId);
    await stub.extendSession();

    const chunkId = await storeAndRecordReplayChunk(
      database,
      environment.R2_BUCKET,
      validatedData.sessionId,
      validatedData.chunkIndex,
      validatedData.events
    );

    return createSuccessResponse({ chunkId });
  } catch (error) {
    logger.error({ error }, 'Error processing replay batch');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
