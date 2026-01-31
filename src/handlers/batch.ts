import { createDatabaseClient, generateId } from '../db/client';
import { events } from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';
import {
  validateBatchSize,
  validateRequestSize,
} from '../utils/payload-limits';
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

function createPayloadTooLargeResponse(errors: string[]): Response {
  return new Response(
    JSON.stringify({
      success: false,
      errors,
    }),
    {
      status: 413,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

function createBatchSuccessResponse(result: BatchProcessingResult): Response {
  const responseBody: any = {
    success: result.failed === 0,
    processed: result.processed,
    failed: result.failed,
  };

  if (result.errors.length > 0) {
    responseBody.errors = result.errors;
  }

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

async function insertSingleBatchEvent(
  database: any,
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
      timestamp: new Date(eventData.timestamp),
      data: eventData.data,
    })
    .run();
}

async function processSingleBatchEvent(
  database: any,
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
  database: any,
  sessionId: string,
  eventsList: any[]
): Promise<BatchProcessingResult> {
  const processingPromises = eventsList.map((event, index) =>
    processSingleBatchEvent(database, sessionId, event, index)
  );

  const results = await Promise.all(processingPromises);

  const errors = results.filter(
    (result): result is BatchEventError => result !== null
  );
  const processed = results.length - errors.length;
  const failed = errors.length;

  return { processed, failed, errors };
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
        {
          errors: requestSizeValidation.errors,
        },
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

    // Get or create session via Durable Object
    const doNamespace = environment.CROW_WEB_SESSION;
    const doStub = doNamespace.get(validatedData.sessionId);

    try {
      await doStub.updateSessionActivity(validatedData.sessionId);
    } catch (error) {
      logger.error(
        { sessionId: validatedData.sessionId, error },
        'Failed to update session activity in DO'
      );
      // Continue with event processing even if DO fails
    }

    const processingResult = await processBatchEvents(
      database,
      validatedData.sessionId,
      validatedData.events
    );

    logger.info(
      {
        processed: processingResult.processed,
        failed: processingResult.failed,
      },
      'Batch processing complete'
    );

    return createBatchSuccessResponse(processingResult);
  } catch (error) {
    logger.error({ error }, 'Error processing batch');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
