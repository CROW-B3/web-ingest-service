import type { DatabaseClient } from '../db/client';
import { eq } from 'drizzle-orm';
import { generateId } from '../db/client';
import { users } from '../db/schema';

export async function findUserByAnonymousId(
  database: DatabaseClient,
  anonymousId: string
) {
  return database
    .select()
    .from(users)
    .where(eq(users.anonymousId, anonymousId))
    .get();
}

export async function createNewUser(
  database: DatabaseClient,
  projectId: string,
  anonymousId: string,
  initialSessionCount = 0
): Promise<string> {
  const userId = generateId('user');
  await database
    .insert(users)
    .values({
      id: userId,
      projectId,
      anonymousId,
      sessionCount: initialSessionCount,
    })
    .run();
  return userId;
}

// Resolves a user ID for event tracking (track/batch endpoints)
export async function resolveUserId(
  database: DatabaseClient,
  projectId: string,
  userAnonymousId: string | undefined
): Promise<string | null> {
  if (!userAnonymousId) return null;

  const existingUser = await findUserByAnonymousId(database, userAnonymousId);
  if (existingUser) return existingUser.id;

  return createNewUser(database, projectId, userAnonymousId);
}

async function incrementUserSessionCount(
  database: DatabaseClient,
  userId: string,
  currentSessionCount: number
): Promise<void> {
  await database
    .update(users)
    .set({ sessionCount: currentSessionCount + 1 })
    .where(eq(users.id, userId))
    .run();
}

// Resolves a user ID for session start (increments session count)
export async function resolveUserIdForSession(
  database: DatabaseClient,
  projectId: string,
  userAnonymousId: string
): Promise<string> {
  const existingUser = await findUserByAnonymousId(database, userAnonymousId);

  if (existingUser) {
    await incrementUserSessionCount(
      database,
      existingUser.id,
      existingUser.sessionCount
    );
    return existingUser.id;
  }

  return createNewUser(database, projectId, userAnonymousId, 1);
}
