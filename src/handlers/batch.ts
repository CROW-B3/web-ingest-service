import type { DatabaseClient } from '../db/client';
import { createDatabaseClient, generateId } from '../db/client';
import { events } from '../db/schema';
import { findSessionById } from '../repositories/session-repository';
import { getSessionStub } from '../utils/durable-object';
import { logger } from '../utils/logger';
import {
  validateBatchSize,
  validateRequestSize,
} from '../utils/payload-limits';
import {
  createErrorResponse,
  createPayloadTooLargeResponse,
  createSuccessResponse,
  createValidationErrorResponse,
} from '../utils/responses';
import { shouldStoreEvent } from '../validation/event-filters';
import { batchRequestSchema } from '../validation/schemas';

interface BatchEventError {
  index: number;
  error: string;
}

interface BatchProcessingResult {
  processed: number;
  failed: number;
  errors: BatchEventError[];
}

async function insertSingleBatchEvent(
  database: DatabaseClient,
  sessionId: string,
  eventData: any
): Promise<void> {
  const eventId = generateId('evt');
  await database
    .insert(events)
    .values({
      id: eventId,
      sessionId,
      type: eventData.type,
      url: eventData.url,
      timestamp: eventData.timestamp,
      data: eventData.data,
    })
    .run();
}

async function processSingleBatchEvent(
  database: DatabaseClient,
  sessionId: string,
  eventData: any,
  eventIndex: number
): Promise<BatchEventError | null> {
  try {
    await insertSingleBatchEvent(database, sessionId, eventData);
    return null;
  } catch (error) {
    logger.error(
      { error, index: eventIndex },
      'Error processing event in batch'
    );
    return {
      index: eventIndex,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

async function processBatchEvents(
  database: DatabaseClient,
  sessionId: string,
  eventsList: any[],
  gatedEventsEnabled: boolean
): Promise<BatchProcessingResult> {
  const storableEvents = eventsList.filter(e =>
    shouldStoreEvent(e.type, gatedEventsEnabled)
  );
  const skippedCount = eventsList.length - storableEvents.length;

  const processingPromises = storableEvents.map((event, index) =>
    processSingleBatchEvent(database, sessionId, event, index)
  );

  const results = await Promise.all(processingPromises);
  const errors = results.filter(
    (result): result is BatchEventError => result !== null
  );

  return {
    processed: results.length - errors.length + skippedCount,
    failed: errors.length,
    errors,
  };
}

function buildBatchSuccessPayload(
  result: BatchProcessingResult
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    success: result.failed === 0,
    processed: result.processed,
    failed: result.failed,
  };

  if (result.errors.length > 0) {
    payload.errors = result.errors;
  }

  return payload;
}

export async function handleBatch(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const requestBody = await request.json();

    const requestSizeValidation = validateRequestSize(requestBody);
    if (!requestSizeValidation.isValid) {
      logger.warn(
        { errors: requestSizeValidation.errors },
        'Request size validation failed'
      );
      return createPayloadTooLargeResponse(requestSizeValidation.errors);
    }

    const validatedData = batchRequestSchema.parse(requestBody);

    const batchSizeValidation = validateBatchSize(validatedData.events.length);
    if (!batchSizeValidation.isValid) {
      logger.warn(
        {
          eventCount: validatedData.events.length,
          errors: batchSizeValidation.errors,
        },
        'Batch size validation failed'
      );
      return createPayloadTooLargeResponse(batchSizeValidation.errors);
    }

    logger.info(
      {
        sessionId: validatedData.sessionId,
        eventCount: validatedData.events.length,
      },
      'Batch event request'
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

    const gatedEventsEnabled = environment.ENABLE_GATED_EVENTS === 'true';
    const processingResult = await processBatchEvents(
      database,
      validatedData.sessionId,
      validatedData.events,
      gatedEventsEnabled
    );

    logger.info(
      {
        processed: processingResult.processed,
        failed: processingResult.failed,
      },
      'Batch processing complete'
    );

    return createSuccessResponse(buildBatchSuccessPayload(processingResult));
  } catch (error) {
    logger.error({ error }, 'Error processing batch');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
