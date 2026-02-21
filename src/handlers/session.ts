import { createDatabaseClient } from '../db/client';
import {
  insertNewSession,
  updateSessionEndData,
} from '../repositories/session-repository';
import { logger } from '../utils/logger';
import {
  createErrorResponse,
  createSuccessResponse,
  createValidationErrorResponse,
} from '../utils/responses';
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

function extractIpAddressFromRequest(request: Request): string {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

function extractCountryFromRequest(request: Request): string | undefined {
  return request.headers.get('CF-IPCountry') || undefined;
}

function calculateSessionExpirationTime(): number {
  return Date.now() + defaultSessionDurationInMinutes * millisecondsPerMinute;
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
        sessionId: validatedData.sessionId,
      },
      'Session start request'
    );

    const database = createDatabaseClient(environment.DB);

    const userAgent = validatedData.context.userAgent;

    await insertNewSession(database, {
      sessionId: validatedData.sessionId,
      initialUrl: validatedData.context.url,
      referrer: validatedData.context.referrer,
      userAgent,
      ipAddress: extractIpAddressFromRequest(request),
      country: extractCountryFromRequest(request),
      deviceType: parseDeviceTypeFromUserAgent(userAgent),
      browser: parseBrowserFromUserAgent(userAgent),
      operatingSystem: parseOperatingSystemFromUserAgent(userAgent),
    });

    const expiresAt = calculateSessionExpirationTime();

    logger.info({ sessionId: validatedData.sessionId }, 'Session started');

    return createSuccessResponse({
      sessionId: validatedData.sessionId,
      expiresAt,
    });
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
        sessionId: validatedData.sessionId,
      },
      'Session end request'
    );

    const database = createDatabaseClient(environment.DB);

    await updateSessionEndData(
      database,
      validatedData.sessionId,
      validatedData.duration,
      validatedData.exitContext
    );

    logger.info({ sessionId: validatedData.sessionId }, 'Session ended');

    return createSuccessResponse({});
  } catch (error) {
    logger.error({ error }, 'Error ending session');

    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }

    return createErrorResponse('Internal server error', 500);
  }
}
