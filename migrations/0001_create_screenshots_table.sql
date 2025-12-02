-- Migration: Create screenshots table
-- Created: 2025-12-03

CREATE TABLE IF NOT EXISTS screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  site TEXT NOT NULL,
  hostname TEXT NOT NULL,
  environment TEXT NOT NULL,
  url TEXT NOT NULL,
  user_agent TEXT,
  viewport_width INTEGER,
  viewport_height INTEGER,
  scroll_x INTEGER,
  scroll_y INTEGER,
  file_size INTEGER,
  timestamp INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  date TEXT NOT NULL
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_screenshots_site ON screenshots(site);
CREATE INDEX IF NOT EXISTS idx_screenshots_timestamp ON screenshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_screenshots_date ON screenshots(date);
CREATE INDEX IF NOT EXISTS idx_screenshots_created_at ON screenshots(created_at);
