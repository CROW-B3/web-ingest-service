-- Drop old tables to recreate with new schema (data migration would be needed in production)
DROP TABLE IF EXISTS pointer_batches;
DROP TABLE IF EXISTS screenshots;
DROP TABLE IF EXISTS interaction_batches;

-- Create the unified interaction_batches table - stores all common metadata
CREATE TABLE IF NOT EXISTS interaction_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  url TEXT NOT NULL,
  site TEXT NOT NULL,
  hostname TEXT NOT NULL,
  environment TEXT NOT NULL,
  user_agent TEXT,
  batch_start_time INTEGER NOT NULL,
  batch_end_time INTEGER NOT NULL,
  has_screenshot INTEGER DEFAULT 0 NOT NULL,
  has_pointer_data INTEGER DEFAULT 0 NOT NULL,
  created_at INTEGER NOT NULL,
  date TEXT NOT NULL
);

-- Create indexes for interaction_batches
CREATE INDEX idx_interaction_batches_session_id ON interaction_batches(session_id);
CREATE INDEX idx_interaction_batches_date ON interaction_batches(date);
CREATE INDEX idx_interaction_batches_site ON interaction_batches(site);
CREATE INDEX idx_interaction_batches_session_time ON interaction_batches(session_id, batch_start_time);

-- Create screenshots table - only screenshot-specific data
CREATE TABLE IF NOT EXISTS screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES interaction_batches(id),
  r2_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  viewport_width INTEGER,
  viewport_height INTEGER,
  scroll_x INTEGER,
  scroll_y INTEGER,
  file_size INTEGER,
  captured_at INTEGER NOT NULL
);

-- Create indexes for screenshots
CREATE INDEX idx_screenshots_batch_id ON screenshots(batch_id);
CREATE INDEX idx_screenshots_captured_at ON screenshots(captured_at);

-- Create pointer_batches table - only pointer-specific data
CREATE TABLE IF NOT EXISTS pointer_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES interaction_batches(id),
  coordinate_count INTEGER NOT NULL,
  coordinates TEXT NOT NULL
);

-- Create index for pointer_batches
CREATE INDEX idx_pointer_batches_batch_id ON pointer_batches(batch_id);
