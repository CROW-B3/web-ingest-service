import { asc, eq } from 'drizzle-orm';
import { createDatabaseClient } from '../db/client';
import { replayChunks } from '../db/schema';
import { generateReplayViewerHtml } from '../templates/replay-viewer';
import { logger } from '../utils/logger';
import { createErrorResponse } from '../utils/responses';

export async function handleReplayViewer(
  env: Env,
  sessionId: string
): Promise<Response> {
  try {
    const db = createDatabaseClient(env.DB);

    const chunks = await db
      .select()
      .from(replayChunks)
      .where(eq(replayChunks.sessionId, sessionId))
      .orderBy(asc(replayChunks.chunkIndex))
      .all();

    if (chunks.length === 0) {
      return createErrorResponse('No replay data found for session', 404);
    }

    const allRrwebEvents: unknown[] = [];
    for (const chunk of chunks) {
      const r2Object = await env.R2_BUCKET.get(chunk.r2Key);
      if (r2Object) {
        const chunkData = await r2Object.json<unknown[]>();
        allRrwebEvents.push(...chunkData);
      }
    }

    const html = generateReplayViewerHtml(allRrwebEvents);

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    logger.error({ sessionId, error }, 'Error serving replay viewer');
    return createErrorResponse('Internal server error', 500);
  }
}
