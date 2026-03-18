import { z } from 'zod';
import { generateId } from '../db/client';
import { logger } from '../utils/logger';
import {
  createErrorResponse,
  createSuccessResponse,
  createValidationErrorResponse,
} from '../utils/responses';

const AUTH_VERIFY_URL = 'http://localhost:8000/api/v1/auth/api-key/verify';

async function verifyApiKey(apiKey: string): Promise<string | null> {
  try {
    const response = await fetch(AUTH_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
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
  type: z.enum(['pageview', 'click', 'custom']),
  url: z.string().url(),
  title: z.string().optional(),
  properties: z.record(z.string(), z.any()).optional(),
});

const sessionEndSchema = z.object({
  sessionId: z.string(),
  duration: z.number().optional(),
});

async function pushToInteractionQueue(
  env: Env,
  organizationId: string,
  sessionId: string,
  events: unknown[]
): Promise<void> {
  if (!env.SESSION_EXPIRY_QUEUE) return;
  const message = {
    organizationId,
    sourceType: 'web',
    sessionId,
    data: JSON.stringify({ events, summary: { eventCount: events.length } }),
    timestamp: Date.now(),
  };
  await env.SESSION_EXPIRY_QUEUE.send(message);
}

export async function handleIngestSessionStart(
  request: Request,
  _env: Env
): Promise<Response> {
  const apiKey = extractBearerToken(request);
  if (!apiKey)
    return createErrorResponse('Missing or invalid Authorization header', 401);

  const organizationId = await verifyApiKey(apiKey);
  if (!organizationId) return createErrorResponse('Invalid API key', 401);

  try {
    const body = await request.json();
    const data = sessionStartSchema.parse(body);
    const sessionId = data.sessionId || generateId('ses');

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
  _env: Env
): Promise<Response> {
  const apiKey = extractBearerToken(request);
  if (!apiKey)
    return createErrorResponse('Missing or invalid Authorization header', 401);

  const organizationId = await verifyApiKey(apiKey);
  if (!organizationId) return createErrorResponse('Invalid API key', 401);

  try {
    const body = await request.json();
    const data = sessionEventSchema.parse(body);
    const eventId = generateId('evt');

    logger.info(
      { organizationId, sessionId: data.sessionId, type: data.type },
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
  const apiKey = extractBearerToken(request);
  if (!apiKey)
    return createErrorResponse('Missing or invalid Authorization header', 401);

  const organizationId = await verifyApiKey(apiKey);
  if (!organizationId) return createErrorResponse('Invalid API key', 401);

  try {
    const body = await request.json();
    const data = sessionEndSchema.parse(body);

    logger.info(
      { organizationId, sessionId: data.sessionId },
      'Ingest session end'
    );

    await pushToInteractionQueue(env, organizationId, data.sessionId, []);

    return createSuccessResponse({ ended: true });
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError') {
      return createValidationErrorResponse((error as any).errors);
    }
    return createErrorResponse('Internal server error', 500);
  }
}
