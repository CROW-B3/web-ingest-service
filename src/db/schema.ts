import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    projectId: text('project_id'),
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

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type ReplayChunk = typeof replayChunks.$inferSelect;
export type NewReplayChunk = typeof replayChunks.$inferInsert;
