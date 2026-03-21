import { DurableObject } from 'cloudflare:workers';
import { handleBatch } from './handlers/batch';
import {
  handleIngestSessionEnd,
  handleIngestSessionEvent,
  handleIngestSessionStart,
} from './handlers/ingest';
import { handleReplayBatch } from './handlers/replay';
import { handleSessionEnd, handleSessionStart } from './handlers/session';
import {
  handleGetSessionEvents,
  handleGetSessionReplay,
  handleListSessionsForOrganization,
} from './handlers/sessions';
import { handleTrack } from './handlers/track';
import { logger } from './utils/logger';
import {
  createCorsPreflightResponse,
  createErrorResponse,
} from './utils/responses';

const DEFAULT_GATEWAY_URL = 'https://dev.api.crowai.dev';

function isInternalGatewayRequest(request: Request, env: Env): boolean {
  const internalKey = request.headers.get('X-Internal-Key');
  return !!(
    internalKey &&
    env.INTERNAL_GATEWAY_KEY &&
    internalKey === env.INTERNAL_GATEWAY_KEY
  );
}

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
    const gatewayUrl = env.GATEWAY_URL ?? DEFAULT_GATEWAY_URL;
    const authVerifyUrl = `${gatewayUrl}/api/v1/auth/api-key/verify`;
    const response = await fetch(authVerifyUrl, {
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

const ONE_HOUR_MS = 1000 * 60 * 60;

export class CrowWebSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async initializeSession(data: SessionStorageData): Promise<void> {
    await this.ctx.storage.put('session', data);
    await this.ctx.storage.setAlarm(Date.now() + ONE_HOUR_MS);
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
      await this.ctx.storage.setAlarm(Date.now() + ONE_HOUR_MS);
      logger.info(
        { sessionId: session.sessionId },
        'DO: Session alarm extended'
      );
    }
  }

  async alarm(): Promise<void> {
    const session = await this.ctx.storage.get<SessionStorageData>('session');
    if (session) {
      await this.env.INTERACTION_QUEUE.send({
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
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function createNotFoundResponse(): Response {
  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function isHealthCheckRequest(pathname: string, method: string): boolean {
  return (pathname === '/' || pathname === '/health') && method === 'GET';
}

function isTrackRequest(pathname: string, method: string): boolean {
  return (
    (pathname === '/track' || pathname === '/api/v1/track') && method === 'POST'
  );
}

function isBatchRequest(pathname: string, method: string): boolean {
  return (
    (pathname === '/batch' || pathname === '/api/v1/batch') && method === 'POST'
  );
}

function isSessionStartRequest(pathname: string, method: string): boolean {
  return (
    (pathname === '/session/start' || pathname === '/api/v1/sessions') &&
    method === 'POST'
  );
}

function isSessionEndRequest(pathname: string, method: string): boolean {
  return (
    (pathname === '/session/end' || pathname === '/api/v1/sessions/end') &&
    method === 'POST'
  );
}

function isReplayBatchRequest(pathname: string, method: string): boolean {
  return pathname === '/replay/batch' && method === 'POST';
}

function isListSessionsRequest(pathname: string, method: string): boolean {
  return (
    (/^\/sessions\/organization\/[^/]+$/.test(pathname) ||
      /^\/api\/v\d+\/ingest\/sessions\/organization\/[^/]+$/.test(pathname)) &&
    method === 'GET'
  );
}

function isGetSessionEventsRequest(pathname: string, method: string): boolean {
  return (
    (/^\/sessions\/[^/]+\/events$/.test(pathname) ||
      /^\/api\/v\d+\/ingest\/sessions\/[^/]+\/events$/.test(pathname)) &&
    method === 'GET'
  );
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
  return (
    (/^\/sessions\/[^/]+\/replay$/.test(pathname) ||
      /^\/api\/v\d+\/ingest\/sessions\/[^/]+\/replay$/.test(pathname)) &&
    method === 'GET'
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
    return createCorsPreflightResponse();
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
    const authed =
      isInternalGatewayRequest(request, env) ||
      (await verifyBearerApiKey(request, env));
    if (!authed) return createErrorResponse('Authentication required', 401);
    return handleListSessionsForOrganization(request, env, pathname);
  }

  if (isGetSessionEventsRequest(pathname, method)) {
    const authed =
      isInternalGatewayRequest(request, env) ||
      (await verifyBearerApiKey(request, env));
    if (!authed) return createErrorResponse('Authentication required', 401);
    return handleGetSessionEvents(request, env, pathname);
  }

  if (isGetSessionReplayRequest(pathname, method)) {
    const authed =
      isInternalGatewayRequest(request, env) ||
      (await verifyBearerApiKey(request, env));
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

  logger.warn({ method, pathname }, 'Route not found');
  return createNotFoundResponse();
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleIncomingRequest(request, env);
    } catch (error) {
      logger.error({ error }, 'Unhandled error in fetch handler');
      return new Response(
        JSON.stringify({ success: false, errors: ['Internal server error'] }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }
  },
  async queue(_batch: MessageBatch, _env: Env): Promise<void> {},
};

export default handler;
