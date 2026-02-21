import { instrument } from '@microlabs/otel-cf-workers';
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
import { createOtelConfig } from './lib/otel';
import { corsHeaders, handleCorsPreFlight } from './middleware/cors';
import { logger } from './utils/logger';

export class CrowWebSession extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async sayHello(name: string): Promise<string> {
    return `Hello, ${name}!`;
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
    return handleListSessionsForOrganization(request, env, pathname);
  }

  if (isGetSessionEventsRequest(pathname, method)) {
    return handleGetSessionEvents(request, env, pathname);
  }

  if (isGetSessionReplayRequest(pathname, method)) {
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
    return handleIncomingRequest(request, env);
  },
};

export default instrument(handler, createOtelConfig('crow-web-ingest-service'));
