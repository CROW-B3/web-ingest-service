import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const screenshots = sqliteTable(
  'screenshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    r2Url: text('r2_url').notNull(),
    filename: text('filename').notNull(),
    site: text('site').notNull(),
    hostname: text('hostname').notNull(),
    environment: text('environment').notNull(),
    url: text('url').notNull(),
    userAgent: text('user_agent'),
    viewportWidth: integer('viewport_width'),
    viewportHeight: integer('viewport_height'),
    scrollX: integer('scroll_x'),
    scrollY: integer('scroll_y'),
    fileSize: integer('file_size'),
    timestamp: integer('timestamp').notNull(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    date: text('date').notNull(),
  },
  table => [
    index('idx_screenshots_site').on(table.site),
    index('idx_screenshots_timestamp').on(table.timestamp),
    index('idx_screenshots_date').on(table.date),
    index('idx_screenshots_created_at').on(table.createdAt),
  ]
);

export const pointerBatches = sqliteTable(
  'pointer_batches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    url: text('url').notNull(),
    site: text('site'),
    hostname: text('hostname'),
    environment: text('environment'),
    batchStartTime: integer('batch_start_time').notNull(),
    batchEndTime: integer('batch_end_time').notNull(),
    coordinateCount: integer('coordinate_count').notNull(),
    coordinates: text('coordinates').notNull(),
    createdAt: integer('created_at').notNull(),
    date: text('date').notNull(),
  },
  table => [
    index('idx_pointer_batches_session_id').on(table.sessionId),
    index('idx_pointer_batches_date').on(table.date),
    index('idx_pointer_batches_url').on(table.url),
    index('idx_pointer_batches_site').on(table.site),
    index('idx_pointer_batches_batch_start_time').on(table.batchStartTime),
    index('idx_pointer_batches_session_time').on(
      table.sessionId,
      table.batchStartTime
    ),
  ]
);

// Export TypeScript types inferred from schema
export type Screenshot = typeof screenshots.$inferSelect;
export type NewScreenshot = typeof screenshots.$inferInsert;

export type PointerBatch = typeof pointerBatches.$inferSelect;
export type NewPointerBatch = typeof pointerBatches.$inferInsert;
