import { instrument } from '@microlabs/otel-cf-workers';
import { DurableObject } from 'cloudflare:workers';
import { handleBatch } from './handlers/batch';
import { handleReplayBatch } from './handlers/replay';
import {
  handleReplayRender,
  handleGetReplayScreenshots,
} from './handlers/replay-render';
import { handleSessionEnd, handleSessionStart } from './handlers/session';
import { handleGetSessionTimeline } from './handlers/session-timeline';
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

function isReplayRenderRequest(pathname: string, method: string): boolean {
  return pathname === '/replay/render' && method === 'POST';
}

function parseReplayScreenshotsSessionId(
  pathname: string,
  method: string
): string | null {
  if (method !== 'GET') return null;
  const match = pathname.match(/^\/replay\/screenshots\/([^/]+)$/);
  return match ? match[1] : null;
}

function parseSessionTimelineId(
  pathname: string,
  method: string
): string | null {
  if (method !== 'GET') return null;
  const match = pathname.match(/^\/session\/timeline\/([^/]+)$/);
  return match ? match[1] : null;
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

  if (isReplayRenderRequest(pathname, method)) {
    return handleReplayRender(request, env);
  }

  const screenshotsSessionId = parseReplayScreenshotsSessionId(
    pathname,
    method
  );
  if (screenshotsSessionId) {
    return handleGetReplayScreenshots(request, env, screenshotsSessionId);
  }

  const timelineSessionId = parseSessionTimelineId(pathname, method);
  if (timelineSessionId) {
    return handleGetSessionTimeline(request, env, timelineSessionId);
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
