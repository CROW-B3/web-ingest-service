import { eq } from 'drizzle-orm';
import { createDatabaseClient, generateId } from '../db/client';
import { events, projects, sessions, users } from '../db/schema';
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

async function insertTrackingEvent(
  database: any,
  projectId: string,
  sessionId: string,
  userId: string | null,
  anonymousId: string,
  eventData: any
): Promise<string> {
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

    const userId = await getUserIdOrCreateUser(
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

    return createSuccessResponse(eventId);
  } catch (error) {
    logger.error({ error }, 'Error tracking event');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
