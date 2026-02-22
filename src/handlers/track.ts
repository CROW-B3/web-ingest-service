import { createDatabaseClient } from '../db/client';
import { insertTrackingEvent } from '../repositories/event-repository';
import { findSessionById } from '../repositories/session-repository';
import { getSessionStub } from '../utils/durable-object';
import { logger } from '../utils/logger';
import {
  createErrorResponse,
  createSuccessResponse,
  createValidationErrorResponse,
} from '../utils/responses';
import { shouldStoreEvent } from '../validation/event-filters';
import { trackRequestSchema } from '../validation/schemas';

export async function handleTrack(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const requestBody = await request.json();
    const validatedData = trackRequestSchema.parse(requestBody);

    logger.info({ sessionId: validatedData.sessionId }, 'Track event request');

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

    if (!shouldStoreEvent(validatedData.event.type)) {
      return createSuccessResponse({ eventId: null, skipped: true });
    }

    const eventId = await insertTrackingEvent(
      database,
      validatedData.sessionId,
      validatedData.event
    );

    logger.info({ eventId, type: validatedData.event.type }, 'Event tracked');

    return createSuccessResponse({ eventId });
  } catch (error) {
    logger.error({ error }, 'Error tracking event');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
