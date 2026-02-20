import { createDatabaseClient } from '../db/client';
import { insertTrackingEvent } from '../repositories/event-repository';
import { findProjectByApiKey } from '../repositories/project-repository';
import { findSessionById } from '../repositories/session-repository';
import { resolveUserId } from '../repositories/user-repository';
import { logger } from '../utils/logger';
import {
  createErrorResponse,
  createSuccessResponse,
  createValidationErrorResponse,
} from '../utils/responses';
import { trackRequestSchema } from '../validation/schemas';

export async function handleTrack(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const requestBody = await request.json();
    const validatedData = trackRequestSchema.parse(requestBody);

    logger.info({ projectId: validatedData.projectId }, 'Track event request');

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

    const userId = await resolveUserId(
      database,
      project.id,
      validatedData.user?.anonymousId
    );

    const eventId = await insertTrackingEvent(
      database,
      project.id,
      validatedData.sessionId,
      userId,
      validatedData.user?.anonymousId || 'unknown',
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
