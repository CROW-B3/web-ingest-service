import { z } from 'zod';
import { generateId } from '../db/client';
import { notifyCoreInteractionService } from '../utils/core-service';
import { logger } from '../utils/logger';
import {
  createErrorResponse,
  createSuccessResponse,
  createValidationErrorResponse,
} from '../utils/responses';

const DEFAULT_GATEWAY_URL = 'https://dev.api.crowai.dev';

async function verifyApiKey(apiKey: string, env: Env): Promise<string | null> {
  try {
    const gatewayUrl = env.GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
    const authVerifyUrl = `${gatewayUrl}/api/v1/auth/api-key/verify`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
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

export async function handleIngestSessionStart(
  request: Request,
  env: Env
): Promise<Response> {
  const apiKey = extractBearerToken(request);
  if (!apiKey)
    return createErrorResponse('Missing or invalid Authorization header', 401);

  const organizationId = await verifyApiKey(apiKey, env);
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
  env: Env
): Promise<Response> {
  const apiKey = extractBearerToken(request);
  if (!apiKey)
    return createErrorResponse('Missing or invalid Authorization header', 401);

  const organizationId = await verifyApiKey(apiKey, env);
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

  const organizationId = await verifyApiKey(apiKey, env);
  if (!organizationId) return createErrorResponse('Invalid API key', 401);

  try {
    const body = await request.json();
    const data = sessionEndSchema.parse(body);

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
