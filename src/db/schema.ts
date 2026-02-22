import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    startedAt: integer('started_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
    durationInMilliseconds: integer('duration'),
    referrer: text('referrer'),
    initialUrl: text('initial_url'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    country: text('country'),
    deviceType: text('device_type'),
    browser: text('browser'),
    operatingSystem: text('os'),
    hasReplay: integer('has_replay', { mode: 'boolean' })
      .notNull()
      .default(false),
    exitContext: text('exit_context', { mode: 'json' }),
  },
  table => ({
    startedIdx: index('idx_sessions_started').on(table.startedAt),
  })
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    type: text('type').notNull(),
    url: text('url').notNull(),
    timestamp: integer('timestamp').notNull(),
    data: text('data', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  table => ({
    sessionIdx: index('idx_events_session').on(table.sessionId),
    typeIdx: index('idx_events_type').on(table.type),
    timestampIdx: index('idx_events_timestamp').on(table.timestamp),
    sessionTimestampIdx: index('idx_events_session_timestamp').on(
      table.sessionId,
      table.timestamp
    ),
    typeTimestampIdx: index('idx_events_type_timestamp').on(
      table.type,
      table.timestamp
    ),
  })
);

export const replayChunks = sqliteTable(
  'replay_chunks',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    chunkIndex: integer('chunk_index').notNull(),
    r2Key: text('r2_key').notNull(),
    eventCount: integer('event_count').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    startTimestamp: integer('start_timestamp').notNull(),
    endTimestamp: integer('end_timestamp').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  table => ({
    sessionIdx: index('idx_replay_chunks_session').on(table.sessionId),
    sessionChunkIdx: index('idx_replay_chunks_session_chunk').on(
      table.sessionId,
      table.chunkIndex
    ),
  })
);

export const processedSessions = sqliteTable(
  'processed_sessions',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    totalEvents: integer('total_events'),
    totalReplayChunks: integer('total_replay_chunks'),
    totalReplaySizeBytes: integer('total_replay_size_bytes'),
    durationMs: integer('duration_ms'),
    pagesVisited: text('pages_visited', { mode: 'json' }),
    eventTypeCounts: text('event_type_counts', { mode: 'json' }),
    timelineR2Key: text('timeline_r2_key'),
    screenshotCount: integer('screenshot_count').default(0),
    aiSummary: text('ai_summary'),
    aiProcessedAt: integer('ai_processed_at', { mode: 'timestamp' }),
    processedAt: integer('processed_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  table => ({
    sessionIdx: uniqueIndex('idx_processed_sessions_session').on(
      table.sessionId
    ),
    processedAtIdx: index('idx_processed_sessions_processed_at').on(
      table.processedAt
    ),
  })
);

export const sessionScreenshots = sqliteTable(
  'session_screenshots',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    eventType: text('event_type').notNull(),
    eventDescription: text('event_description'),
    timestamp: integer('timestamp').notNull(),
    r2Key: text('r2_key').notNull(),
    sizeBytes: integer('size_bytes'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  table => ({
    sessionIdx: index('idx_session_screenshots_session').on(table.sessionId),
    sessionTimestampIdx: index('idx_session_screenshots_session_timestamp').on(
      table.sessionId,
      table.timestamp
    ),
  })
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type ReplayChunk = typeof replayChunks.$inferSelect;
export type NewReplayChunk = typeof replayChunks.$inferInsert;
export type ProcessedSession = typeof processedSessions.$inferSelect;
export type NewProcessedSession = typeof processedSessions.$inferInsert;
export type SessionScreenshot = typeof sessionScreenshots.$inferSelect;
export type NewSessionScreenshot = typeof sessionScreenshots.$inferInsert;
