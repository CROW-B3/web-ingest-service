import { logger } from './logger';

export interface StoredSession {
  id: string;
  sessionId: string;
  projectId?: string;
  userId?: string;
  eventCount: number;
  createdAt: number;
  lastActivityAt: number;
  endedAt?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}

export interface SessionStorageHandler {
  saveSessionToDatabase: (
    db: D1Database,
    session: StoredSession
  ) => Promise<void>;
  getSessionFromDatabase: (
    db: D1Database,
    sessionId: string
  ) => Promise<StoredSession | null>;
}

/**
 * Create SQL table for sessions if it doesn't exist
 */
export async function initializeSessionTable(db: D1Database): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sessions_export (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL UNIQUE,
        projectId TEXT,
        userId TEXT,
        eventCount INTEGER NOT NULL DEFAULT 0,
        createdAt INTEGER NOT NULL,
        lastActivityAt INTEGER NOT NULL,
        endedAt INTEGER,
        durationMs INTEGER,
        metadata TEXT,
        exportedAt INTEGER DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_sessionId ON sessions_export(sessionId);
      CREATE INDEX IF NOT EXISTS idx_sessions_exportedAt ON sessions_export(exportedAt);
    `);

    logger.info('Session storage table initialized');
  } catch (error) {
    logger.warn(
      { error },
      'Session table may already exist or initialization failed'
    );
  }
}

export function createSessionStorageHandler(): SessionStorageHandler {
  return {
    saveSessionToDatabase: async (db: D1Database, session: StoredSession) => {
      try {
        const metadataJson = session.metadata
          ? JSON.stringify(session.metadata)
          : null;

        const result = await db
          .prepare(
            `
            INSERT INTO sessions_export (
              id,
              sessionId,
              projectId,
              userId,
              eventCount,
              createdAt,
              lastActivityAt,
              endedAt,
              durationMs,
              metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
          )
          .bind(
            session.id,
            session.sessionId,
            session.projectId || null,
            session.userId || null,
            session.eventCount,
            session.createdAt,
            session.lastActivityAt,
            session.endedAt || null,
            session.durationMs || null,
            metadataJson
          )
          .run();

        logger.info(
          {
            sessionId: session.sessionId,
            eventCount: session.eventCount,
            success: result.success,
          },
          'Session saved to database'
        );
      } catch (error) {
        logger.error(
          {
            sessionId: session.sessionId,
            error,
          },
          'Failed to save session to database'
        );
        throw error;
      }
    },

    getSessionFromDatabase: async (db: D1Database, sessionId: string) => {
      try {
        const result = await db
          .prepare('SELECT * FROM sessions_export WHERE sessionId = ? LIMIT 1')
          .bind(sessionId)
          .first();

        if (!result) {
          return null;
        }

        const metadata = (result as any).metadata
          ? JSON.parse((result as any).metadata)
          : undefined;

        return {
          id: (result as any).id,
          sessionId: (result as any).sessionId,
          projectId: (result as any).projectId,
          userId: (result as any).userId,
          eventCount: (result as any).eventCount,
          createdAt: (result as any).createdAt,
          lastActivityAt: (result as any).lastActivityAt,
          endedAt: (result as any).endedAt,
          durationMs: (result as any).durationMs,
          metadata,
        };
      } catch (error) {
        logger.error(
          {
            sessionId,
            error,
          },
          'Failed to retrieve session from database'
        );
        throw error;
      }
    },
  };
}
