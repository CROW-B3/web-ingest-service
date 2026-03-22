import type { SessionStorageData } from '../index';
import { createDatabaseClient } from '../db/client';
import {
  findSessionById,
  insertNewSession,
  updateSessionEndData,
} from '../repositories/session-repository';
import { notifyCoreInteractionService } from '../utils/core-service';
import { getSessionStub } from '../utils/durable-object';
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

async function resolveOrgFromApiKey(request: Request, env: Env): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer crow_')) return null;
  const apiKey = authHeader.slice(7).trim();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (env.SERVICE_API_KEY) headers['X-Service-API-Key'] = env.SERVICE_API_KEY;

    const authBinding = (env as any).AUTH_SERVICE as { fetch: typeof fetch } | undefined;

    let res: Response;
    if (authBinding) {
      res = await authBinding.fetch(
        new Request('https://auth-service/api/v1/auth/api-key/verify', {
          method: 'POST',
          headers,
          body: JSON.stringify({ key: apiKey }),
        })
      );
    } else {
      // Fallback to GATEWAY_URL when AUTH_SERVICE binding is not available
      const gatewayUrl = env.GATEWAY_URL ?? 'https://dev.internal.auth-api.crowai.dev';
      res = await fetch(`${gatewayUrl}/api/v1/auth/api-key/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ key: apiKey }),
      });
    }

    if (!res.ok) return null;
    const data = (await res.json()) as { key?: { metadata?: { organizationId?: string } } };
    return data?.key?.metadata?.organizationId ?? null;
  } catch {
    return null;
  }
}

export async function handleSessionStart(
  request: Request,
  environment: Env
): Promise<Response> {
  try {
    const requestBody = await request.json();
    const validatedData = sessionStartRequestSchema.parse(requestBody);

    const resolvedOrgId = validatedData.projectId || await resolveOrgFromApiKey(request, environment) || undefined;

    logger.info(
      {
        sessionId: validatedData.sessionId,
        organizationId: resolvedOrgId,
      },
      'Session start request'
    );

    const database = createDatabaseClient(environment.DB);

    const userAgent = validatedData.context.userAgent;

    const deviceType = parseDeviceTypeFromUserAgent(userAgent);
    const browser = parseBrowserFromUserAgent(userAgent);
    const operatingSystem = parseOperatingSystemFromUserAgent(userAgent);

    try {
      await insertNewSession(database, {
        sessionId: validatedData.sessionId,
        initialUrl: validatedData.context.url,
        referrer: validatedData.context.referrer,
        userAgent,
        ipAddress: extractIpAddressFromRequest(request),
        country: extractCountryFromRequest(request),
        deviceType,
        browser,
        operatingSystem,
        projectId: resolvedOrgId,
      });
    } catch (insertError) {
      // Handle duplicate session ID (UNIQUE constraint violation)
      const errorMessage = insertError instanceof Error ? insertError.message : String(insertError);
      if (errorMessage.includes('UNIQUE') || errorMessage.includes('duplicate') || errorMessage.includes('already exists')) {
        logger.warn({ sessionId: validatedData.sessionId }, 'Duplicate session ID, continuing with existing session');
      } else {
        throw insertError;
      }
    }

    const now = new Date().toISOString();
    const sessionStorageData: SessionStorageData = {
      sessionId: validatedData.sessionId,
      startedAt: now,
      initialUrl: validatedData.context.url,
      userAgent,
      deviceType,
      browser,
      operatingSystem,
      lastActivityAt: now,
      projectId: resolvedOrgId,
    };

    const stub = getSessionStub(environment, validatedData.sessionId);
    await stub.initializeSession(sessionStorageData);

    const expiresAt = calculateSessionExpirationTime();

    logger.info({ sessionId: validatedData.sessionId }, 'Session started');

    return createSuccessResponse({
      sessionId: validatedData.sessionId,
      expiresAt,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      logger.warn({ error }, 'Session start validation error');
      return createValidationErrorResponse((error as any).errors);
    }

    if (error instanceof SyntaxError) {
      logger.warn({ error }, 'Session start request body is not valid JSON');
      return createErrorResponse('Request body must be valid JSON', 400);
    }

    logger.error({ error }, 'Error starting session');
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

    const session = await findSessionById(database, validatedData.sessionId);
    await notifyCoreInteractionService(
      environment,
      validatedData.sessionId,
      session?.projectId
    );

    return createSuccessResponse({});
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      logger.warn({ error }, 'Session end validation error');
      return createValidationErrorResponse((error as any).errors);
    }

    if (error instanceof SyntaxError) {
      logger.warn({ error }, 'Session end request body is not valid JSON');
      return createErrorResponse('Request body must be valid JSON', 400);
    }

    logger.error({ error }, 'Error ending session');
    return createErrorResponse('Internal server error', 500);
  }
}
