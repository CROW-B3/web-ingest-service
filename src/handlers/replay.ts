import { eq } from 'drizzle-orm';
import { createDatabaseClient, generateId } from '../db/client';
import { projects, replayChunks, sessions } from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';
import { replayBatchRequestSchema } from '../validation/schemas';

const FIVE_MEGABYTES = 5 * 1024 * 1024;

function createErrorResponse(
  errorMessage: string,
  statusCode: number
): Response {
  return new Response(
    JSON.stringify({ success: false, errors: [errorMessage] }),
    {
      status: statusCode,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

function createValidationErrorResponse(validationErrors: any): Response {
  return new Response(
    JSON.stringify({
      success: false,
      errors: [validationErrors],
    }),
    {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

function createSuccessResponse(chunkId: string): Response {
  return new Response(
    JSON.stringify({
      success: true,
      chunkId,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

async function findProjectByApiKey(database: any, apiKey: string) {
  return database
    .select()
    .from(projects)
    .where(eq(projects.apiKey, apiKey))
    .get();
}

async function findSessionById(database: any, sessionId: string) {
  return database
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
}

function buildR2Key(
  projectId: string,
  sessionId: string,
  chunkIndex: number
): string {
  return `replay/${projectId}/${sessionId}/chunk_${chunkIndex}.json`;
}

async function storeReplayChunkInR2(
  r2Bucket: R2Bucket,
  r2Key: string,
  events: any[]
): Promise<number> {
  const json = JSON.stringify(events);
  const encoded = new TextEncoder().encode(json);
  await r2Bucket.put(r2Key, encoded, {
    httpMetadata: { contentType: 'application/json' },
  });
  return encoded.byteLength;
}

function getTimestampRange(events: any[]): {
  startTimestamp: number;
  endTimestamp: number;
} {
  let startTimestamp = Infinity;
  let endTimestamp = -Infinity;

  for (const event of events) {
    const ts = event.timestamp ?? 0;
    if (ts < startTimestamp) startTimestamp = ts;
    if (ts > endTimestamp) endTimestamp = ts;
  }

  if (startTimestamp === Infinity) startTimestamp = Date.now();
  if (endTimestamp === -Infinity) endTimestamp = Date.now();

  return { startTimestamp, endTimestamp };
}

async function markSessionHasReplay(
  database: any,
  sessionId: string
): Promise<void> {
  await database
    .update(sessions)
    .set({ hasReplay: true })
    .where(eq(sessions.id, sessionId))
    .run();
}

export async function handleReplayBatch(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > FIVE_MEGABYTES) {
      return createErrorResponse('Payload too large. Maximum 5MB.', 413);
    }

    const requestBody = await request.json();
    const validatedData = replayBatchRequestSchema.parse(requestBody);

    logger.info(
      {
        projectId: validatedData.projectId,
        sessionId: validatedData.sessionId,
        chunkIndex: validatedData.chunkIndex,
        eventCount: validatedData.events.length,
      },
      'Replay batch request'
    );

    const database = createDatabaseClient(environment.DB);

    const project = await findProjectByApiKey(
      database,
      validatedData.projectId
    );

    if (!project) {
      logger.warn(
        { projectId: validatedData.projectId },
        'Invalid project ID'
      );
      return createErrorResponse('Invalid project ID', 401);
    }

    const session = await findSessionById(database, validatedData.sessionId);

    if (!session) {
      logger.warn(
        { sessionId: validatedData.sessionId },
        'Session not found'
      );
      return createErrorResponse(
        'Session not found. Please start a session first.',
        404
      );
    }

    const r2Key = buildR2Key(
      project.id,
      validatedData.sessionId,
      validatedData.chunkIndex
    );

    const sizeBytes = await storeReplayChunkInR2(
      environment.R2_BUCKET,
      r2Key,
      validatedData.events
    );

    const { startTimestamp, endTimestamp } = getTimestampRange(
      validatedData.events
    );

    const chunkId = generateId('rchk');
    await database
      .insert(replayChunks)
      .values({
        id: chunkId,
        projectId: project.id,
        sessionId: validatedData.sessionId,
        chunkIndex: validatedData.chunkIndex,
        r2Key,
        eventCount: validatedData.events.length,
        sizeBytes,
        startTimestamp,
        endTimestamp,
      })
      .run();

    if (validatedData.chunkIndex === 0) {
      await markSessionHasReplay(database, validatedData.sessionId);
    }

    logger.info(
      { chunkId, r2Key, sizeBytes },
      'Replay chunk stored'
    );

    return createSuccessResponse(chunkId);
  } catch (error) {
    logger.error({ error }, 'Error processing replay batch');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
