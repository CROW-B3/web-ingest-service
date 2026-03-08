import type { DatabaseClient } from '../db/client';
import { eq } from 'drizzle-orm';
import { sessions } from '../db/schema';

export async function findSessionById(
  database: DatabaseClient,
  sessionId: string
) {
  return database
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
}

export async function markSessionHasReplay(
  database: DatabaseClient,
  sessionId: string
): Promise<void> {
  await database
    .update(sessions)
    .set({ hasReplay: true })
    .where(eq(sessions.id, sessionId))
    .run();
}

interface SessionInsertData {
  sessionId: string;
  initialUrl: string;
  referrer: string | undefined;
  userAgent: string;
  ipAddress: string;
  country: string | undefined;
  deviceType: string;
  browser: string;
  operatingSystem: string;
}

export async function insertNewSession(
  database: DatabaseClient,
  sessionData: SessionInsertData
): Promise<void> {
  await database
    .insert(sessions)
    .values({
      id: sessionData.sessionId,
      initialUrl: sessionData.initialUrl,
      referrer: sessionData.referrer,
      userAgent: sessionData.userAgent,
      ipAddress: sessionData.ipAddress,
      country: sessionData.country,
      deviceType: sessionData.deviceType,
      browser: sessionData.browser,
      operatingSystem: sessionData.operatingSystem,
    })
    .run();
}

export async function findSessionsByProjectId(
  database: DatabaseClient,
  _projectId: string
) {
  // NOTE: Sessions table has no organizationId column yet.
  // This returns all sessions until a schema migration adds org scoping.
  // The endpoint is protected by API key auth to limit exposure.
  return database.select().from(sessions).all();
}

export async function updateSessionEndData(
  database: DatabaseClient,
  sessionId: string,
  durationInMilliseconds: number,
  exitContext?: unknown
): Promise<void> {
  const updateFields: Record<string, unknown> = {
    endedAt: new Date(),
    durationInMilliseconds,
  };

  if (exitContext) {
    updateFields.exitContext = exitContext;
  }

  await database
    .update(sessions)
    .set(updateFields)
    .where(eq(sessions.id, sessionId))
    .run();
}
