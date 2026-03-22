import type { SessionStorageData } from '../index';
import { z } from 'zod';
import { createDatabaseClient, generateId } from '../db/client';
import { insertTrackingEvent } from '../repositories/event-repository';
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

const DEFAULT_AUTH_URL = 'https://dev.internal.auth-api.crowai.dev';

async function verifyApiKey(apiKey: string, env: Env): Promise<string | null> {
  try {
    const authUrl = (env as any).AUTH_SERVICE_URL ?? env.GATEWAY_URL ?? DEFAULT_AUTH_URL;
    const isInternalAuth = authUrl.includes('internal.auth');
    const authVerifyUrl = isInternalAuth
      ? `${authUrl}/api/v1/auth/api-key/verify`
      : `${authUrl}/api/v1/auth/api-key/verify`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if ((env as any).INTERNAL_GATEWAY_KEY) {
      headers['X-Internal-Key'] = (env as any).INTERNAL_GATEWAY_KEY;
    }
    if (env.SERVICE_API_KEY) {
      headers['X-Service-API-Key'] = env.SERVICE_API_KEY;
    }
    const response = await fetch(authVerifyUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: apiKey }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      metadata?: { organizationId?: string };
    };
    return data?.metadata?.organizationId ?? null;
  } catch {
    return null;
  }
}

function extractApiKey(request: Request): string | null {
  const xApiKey = request.headers.get('X-API-Key');
  if (xApiKey?.startsWith('crow_')) return xApiKey;

  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

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

const sessionStartSchema = z.object({
  sessionId: z.string().optional(),
  url: z.string().url(),
  referrer: z.string().optional(),
  userAgent: z.string().optional(),
  title: z.string().optional(),
});

const sessionEventSchema = z.object({
  sessionId: z.string(),
  type: z.enum([
    'pageview',
    'click',
    'scroll',
    'form',
    'custom',
    'error',
    'navigation',
    'engagement',
    'visibility',
    'rage_click',
    'hover',
    'form_focus',
    'add_to_cart',
    'variant_select',
    'image_zoom',
    'performance',
    'web_vital',
    'api_error',
  ]),
  url: z.string().url(),
  title: z.string().optional(),
  timestamp: z.number().optional(),
  properties: z.record(z.string(), z.any()).optional(),
});

const sessionEndSchema = z.object({
  sessionId: z.string(),
  duration: z.number().optional(),
});

export async function handleIngestSessionStart(
  request: Request,
  env: Env
): Promise<Response> {
  const apiKey = extractApiKey(request);
  if (!apiKey)
    return createErrorResponse('Missing or invalid Authorization header', 401);

  const organizationId = await verifyApiKey(apiKey, env);
  if (!organizationId) return createErrorResponse('Invalid API key', 401);

  try {
    const body = await request.json();
    const data = sessionStartSchema.parse(body);
    const sessionId = data.sessionId || generateId('ses');
    const userAgent = data.userAgent || request.headers.get('User-Agent') || '';
    const deviceType = parseDeviceTypeFromUserAgent(userAgent);
    const browser = parseBrowserFromUserAgent(userAgent);
    const operatingSystem = parseOperatingSystemFromUserAgent(userAgent);
    const ipAddress = request.headers.get('CF-Connecting-IP') || 'unknown';
    const country = request.headers.get('CF-IPCountry') || undefined;

    const database = createDatabaseClient(env.DB);
    await insertNewSession(database, {
      sessionId,
      initialUrl: data.url,
      referrer: data.referrer,
      userAgent,
      ipAddress,
      country,
      deviceType,
      browser,
      operatingSystem,
      projectId: organizationId,
    });

    const now = new Date().toISOString();
    const sessionStorageData: SessionStorageData = {
      sessionId,
      startedAt: now,
      initialUrl: data.url,
      userAgent,
      deviceType,
      browser,
      operatingSystem,
      lastActivityAt: now,
      projectId: organizationId,
    };

    const stub = getSessionStub(env, sessionId);
    await stub.initializeSession(sessionStorageData);

    logger.info({ organizationId, sessionId }, 'Ingest session start');

    return createSuccessResponse({ sessionId, organizationId });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }
    return createErrorResponse('Internal server error', 500);
  }
}

export async function handleIngestSessionEvent(
  request: Request,
  env: Env
): Promise<Response> {
  const apiKey = extractApiKey(request);
  if (!apiKey)
    return createErrorResponse('Missing or invalid Authorization header', 401);

  const organizationId = await verifyApiKey(apiKey, env);
  if (!organizationId) return createErrorResponse('Invalid API key', 401);

  try {
    const body = await request.json();
    const data = sessionEventSchema.parse(body);

    const database = createDatabaseClient(env.DB);
    const session = await findSessionById(database, data.sessionId);
    if (!session)
      return createErrorResponse(
        'Session not found. Please start a session first.',
        404
      );

    const eventId = await insertTrackingEvent(database, data.sessionId, {
      type: data.type,
      url: data.url,
      timestamp: data.timestamp ?? Date.now(),
      data: data.properties,
    });

    const stub = getSessionStub(env, data.sessionId);
    await stub.extendSession();

    logger.info(
      { organizationId, sessionId: data.sessionId, type: data.type, eventId },
      'Ingest session event'
    );

    return createSuccessResponse({ eventId });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }
    return createErrorResponse('Internal server error', 500);
  }
}

export async function handleIngestSessionEnd(
  request: Request,
  env: Env
): Promise<Response> {
  const apiKey = extractApiKey(request);
  if (!apiKey)
    return createErrorResponse('Missing or invalid Authorization header', 401);

  const organizationId = await verifyApiKey(apiKey, env);
  if (!organizationId) return createErrorResponse('Invalid API key', 401);

  try {
    const body = await request.json();
    const data = sessionEndSchema.parse(body);

    const database = createDatabaseClient(env.DB);
    const session = await findSessionById(database, data.sessionId);
    if (!session) return createErrorResponse('Session not found', 404);

    if (data.duration) {
      await updateSessionEndData(database, data.sessionId, data.duration);
    }

    logger.info(
      { organizationId, sessionId: data.sessionId },
      'Ingest session end'
    );

    await notifyCoreInteractionService(env, data.sessionId, organizationId);

    return createSuccessResponse({ ended: true });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }
    return createErrorResponse('Internal server error', 500);
  }
}
