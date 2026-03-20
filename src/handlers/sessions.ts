import { createDatabaseClient } from '../db/client';
import { findEventsBySessionId } from '../repositories/event-repository';
import { findReplayChunksBySessionId } from '../repositories/replay-repository';
import {
  findSessionById,
  findSessionsByProjectId,
} from '../repositories/session-repository';
import { logger } from '../utils/logger';
import { createErrorResponse, createSuccessResponse } from '../utils/responses';

function extractOrgIdFromPath(pathname: string): string | null {
  const match =
    pathname.match(/^\/sessions\/organization\/([^/]+)$/) ||
    pathname.match(/^\/api\/v\d+\/ingest\/sessions\/organization\/([^/]+)$/);
  return match ? match[1] : null;
}

function extractSessionIdFromEventsPath(pathname: string): string | null {
  const match =
    pathname.match(/^\/sessions\/([^/]+)\/events$/) ||
    pathname.match(/^\/api\/v\d+\/ingest\/sessions\/([^/]+)\/events$/);
  return match ? match[1] : null;
}

function extractSessionIdFromReplayPath(pathname: string): string | null {
  const match =
    pathname.match(/^\/sessions\/([^/]+)\/replay$/) ||
    pathname.match(/^\/api\/v\d+\/ingest\/sessions\/([^/]+)\/replay$/);
  return match ? match[1] : null;
}

async function fetchSessionReplay(
  environment: Env,
  sessionId: string,
  chunks: Awaited<ReturnType<typeof findReplayChunksBySessionId>>
): Promise<unknown[]> {
  const loaded = await Promise.all(
    chunks.map(async chunk => {
      const object = await environment.R2_BUCKET.get(chunk.r2Key);
      if (!object) return [];
      const text = await object.text();
      return JSON.parse(text) as unknown[];
    })
  );

  return loaded.flat();
}

export async function handleListSessionsForOrganization(
  request: Request,
  environment: Env,
  pathname: string
): Promise<Response> {
  const orgId = extractOrgIdFromPath(pathname);

  if (!orgId) {
    return createErrorResponse('Invalid organization ID in path', 400);
  }

  const database = createDatabaseClient(environment.DB);

  const sessionList = await findSessionsByProjectId(database, orgId);

  logger.info(
    { orgId, count: sessionList.length },
    'Sessions listed for organization'
  );

  return createSuccessResponse({ sessions: sessionList });
}

export async function handleGetSessionEvents(
  request: Request,
  environment: Env,
  pathname: string
): Promise<Response> {
  const sessionId = extractSessionIdFromEventsPath(pathname);

  if (!sessionId) {
    return createErrorResponse('Invalid session ID in path', 400);
  }

  const database = createDatabaseClient(environment.DB);

  const session = await findSessionById(database, sessionId);

  if (!session) {
    logger.warn({ sessionId }, 'Session not found');
    return createErrorResponse('Session not found', 404);
  }

  const eventList = await findEventsBySessionId(database, sessionId);

  logger.info(
    { sessionId, count: eventList.length },
    'Events fetched for session'
  );

  return createSuccessResponse({ events: eventList });
}

export async function handleGetSessionReplay(
  request: Request,
  environment: Env,
  pathname: string
): Promise<Response> {
  const sessionId = extractSessionIdFromReplayPath(pathname);

  if (!sessionId) {
    return createErrorResponse('Invalid session ID in path', 400);
  }

  const database = createDatabaseClient(environment.DB);

  const session = await findSessionById(database, sessionId);

  if (!session) {
    logger.warn({ sessionId }, 'Session not found');
    return createErrorResponse('Session not found', 404);
  }

  const chunks = await findReplayChunksBySessionId(database, sessionId);
  const timeline = await fetchSessionReplay(environment, sessionId, chunks);

  logger.info(
    { sessionId, eventCount: timeline.length },
    'Replay timeline fetched'
  );

  return createSuccessResponse({ sessionId, timeline });
}
