import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    anonymousId: text('anonymous_id').notNull(),
    firstSeen: integer('first_seen', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    sessionCount: integer('session_count').notNull().default(0),
  },
  table => ({
    projectIdx: index('idx_users_project').on(table.projectId),
    anonymousIdx: index('idx_users_anonymous').on(table.anonymousId),
  })
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    userId: text('user_id').references(() => users.id),
    anonymousId: text('anonymous_id').notNull(),
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
    hasReplay: integer('has_replay', { mode: 'boolean' }).notNull().default(false),
  },
  table => ({
    projectIdx: index('idx_sessions_project').on(table.projectId),
    userIdx: index('idx_sessions_user').on(table.userId),
    startedIdx: index('idx_sessions_started').on(table.startedAt),
  })
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    userId: text('user_id').references(() => users.id),
    anonymousId: text('anonymous_id').notNull(),
    type: text('type').notNull(),
    url: text('url').notNull(),
    timestamp: integer('timestamp').notNull(),
    data: text('data', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  table => ({
    projectIdx: index('idx_events_project').on(table.projectId),
    sessionIdx: index('idx_events_session').on(table.sessionId),
    typeIdx: index('idx_events_type').on(table.type),
    timestampIdx: index('idx_events_timestamp').on(table.timestamp),
    projectTimestampIdx: index('idx_events_project_timestamp').on(
      table.projectId,
      table.timestamp
    ),
    sessionTimestampIdx: index('idx_events_session_timestamp').on(
      table.sessionId,
      table.timestamp
    ),
    typeTimestampIdx: index('idx_events_type_timestamp').on(
      table.type,
      table.timestamp
    ),
    userIdx: index('idx_events_user').on(table.userId),
  })
);

export const replayChunks = sqliteTable(
  'replay_chunks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
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
    projectIdx: index('idx_replay_chunks_project').on(table.projectId),
  })
);

export const sessionMetrics = sqliteTable(
  'session_metrics',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    totalTimeOnSite: integer('total_time_on_site').notNull().default(0),
    totalVisibleTime: integer('total_visible_time').notNull().default(0),
    pageViewCount: integer('page_view_count').notNull().default(0),
    maxScrollDepth: integer('max_scroll_depth').notNull().default(0),
    rageClickCount: integer('rage_click_count').notNull().default(0),
    interactionCount: integer('interaction_count').notNull().default(0),
    hasReplay: integer('has_replay', { mode: 'boolean' }).notNull().default(false),
    lcpMs: integer('lcp_ms'),
    fidMs: integer('fid_ms'),
    cls: integer('cls'),
    fcpMs: integer('fcp_ms'),
    ttfbMs: integer('ttfb_ms'),
    errorCount: integer('error_count').notNull().default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  table => ({
    sessionIdx: uniqueIndex('idx_session_metrics_session').on(table.sessionId),
    projectIdx: index('idx_session_metrics_project').on(table.projectId),
  })
);

export const replayScreenshots = sqliteTable(
  'replay_screenshots',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id),
    r2Key: text('r2_key').notNull(),
    timestamp: integer('timestamp').notNull(),
    eventType: text('event_type').notNull(),
    viewportWidth: integer('viewport_width').notNull(),
    viewportHeight: integer('viewport_height').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  table => ({
    sessionIdx: index('idx_replay_screenshots_session').on(table.sessionId),
    sessionTimestampIdx: index('idx_replay_screenshots_session_timestamp').on(
      table.sessionId,
      table.timestamp
    ),
    projectIdx: index('idx_replay_screenshots_project').on(table.projectId),
  })
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type ReplayChunk = typeof replayChunks.$inferSelect;
export type NewReplayChunk = typeof replayChunks.$inferInsert;
export type SessionMetric = typeof sessionMetrics.$inferSelect;
export type NewSessionMetric = typeof sessionMetrics.$inferInsert;
export type ReplayScreenshot = typeof replayScreenshots.$inferSelect;
export type NewReplayScreenshot = typeof replayScreenshots.$inferInsert;
