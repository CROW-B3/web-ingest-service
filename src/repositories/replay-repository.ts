import type { DatabaseClient } from '../db/client';
import { asc, eq } from 'drizzle-orm';
import { replayChunks } from '../db/schema';

export async function findReplayChunksBySessionId(
  database: DatabaseClient,
  sessionId: string
) {
  return database
    .select()
    .from(replayChunks)
    .where(eq(replayChunks.sessionId, sessionId))
    .orderBy(asc(replayChunks.chunkIndex))
    .all();
}
