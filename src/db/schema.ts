import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
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
  },
  table => ({
    projectIdx: index('idx_sessions_project').on(table.projectId),
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
    type: text('type').notNull(),
    url: text('url').notNull(),
    timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
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
  })
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
