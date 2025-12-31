import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Projects table - stores project configurations
 */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain').notNull(),
  apiKey: text('api_key').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  settings: text('settings', { mode: 'json' })
    .notNull()
    .default(sql`'{}'`),
});

/**
 * Users table - stores user information
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    anonymousId: text('anonymous_id').notNull(),
    traits: text('traits', { mode: 'json' })
      .notNull()
      .default(sql`'{}'`),
    firstSeen: integer('first_seen', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    lastSeen: integer('last_seen', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    sessionCount: integer('session_count').notNull().default(0),
    eventCount: integer('event_count').notNull().default(0),
  },
  table => ({
    projectIdx: index('idx_users_project').on(table.projectId),
    anonymousIdx: index('idx_users_anonymous').on(table.anonymousId),
  })
);

/**
 * Sessions table - stores user session data
 */
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
    duration: integer('duration'), // in milliseconds
    pageViews: integer('page_views').notNull().default(0),
    interactions: integer('interactions').notNull().default(0),
    referrer: text('referrer'),
    initialUrl: text('initial_url'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    country: text('country'),
    city: text('city'),
    deviceType: text('device_type'),
    browser: text('browser'),
    os: text('os'),
  },
  table => ({
    projectIdx: index('idx_sessions_project').on(table.projectId),
    userIdx: index('idx_sessions_user').on(table.userId),
    startedIdx: index('idx_sessions_started').on(table.startedAt),
  })
);

/**
 * Events table - stores all captured events
 */
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
    type: text('type').notNull(), // pageview, click, form, custom, etc.
    url: text('url').notNull(),
    referrer: text('referrer'),
    timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
    data: text('data', { mode: 'json' }), // JSON event data
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  table => ({
    // Single column indexes
    projectIdx: index('idx_events_project').on(table.projectId),
    sessionIdx: index('idx_events_session').on(table.sessionId),
    typeIdx: index('idx_events_type').on(table.type),
    timestampIdx: index('idx_events_timestamp').on(table.timestamp),
    // Composite indexes for common query patterns
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

/**
 * Idempotency keys table - prevents duplicate batch processing
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(), // The idempotency key from the request
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    processedAt: integer('processed_at', { mode: 'timestamp' })
      .notNull()
      .default(sql`(unixepoch())`),
    eventCount: integer('event_count').notNull(), // Number of events in the batch
  },
  table => ({
    projectIdx: index('idx_idempotency_project').on(table.projectId),
    processedIdx: index('idx_idempotency_processed').on(table.processedAt),
  })
);

// Type exports for TypeScript
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
