import { createDatabaseClient, generateId } from '../db/client';
import { events, sessions } from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';
import { trackRequestSchema } from '../validation/schemas';

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

function createSuccessResponse(eventId: string): Response {
  return new Response(
    JSON.stringify({
      success: true,
      eventId,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

async function insertTrackingEvent(
  database: any,
  sessionId: string,
  eventData: any
): Promise<string> {
  const eventId = generateId('evt');
  await database
    .insert(events)
    .values({
      id: eventId,
      sessionId,
      type: eventData.type,
      url: eventData.url,
      timestamp: new Date(eventData.timestamp),
      data: eventData.data || {},
    })
    .run();
  return eventId;
}

export async function handleTrack(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const requestBody = await request.json();
    const validatedData = trackRequestSchema.parse(requestBody);

    logger.info({ sessionId: validatedData.sessionId }, 'Track event request');

    const database = createDatabaseClient(environment.DB);

    // Get or create session via Durable Object
    const doNamespace = environment.CROW_WEB_SESSION;
    const doStub = doNamespace.getByName(validatedData.sessionId);

    try {
      await doStub.updateSessionActivity(validatedData.sessionId);
    } catch (error) {
      logger.error(
        { sessionId: validatedData.sessionId, error },
        'Failed to update session activity in DO'
      );
      // Continue with event tracking even if DO fails
    }

    // Ensure session exists in database for foreign key constraint
    try {
      await database
        .insert(sessions)
        .values({ id: validatedData.sessionId })
        .onConflictDoNothing()
        .run();
    } catch (error) {
      logger.error(
        { sessionId: validatedData.sessionId, error },
        'Failed to ensure session exists in database'
      );
      // Continue with event tracking even if session creation fails
    }

    const eventId = await insertTrackingEvent(
      database,
      validatedData.sessionId,
      validatedData.event
    );

    logger.info({ eventId, type: validatedData.event.type }, 'Event tracked');

    return createSuccessResponse(eventId);
  } catch (error) {
    logger.error({ error }, 'Error tracking event');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
