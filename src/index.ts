import { DurableObject } from 'cloudflare:workers';
import { handleBatch } from './handlers/batch';
import { handleTrack } from './handlers/track';
import { corsHeaders, handleCorsPreFlight } from './middleware/cors';
import { logger } from './utils/logger';

interface SessionState {
  sessionId: string;
  createdAt: number;
  lastActivityAt: number;
  eventCount: number;
  metadata?: Record<string, any>;
}

const SESSION_INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour
const INACTIVE_SESSION_CALLBACK_URL = 'http://localhost:5000';

export class CrowWebSession extends DurableObject<Env> {
  private sessionState: SessionState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async getOrCreateSession(sessionId: string): Promise<SessionState> {
    // Check if session exists in state
    const existingSession = await this.ctx.storage.get<SessionState>(
      `session:${sessionId}`
    );

    if (existingSession) {
      this.sessionState = existingSession;
      return existingSession;
    }

    // Create new session
    const newSession: SessionState = {
      sessionId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      eventCount: 0,
    };

    await this.ctx.storage.put(`session:${sessionId}`, newSession);
    this.sessionState = newSession;

    // Set alarm for 1 hour inactivity check
    await this.ctx.storage.setAlarm(Date.now() + SESSION_INACTIVITY_TIMEOUT_MS);

    logger.info({ sessionId }, 'Created new session');
    return newSession;
  }

  async updateSessionActivity(sessionId: string): Promise<SessionState> {
    let session = await this.ctx.storage.get<SessionState>(
      `session:${sessionId}`
    );

    if (!session) {
      session = await this.getOrCreateSession(sessionId);
    }

    session.lastActivityAt = Date.now();
    session.eventCount += 1;

    await this.ctx.storage.put(`session:${sessionId}`, session);
    this.sessionState = session;

    // Reset alarm
    await this.ctx.storage.setAlarm(Date.now() + SESSION_INACTIVITY_TIMEOUT_MS);

    return session;
  }

  async getSession(sessionId: string): Promise<SessionState | null> {
    const session = await this.ctx.storage.get<SessionState>(
      `session:${sessionId}`
    );
    return session || null;
  }

  async alarm(): Promise<void> {
    logger.info('Session inactivity alarm triggered');

    // Get all sessions and check which ones are inactive
    const allEntries = await this.ctx.storage.list<SessionState>();

    for (const [key, session] of allEntries) {
      if (!key.startsWith('session:')) continue;

      const timeSinceLastActivity = Date.now() - session.lastActivityAt;

      if (timeSinceLastActivity >= SESSION_INACTIVITY_TIMEOUT_MS) {
        logger.info(
          { sessionId: session.sessionId, inactiveFor: timeSinceLastActivity },
          'Session inactive, sending callback'
        );

        // Send callback to localhost:5000
        try {
          await fetch(INACTIVE_SESSION_CALLBACK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId: session.sessionId,
              timestamp: Date.now(),
            }),
          });

          // Remove the inactive session
          await this.ctx.storage.delete(key);
          logger.info(
            { sessionId: session.sessionId },
            'Inactive session cleaned up'
          );
        } catch (error) {
          logger.error(
            { sessionId: session.sessionId, error },
            'Failed to send inactive session callback'
          );
        }
      }
    }

    // Schedule next alarm
    await this.ctx.storage.setAlarm(Date.now() + SESSION_INACTIVITY_TIMEOUT_MS);
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

  logger.warn({ method, pathname }, 'Route not found');
  return createNotFoundResponse();
}

export default {
  async fetch(request, env): Promise<Response> {
    return handleIncomingRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
