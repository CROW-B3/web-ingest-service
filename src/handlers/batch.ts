import { eq } from 'drizzle-orm';
import { createDatabaseClient, generateId } from '../db/client';
import { events, projects, sessions, users } from '../db/schema';
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

async function findUserByAnonymousId(database: any, anonymousId: string) {
  return database
    .select()
    .from(users)
    .where(eq(users.anonymousId, anonymousId))
    .get();
}

async function createNewUser(
  database: any,
  projectId: string,
  anonymousId: string
): Promise<string> {
  const userId = generateId('user');
  await database
    .insert(users)
    .values({
      id: userId,
      projectId,
      anonymousId,
    })
    .run();
  return userId;
}

async function getUserIdOrCreateUser(
  database: any,
  projectId: string,
  userAnonymousId: string | undefined
): Promise<string | null> {
  if (!userAnonymousId) {
    return null;
  }

  const existingUser = await findUserByAnonymousId(database, userAnonymousId);

  if (existingUser) {
    return existingUser.id;
  }

  return createNewUser(database, projectId, userAnonymousId);
}

async function insertSingleBatchEvent(
  database: any,
  projectId: string,
  sessionId: string,
  userId: string | null,
  anonymousId: string,
  eventData: any
): Promise<void> {
  const eventId = generateId('evt');
  await database
    .insert(events)
    .values({
      id: eventId,
      projectId,
      sessionId,
      userId,
      anonymousId,
      type: eventData.type,
      url: eventData.url,
      timestamp: new Date(eventData.timestamp),
      data: eventData.data,
    })
    .run();
}

async function processSingleBatchEvent(
  database: any,
  projectId: string,
  sessionId: string,
  userId: string | null,
  anonymousId: string,
  eventData: any,
  eventIndex: number
): Promise<BatchEventError | null> {
  try {
    await insertSingleBatchEvent(
      database,
      projectId,
      sessionId,
      userId,
      anonymousId,
      eventData
    );
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
  projectId: string,
  sessionId: string,
  userId: string | null,
  anonymousId: string,
  eventsList: any[]
): Promise<BatchProcessingResult> {
  const processingPromises = eventsList.map((event, index) =>
    processSingleBatchEvent(
      database,
      projectId,
      sessionId,
      userId,
      anonymousId,
      event,
      index
    )
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
        projectId: validatedData.projectId,
        eventCount: validatedData.events.length,
      },
      'Batch event request'
    );

    const database = createDatabaseClient(environment.DB);

    const project = await findProjectByApiKey(
      database,
      validatedData.projectId
    );

    if (!project) {
      logger.warn({ projectId: validatedData.projectId }, 'Invalid project ID');
      return createErrorResponse('Invalid project ID', 401);
    }

    const session = await findSessionById(database, validatedData.sessionId);

    if (!session) {
      logger.warn({ sessionId: validatedData.sessionId }, 'Session not found');
      return createErrorResponse(
        'Session not found. Please start a session first.',
        404
      );
    }

    const userId = await getUserIdOrCreateUser(
      database,
      project.id,
      validatedData.user?.anonymousId
    );

    const anonymousId = validatedData.user?.anonymousId || 'unknown';

    const processingResult = await processBatchEvents(
      database,
      project.id,
      validatedData.sessionId,
      userId,
      anonymousId,
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
