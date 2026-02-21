import { instrument } from '@microlabs/otel-cf-workers';
import { DurableObject } from 'cloudflare:workers';
import { handleBatch } from './handlers/batch';
import { handleReplayBatch } from './handlers/replay';
import { handleSessionEnd, handleSessionStart } from './handlers/session';
import { handleTrack } from './handlers/track';
import { createOtelConfig } from './lib/otel';
import { corsHeaders, handleCorsPreFlight } from './middleware/cors';
import { logger } from './utils/logger';

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

const ONE_HOUR_MS = 3_600_000;

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
    logger.info(
      { sessionId: session?.sessionId },
      'DO: Alarm fired for session'
    );
  }
}

function createHealthCheckResponse(): Response {
  return new Response(
    JSON.stringify({
      status: 'ok',
      service: 'web-ingest-worker',
      version: '1.0.0',
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

function createNotFoundResponse(): Response {
  return new Response(JSON.stringify({ error: 'Not Found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function isHealthCheckRequest(pathname: string, method: string): boolean {
  return pathname === '/' && method === 'GET';
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

  logger.warn({ method, pathname }, 'Route not found');
  return createNotFoundResponse();
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleIncomingRequest(request, env);
  },
};

export default instrument(handler, createOtelConfig('crow-web-ingest-service'));
