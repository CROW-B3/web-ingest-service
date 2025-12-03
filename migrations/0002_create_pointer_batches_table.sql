-- Migration: Create pointer_batches table
-- Description: Stores batched pointer coordinate data from website-hook-sdk
-- Each row represents a 1-second batch of pointer movements

DROP TABLE IF EXISTS pointer_batches;

CREATE TABLE pointer_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Session and page information
  session_id TEXT NOT NULL,
  url TEXT NOT NULL,
  site TEXT,
  hostname TEXT,
  environment TEXT,

  -- Batch timing
  batch_start_time INTEGER NOT NULL,  -- Unix timestamp in milliseconds
  batch_end_time INTEGER NOT NULL,    -- Unix timestamp in milliseconds

  -- Coordinate data
  coordinate_count INTEGER NOT NULL,
  coordinates TEXT NOT NULL,          -- JSON array of PointerCoordinate objects

  -- Metadata
  created_at INTEGER NOT NULL,        -- When record was inserted
  date TEXT NOT NULL                  -- YYYY-MM-DD for partitioning/cleanup
);

-- Indexes for common queries
CREATE INDEX idx_pointer_batches_session_id ON pointer_batches(session_id);
CREATE INDEX idx_pointer_batches_date ON pointer_batches(date);
CREATE INDEX idx_pointer_batches_url ON pointer_batches(url);
CREATE INDEX idx_pointer_batches_site ON pointer_batches(site);
CREATE INDEX idx_pointer_batches_batch_start_time ON pointer_batches(batch_start_time);

-- Composite index for session + time range queries
CREATE INDEX idx_pointer_batches_session_time ON pointer_batches(session_id, batch_start_time);
