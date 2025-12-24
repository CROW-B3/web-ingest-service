import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Unified interaction batches table - stores all common metadata
export const interactionBatches = sqliteTable(
  'interaction_batches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    url: text('url').notNull(),
    site: text('site').notNull(),
    hostname: text('hostname').notNull(),
    environment: text('environment').notNull(),
    userAgent: text('user_agent'),
    batchStartTime: integer('batch_start_time').notNull(),
    batchEndTime: integer('batch_end_time').notNull(),
    hasScreenshot: integer('has_screenshot', { mode: 'boolean' })
      .notNull()
      .default(false),
    hasPointerData: integer('has_pointer_data', { mode: 'boolean' })
      .notNull()
      .default(false),
    createdAt: integer('created_at').notNull(),
    date: text('date').notNull(),
  },
  table => [
    index('idx_interaction_batches_session_id').on(table.sessionId),
    index('idx_interaction_batches_date').on(table.date),
    index('idx_interaction_batches_site').on(table.site),
    index('idx_interaction_batches_session_time').on(
      table.sessionId,
      table.batchStartTime
    ),
  ]
);

// Screenshots table - only screenshot-specific data
export const screenshots = sqliteTable(
  'screenshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    batchId: integer('batch_id')
      .notNull()
      .references(() => interactionBatches.id),
    r2Url: text('r2_url').notNull(),
    filename: text('filename').notNull(),
    viewportWidth: integer('viewport_width'),
    viewportHeight: integer('viewport_height'),
    scrollX: integer('scroll_x'),
    scrollY: integer('scroll_y'),
    fileSize: integer('file_size'),
    capturedAt: integer('captured_at').notNull(),
  },
  table => [
    index('idx_screenshots_batch_id').on(table.batchId),
    index('idx_screenshots_captured_at').on(table.capturedAt),
  ]
);

// Pointer batches table - only pointer-specific data
export const pointerBatches = sqliteTable(
  'pointer_batches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    batchId: integer('batch_id')
      .notNull()
      .references(() => interactionBatches.id),
    coordinateCount: integer('coordinate_count').notNull(),
    coordinates: text('coordinates').notNull(), // JSON array of coordinate objects
  },
  table => [index('idx_pointer_batches_batch_id').on(table.batchId)]
);

// Export TypeScript types inferred from schema
export type InteractionBatch = typeof interactionBatches.$inferSelect;
export type NewInteractionBatch = typeof interactionBatches.$inferInsert;

export type Screenshot = typeof screenshots.$inferSelect;
export type NewScreenshot = typeof screenshots.$inferInsert;

export type PointerBatch = typeof pointerBatches.$inferSelect;
export type NewPointerBatch = typeof pointerBatches.$inferInsert;
