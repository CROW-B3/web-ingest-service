import { instrument } from '@microlabs/otel-cf-workers';
import { DurableObject } from 'cloudflare:workers';
import { createDatabaseClient } from './db/client';
import { handleBatch } from './handlers/batch';
import {
  handleIngestSessionEnd,
  handleIngestSessionEvent,
  handleIngestSessionStart,
} from './handlers/ingest';
import { handleGetInternalSessionData } from './handlers/internal-sessions';
import { handleReplayBatch } from './handlers/replay';
import { handleSessionEnd, handleSessionStart } from './handlers/session';
import {
  handleGetSessionEvents,
  handleGetSessionReplay,
  handleListSessionsForOrganization,
} from './handlers/sessions';
import { handleTrack } from './handlers/track';
import { createOtelConfig } from './lib/otel';
import { corsHeaders, handleCorsPreFlight } from './middleware/cors';
import {
  findSessionById,
  updateSessionEndData,
} from './repositories/session-repository';
import { logger } from './utils/logger';
import { createErrorResponse } from './utils/responses';

const AUTH_VERIFY_URL = 'http://localhost:8000/api/v1/auth/api-key/verify';

async function verifyBearerApiKey(
  request: Request,
  env: Env
): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return false;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (env.SERVICE_API_KEY) {
      headers['X-Service-API-Key'] = env.SERVICE_API_KEY;
    }
    const response = await fetch(AUTH_VERIFY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ key: apiKey }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface SessionStorageData {
  sessionId: string;
  startedAt: string;
  initialUrl: string;
  userAgent: string;
  deviceType: string;
  browser: string;
  operatingSystem: string;
  lastActivityAt: string;
}

const THIRTY_SECONDS_MS = 1000 * 30;

export class CrowWebSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async initializeSession(data: SessionStorageData): Promise<void> {
    await this.ctx.storage.put('session', data);
    await this.ctx.storage.setAlarm(Date.now() + THIRTY_SECONDS_MS);
    logger.info(
      { sessionId: data.sessionId },
      'DO: Session initialized with alarm'
    );
  }

  async extendSession(): Promise<void> {
    const session = await this.ctx.storage.get<SessionStorageData>('session');
    if (session) {
      session.lastActivityAt = new Date().toISOString();
      await this.ctx.storage.put('session', session);
      await this.ctx.storage.setAlarm(Date.now() + THIRTY_SECONDS_MS);
      logger.info(
        { sessionId: session.sessionId },
        'DO: Session alarm extended'
      );
    }
  }

  async alarm(): Promise<void> {
    const session = await this.ctx.storage.get<SessionStorageData>('session');
    if (session) {
      await this.env.SESSION_EXPIRY_QUEUE.send({
        sessionId: session.sessionId,
        expiredAt: new Date().toISOString(),
      });
      logger.info(
        { sessionId: session.sessionId },
        'DO: Session expired, sent to queue'
      );
    }
  }
}

function createHealthCheckResponse(): Response {
  return new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function createNotFoundResponse(): Response {
  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function isHealthCheckRequest(pathname: string, method: string): boolean {
  return (pathname === '/' || pathname === '/health') && method === 'GET';
}

function isTrackRequest(pathname: string, method: string): boolean {
  return pathname === '/track' && method === 'POST';
}

function isBatchRequest(pathname: string, method: string): boolean {
  return pathname === '/batch' && method === 'POST';
}

function isSessionStartRequest(pathname: string, method: string): boolean {
  return pathname === '/session/start' && method === 'POST';
}

function isSessionEndRequest(pathname: string, method: string): boolean {
  return pathname === '/session/end' && method === 'POST';
}

function isReplayBatchRequest(pathname: string, method: string): boolean {
  return pathname === '/replay/batch' && method === 'POST';
}

function isListSessionsRequest(pathname: string, method: string): boolean {
  return /^\/sessions\/organization\/[^/]+$/.test(pathname) && method === 'GET';
}

function isGetSessionEventsRequest(pathname: string, method: string): boolean {
  return /^\/sessions\/[^/]+\/events$/.test(pathname) && method === 'GET';
}

function isIngestSessionStartRequest(
  pathname: string,
  method: string
): boolean {
  return pathname === '/api/v1/ingest/session/start' && method === 'POST';
}

function isIngestSessionEventRequest(
  pathname: string,
  method: string
): boolean {
  return pathname === '/api/v1/ingest/session/event' && method === 'POST';
}

function isIngestSessionEndRequest(pathname: string, method: string): boolean {
  return pathname === '/api/v1/ingest/session/end' && method === 'POST';
}

function isGetSessionReplayRequest(pathname: string, method: string): boolean {
  return /^\/sessions\/[^/]+\/replay$/.test(pathname) && method === 'GET';
}

function isInternalSessionDataRequest(
  pathname: string,
  method: string
): boolean {
  return (
    /^\/internal\/sessions\/[^/]+\/data$/.test(pathname) && method === 'GET'
  );
}

async function handleIncomingRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const pathname = url.pathname;

  logger.info({ method, pathname, url: request.url }, 'Incoming request');

  if (method === 'OPTIONS') {
    logger.debug('Handling CORS preflight request');
    return handleCorsPreFlight();
  }

  if (isHealthCheckRequest(pathname, method)) {
    logger.info('Health check request');
    return createHealthCheckResponse();
  }

  if (isTrackRequest(pathname, method)) {
    return handleTrack(request, env);
  }

  if (isBatchRequest(pathname, method)) {
    return handleBatch(request, env);
  }

  if (isSessionStartRequest(pathname, method)) {
    return handleSessionStart(request, env);
  }

  if (isSessionEndRequest(pathname, method)) {
    return handleSessionEnd(request, env);
  }

  if (isReplayBatchRequest(pathname, method)) {
    return handleReplayBatch(request, env);
  }

  if (isListSessionsRequest(pathname, method)) {
    const authed = await verifyBearerApiKey(request, env);
    if (!authed) return createErrorResponse('Authentication required', 401);
    return handleListSessionsForOrganization(request, env, pathname);
  }

  if (isGetSessionEventsRequest(pathname, method)) {
    const authed = await verifyBearerApiKey(request, env);
    if (!authed) return createErrorResponse('Authentication required', 401);
    return handleGetSessionEvents(request, env, pathname);
  }

  if (isGetSessionReplayRequest(pathname, method)) {
    const authed = await verifyBearerApiKey(request, env);
    if (!authed) return createErrorResponse('Authentication required', 401);
    return handleGetSessionReplay(request, env, pathname);
  }

  if (isIngestSessionStartRequest(pathname, method)) {
    return handleIngestSessionStart(request, env);
  }

  if (isIngestSessionEventRequest(pathname, method)) {
    return handleIngestSessionEvent(request, env);
  }

  if (isIngestSessionEndRequest(pathname, method)) {
    return handleIngestSessionEnd(request, env);
  }

  if (isInternalSessionDataRequest(pathname, method)) {
    return handleGetInternalSessionData(request, env, pathname);
  }

  logger.warn({ method, pathname }, 'Route not found');
  return createNotFoundResponse();
}

async function notifyCoreInteractionService(
  env: Env,
  sessionId: string,
  organizationId?: string | null
): Promise<void> {
  const url = env.CORE_INTERACTION_SERVICE_URL;
  if (!url) return;
  try {
    const response = await fetch(`${url}/internal/web-sessions/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        organizationId: organizationId ?? null,
      }),
    });
    if (!response.ok) {
      logger.warn(
        { sessionId, status: response.status },
        'Core interaction service notification failed'
      );
    } else {
      logger.info({ sessionId }, 'Core interaction service notified');
    }
  } catch (error) {
    logger.warn(
      { error, sessionId },
      'Failed to notify core interaction service'
    );
  }
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleIncomingRequest(request, env);
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const database = createDatabaseClient(env.DB);

    for (const message of batch.messages) {
      const { sessionId, expiredAt } = message.body as {
        sessionId: string;
        expiredAt: string;
      };

      try {
        const session = await findSessionById(database, sessionId);

        if (!session) {
          logger.warn({ sessionId }, 'Queue: session not found, acking');
          message.ack();
          continue;
        }

        if (session.endedAt) {
          logger.info(
            { sessionId },
            'Queue: session already ended, notifying core service'
          );
          await notifyCoreInteractionService(env, sessionId, session.projectId);
          message.ack();
          continue;
        }

        const durationMs =
          new Date(expiredAt).getTime() - session.startedAt.getTime();
        await updateSessionEndData(database, sessionId, durationMs);

        logger.info(
          { sessionId, durationMs },
          'Queue: session expired and updated'
        );

        await notifyCoreInteractionService(env, sessionId, session.projectId);

        message.ack();
      } catch (error) {
        logger.error(
          { error, sessionId },
          'Queue: error processing session expiry'
        );
        message.retry();
      }
    }
  },
};

export default instrument(handler, createOtelConfig('crow-web-ingest-service'));
