import { eq } from 'drizzle-orm';
import { createDatabaseClient } from '../db/client';
import { replayChunks, sessions } from '../db/schema';
import { logger } from '../utils/logger';
import {
  MAX_KEY_MOMENTS_FOR_QUEUE,
  renderScreenshotsForSession,
} from './replay-render';

interface SessionExportMessage {
  projectId: string;
  sessionId: string;
}

async function doesSessionHaveReplayData(
  database: any,
  sessionId: string
): Promise<boolean> {
  const session = await database
    .select({ hasReplay: sessions.hasReplay })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get();
  return session?.hasReplay === true;
}

async function hasReplayChunks(
  database: any,
  sessionId: string
): Promise<boolean> {
  const chunks = await database
    .select({ id: replayChunks.id })
    .from(replayChunks)
    .where(eq(replayChunks.sessionId, sessionId))
    .limit(1)
    .all();
  return chunks.length > 0;
}

export async function handleQueueBatch(
  batch: MessageBatch<SessionExportMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const { projectId, sessionId } = message.body;

    logger.info(
      { projectId, sessionId },
      'Processing session export queue message'
    );

    try {
      const database = createDatabaseClient(env.DB);

      const hasReplay = await doesSessionHaveReplayData(database, sessionId);
      if (!hasReplay) {
        logger.info(
          { sessionId },
          'Session has no replay data, skipping screenshot generation'
        );
        message.ack();
        continue;
      }

      const chunksExist = await hasReplayChunks(database, sessionId);
      if (!chunksExist) {
        logger.warn(
          { sessionId },
          'Session marked hasReplay but no chunks found, skipping'
        );
        message.ack();
        continue;
      }

      const result = await renderScreenshotsForSession(
        env,
        projectId,
        sessionId,
        undefined,
        MAX_KEY_MOMENTS_FOR_QUEUE
      );

      if (!result.success) {
        logger.error(
          { sessionId, error: result.error },
          'Screenshot render failed'
        );
        message.retry();
        continue;
      }

      logger.info(
        { sessionId, screenshotCount: result.screenshots.length },
        'Screenshot generation completed successfully'
      );
      message.ack();
    } catch (error) {
      logger.error(
        { error, sessionId },
        'Error processing session export message'
      );
      message.retry();
    }
  }
}
