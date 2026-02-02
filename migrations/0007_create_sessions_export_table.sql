-- Migration number: 0007 	 2026-02-02T07:02:28.486Z
-- Create sessions export table for tracking completed session exports

CREATE TABLE IF NOT EXISTS sessions_export (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL UNIQUE,
  projectId TEXT,
  userId TEXT,
  eventCount INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  lastActivityAt INTEGER NOT NULL,
  endedAt INTEGER,
  durationMs INTEGER,
  metadata TEXT,
  exportedAt INTEGER DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_sessionId ON sessions_export(sessionId);
CREATE INDEX IF NOT EXISTS idx_sessions_exportedAt ON sessions_export(exportedAt);
