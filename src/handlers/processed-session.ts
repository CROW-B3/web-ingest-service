import { asc, eq } from 'drizzle-orm';
import { createDatabaseClient } from '../db/client';
import { processedSessions, sessionScreenshots } from '../db/schema';
import { logger } from '../utils/logger';
import { createErrorResponse, createSuccessResponse } from '../utils/responses';

export async function handleGetProcessedSession(
  request: Request,
  env: Env,
  sessionId: string
): Promise<Response> {
  try {
    const db = createDatabaseClient(env.DB);
    const url = new URL(request.url);
    const include = url.searchParams.get('include')?.split(',') || [];

    const processed = await db
      .select()
      .from(processedSessions)
      .where(eq(processedSessions.sessionId, sessionId))
      .get();

    if (!processed) {
      return createErrorResponse('Processed session not found', 404);
    }

    const result: Record<string, unknown> = {
      id: processed.id,
      sessionId: processed.sessionId,
      status: processed.status,
      totalEvents: processed.totalEvents,
      totalReplayChunks: processed.totalReplayChunks,
      totalReplaySizeBytes: processed.totalReplaySizeBytes,
      durationMs: processed.durationMs,
      pagesVisited: processed.pagesVisited,
      eventTypeCounts: processed.eventTypeCounts,
      screenshotCount: processed.screenshotCount,
      processedAt: processed.processedAt,
      createdAt: processed.createdAt,
    };

    if (include.includes('screenshots')) {
      const screenshots = await db
        .select()
        .from(sessionScreenshots)
        .where(eq(sessionScreenshots.sessionId, sessionId))
        .orderBy(asc(sessionScreenshots.timestamp))
        .all();

      result.screenshots = screenshots.map(s => ({
        id: s.id,
        eventType: s.eventType,
        eventDescription: s.eventDescription,
        timestamp: s.timestamp,
        r2Key: s.r2Key,
        sizeBytes: s.sizeBytes,
        createdAt: s.createdAt,
      }));
    }

    if (include.includes('timeline') && processed.timelineR2Key) {
      const timelineObject = await env.R2_BUCKET.get(processed.timelineR2Key);
      if (timelineObject) {
        result.timeline = await timelineObject.json();
      }
    }

    return createSuccessResponse(result);
  } catch (error) {
    logger.error({ sessionId, error }, 'Error fetching processed session');
    return createErrorResponse('Internal server error', 500);
  }
}
