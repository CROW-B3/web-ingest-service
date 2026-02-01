import { DurableObject } from 'cloudflare:workers';
import { createDatabaseClient } from './db/client';
import { events, sessions } from './db/schema';
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

export interface Event {
  id: string;
  type: string;
  timestamp: number;
  url: string;
  data?: Record<string, any>;
  userAgent?: string;
  screenSize?: { width: number; height: number };
}

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

    // Initialize SQLite schema for this DO
    const sql = this.ctx.storage.sql;
    try {
      await sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          url TEXT NOT NULL,
          data TEXT,
          userAgent TEXT,
          screenWidth INTEGER,
          screenHeight INTEGER,
          createdAt INTEGER DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      logger.warn(
        { error },
        'Failed to create events table, may already exist'
      );
    }

    this.sessionState = newSession;

    // Set alarm for 1 hour inactivity check
    await this.ctx.storage.setAlarm(Date.now() + SESSION_INACTIVITY_TIMEOUT_MS);

    logger.info({ sessionId }, 'Created new session');
    return newSession;
  }

  private async insertEventToLocalStorage(event: Event): Promise<void> {
    const sql = this.ctx.storage.sql;
    const eventData = {
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      url: event.url,
      data: event.data ? JSON.stringify(event.data) : null,
      userAgent: event.userAgent || null,
      screenWidth: event.screenSize?.width || null,
      screenHeight: event.screenSize?.height || null,
    };

    await sql.exec(
      `
      INSERT INTO events (id, type, timestamp, url, data, userAgent, screenWidth, screenHeight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        eventData.id,
        eventData.type,
        eventData.timestamp,
        eventData.url,
        eventData.data,
        eventData.userAgent,
        eventData.screenWidth,
        eventData.screenHeight,
      ]
    );
  }

  private async queryStoredEvents(): Promise<Event[]> {
    const sql = this.ctx.storage.sql;

    const result = await sql.exec(
      `SELECT id, type, timestamp, url, data, userAgent, screenWidth, screenHeight FROM events ORDER BY timestamp ASC`
    );

    if (!result || !result[0]) return [];

    const rows = result[0].results as any[];
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      timestamp: row.timestamp,
      url: row.url,
      data: row.data ? JSON.parse(row.data) : undefined,
      userAgent: row.userAgent,
      screenSize: row.screenWidth
        ? { width: row.screenWidth, height: row.screenHeight }
        : undefined,
    }));
  }

  async storeEvent(event: Event): Promise<void> {
    await this.insertEventToLocalStorage(event);
  }

  async getStoredEvents(): Promise<Event[]> {
    return this.queryStoredEvents();
  }

  async updateSessionActivity(
    sessionId: string,
    event?: Event
  ): Promise<SessionState> {
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

    // Store the event in SQLite if provided
    if (event) {
      await this.storeEvent(event);
    }

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
          'Session inactive, exporting to D1'
        );

        try {
          // Get all events from SQLite
          const storedEvents = await this.getStoredEvents();

          // Save session and events to D1
          const database = createDatabaseClient(this.env.DB);

          // Insert session into D1 using Drizzle ORM
          await database
            .insert(sessions)
            .values({
              id: session.sessionId,
              metadata: {
                eventCount: session.eventCount,
                lastActivityAt: session.lastActivityAt,
              },
            })
            .run();

          // Insert events into D1 using Drizzle ORM
          for (const event of storedEvents) {
            const eventId = `${session.sessionId}-${event.id}`;
            await database
              .insert(events)
              .values({
                id: eventId,
                sessionId: session.sessionId,
                type: event.type,
                url: event.url,
                timestamp: new Date(event.timestamp),
                data: event.data || null,
              })
              .run();
          }

          // Send message to queue for processing
          await this.env.WEB_SESSION_EXPORT.send({
            sessionId: session.sessionId,
            eventCount: storedEvents.length,
            timestamp: Date.now(),
          });

          logger.info(
            { sessionId: session.sessionId, eventCount: storedEvents.length },
            'Session exported to D1 and queued for processing'
          );

          // Delete events from SQLite
          const sql = this.ctx.storage.sql;
          await sql.exec(`DELETE FROM events`);

          // Remove the inactive session
          await this.ctx.storage.delete(key);
          logger.info(
            { sessionId: session.sessionId },
            'Inactive session cleaned up'
          );
        } catch (error) {
          logger.error(
            { sessionId: session.sessionId, error },
            'Failed to export inactive session'
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
