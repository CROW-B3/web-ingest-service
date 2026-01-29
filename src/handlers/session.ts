import { eq } from 'drizzle-orm';
import { createDatabaseClient, generateId } from '../db/client';
import { projects, sessions, users } from '../db/schema';
import { corsHeaders } from '../middleware/cors';
import { logger } from '../utils/logger';
import {
  sessionEndRequestSchema,
  sessionStartRequestSchema,
} from '../validation/schemas';

const defaultSessionDurationInMinutes = 30;
const millisecondsPerMinute = 60 * 1000;

function parseDeviceTypeFromUserAgent(userAgent: string): string {
  if (/mobile/i.test(userAgent)) return 'mobile';
  if (/tablet/i.test(userAgent)) return 'tablet';
  return 'desktop';
}

function parseBrowserFromUserAgent(userAgent: string): string {
  if (/chrome/i.test(userAgent)) return 'Chrome';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  if (/edge/i.test(userAgent)) return 'Edge';
  return 'Unknown';
}

function parseOperatingSystemFromUserAgent(userAgent: string): string {
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  if (/android/i.test(userAgent)) return 'Android';
  if (/ios/i.test(userAgent)) return 'iOS';
  return 'Unknown';
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

function createSessionStartSuccessResponse(
  sessionId: string,
  expiresAt: number
): Response {
  return new Response(
    JSON.stringify({
      success: true,
      sessionId,
      expiresAt,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

function createSessionEndSuccessResponse(): Response {
  return new Response(
    JSON.stringify({
      success: true,
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

async function findUserByAnonymousId(database: any, anonymousId: string) {
  return database
    .select()
    .from(users)
    .where(eq(users.anonymousId, anonymousId))
    .get();
}

async function incrementUserSessionCount(
  database: any,
  userId: string,
  currentSessionCount: number
): Promise<void> {
  await database
    .update(users)
    .set({
      sessionCount: currentSessionCount + 1,
    })
    .where(eq(users.id, userId))
    .run();
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
      sessionCount: 1,
    })
    .run();
  return userId;
}

async function getUserIdOrCreateUser(
  database: any,
  projectId: string,
  userAnonymousId: string
): Promise<string> {
  const existingUser = await findUserByAnonymousId(database, userAnonymousId);

  if (existingUser) {
    await incrementUserSessionCount(
      database,
      existingUser.id,
      existingUser.sessionCount
    );
    return existingUser.id;
  }

  return createNewUser(database, projectId, userAnonymousId);
}

function extractIpAddressFromRequest(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function extractCountryFromRequest(request: Request): string | undefined {
  return request.headers.get('CF-IPCountry') || undefined;
}

function calculateSessionExpirationTime(): number {
  return Date.now() + defaultSessionDurationInMinutes * millisecondsPerMinute;
}

async function insertNewSession(
  database: any,
  sessionData: {
    sessionId: string;
    projectId: string;
    userId: string;
    anonymousId: string;
    initialUrl: string;
    referrer: string | undefined;
    userAgent: string;
    ipAddress: string;
    country: string | undefined;
    deviceType: string;
    browser: string;
    operatingSystem: string;
  }
): Promise<void> {
  await database
    .insert(sessions)
    .values({
      id: sessionData.sessionId,
      projectId: sessionData.projectId,
      userId: sessionData.userId,
      anonymousId: sessionData.anonymousId,
      initialUrl: sessionData.initialUrl,
      referrer: sessionData.referrer,
      userAgent: sessionData.userAgent,
      ipAddress: sessionData.ipAddress,
      country: sessionData.country,
      deviceType: sessionData.deviceType,
      browser: sessionData.browser,
      operatingSystem: sessionData.operatingSystem,
    })
    .run();
}

async function updateSessionEndData(
  database: any,
  sessionId: string,
  durationInMilliseconds: number
): Promise<void> {
  await database
    .update(sessions)
    .set({
      endedAt: new Date(),
      durationInMilliseconds,
    })
    .where(eq(sessions.id, sessionId))
    .run();
}

export async function handleSessionStart(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const requestBody = await request.json();
    const validatedData = sessionStartRequestSchema.parse(requestBody);

    logger.info(
      {
        projectId: validatedData.projectId,
        sessionId: validatedData.sessionId,
      },
      'Session start request'
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

    const userId = await getUserIdOrCreateUser(
      database,
      project.id,
      validatedData.user.anonymousId
    );

    const userAgent = validatedData.context.userAgent;
    const deviceType = parseDeviceTypeFromUserAgent(userAgent);
    const browser = parseBrowserFromUserAgent(userAgent);
    const operatingSystem = parseOperatingSystemFromUserAgent(userAgent);

    const ipAddress = extractIpAddressFromRequest(request);
    const country = extractCountryFromRequest(request);

    await insertNewSession(database, {
      sessionId: validatedData.sessionId,
      projectId: project.id,
      userId: validatedData.user.id || userId,
      anonymousId: validatedData.user.anonymousId,
      initialUrl: validatedData.context.url,
      referrer: validatedData.context.referrer,
      userAgent,
      ipAddress,
      country,
      deviceType,
      browser,
      operatingSystem,
    });

    const expiresAt = calculateSessionExpirationTime();

    logger.info({ sessionId: validatedData.sessionId }, 'Session started');

    return createSessionStartSuccessResponse(
      validatedData.sessionId,
      expiresAt
    );
  } catch (error) {
    logger.error({ error }, 'Error starting session');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}

export async function handleSessionEnd(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const requestBody = await request.json();
    const validatedData = sessionEndRequestSchema.parse(requestBody);

    logger.info(
      {
        projectId: validatedData.projectId,
        sessionId: validatedData.sessionId,
      },
      'Session end request'
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

    await updateSessionEndData(
      database,
      validatedData.sessionId,
      validatedData.duration
    );

    logger.info({ sessionId: validatedData.sessionId }, 'Session ended');

    return createSessionEndSuccessResponse();
  } catch (error) {
    logger.error({ error }, 'Error ending session');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
