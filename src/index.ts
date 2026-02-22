import { instrument } from '@microlabs/otel-cf-workers';
import { DurableObject } from 'cloudflare:workers';
import { handleBatch } from './handlers/batch';
import { handleGetProcessedSession } from './handlers/processed-session';
import { handleReplayBatch } from './handlers/replay';
import { handleReplayViewer } from './handlers/replay-viewer';
import { handleSessionEnd, handleSessionStart } from './handlers/session';
import { handleTrack } from './handlers/track';
import { createOtelConfig } from './lib/otel';
import { corsHeaders, handleCorsPreFlight } from './middleware/cors';
import { processExpiredSession } from './services/session-processor';
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

const ONE_HOUR_MS = 1000 * 60 * 1;

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

function parseReplayViewerRequest(
  pathname: string,
  method: string
): string | null {
  if (method !== 'GET') return null;
  const match = pathname.match(/^\/internal\/replay-viewer\/(.+)$/);
  return match ? match[1] : null;
}

function parseProcessedSessionRequest(
  pathname: string,
  method: string
): string | null {
  if (method !== 'GET') return null;
  const match = pathname.match(/^\/session\/(.+)\/processed$/);
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

  const replayViewerSessionId = parseReplayViewerRequest(pathname, method);
  if (replayViewerSessionId) {
    return handleReplayViewer(env, replayViewerSessionId);
  }

  const processedSessionId = parseProcessedSessionRequest(pathname, method);
  if (processedSessionId) {
    return handleGetProcessedSession(request, env, processedSessionId);
  }

  logger.warn({ method, pathname }, 'Route not found');
  return createNotFoundResponse();
}

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleIncomingRequest(request, env);
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { sessionId, expiredAt } = message.body as {
        sessionId: string;
        expiredAt: string;
      };
      logger.info(
        { sessionId, expiredAt },
        'Queue: Processing expired session'
      );
      try {
        await processExpiredSession(sessionId, env);
        message.ack();
        logger.info({ sessionId }, 'Queue: Session processing completed');
      } catch (error) {
        logger.error(
          { sessionId, error },
          'Queue: Session processing failed, retrying'
        );
        message.retry();
      }
    }
  },
};

export default instrument(handler, createOtelConfig('crow-web-ingest-service'));
