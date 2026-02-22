-- Add processed_sessions and session_screenshots tables for session replay processing

CREATE TABLE IF NOT EXISTS `processed_sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`),
  `status` text DEFAULT 'pending' NOT NULL,
  `total_events` integer,
  `total_replay_chunks` integer,
  `total_replay_size_bytes` integer,
  `duration_ms` integer,
  `pages_visited` text,
  `event_type_counts` text,
  `timeline_r2_key` text,
  `screenshot_count` integer DEFAULT 0,
  `ai_summary` text,
  `ai_processed_at` integer,
  `processed_at` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `idx_processed_sessions_session` ON `processed_sessions` (`session_id`);
CREATE INDEX IF NOT EXISTS `idx_processed_sessions_status` ON `processed_sessions` (`status`);
CREATE INDEX IF NOT EXISTS `idx_processed_sessions_processed_at` ON `processed_sessions` (`processed_at`);

CREATE TABLE IF NOT EXISTS `session_screenshots` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`),
  `event_type` text NOT NULL,
  `event_description` text,
  `timestamp` integer NOT NULL,
  `r2_key` text NOT NULL,
  `size_bytes` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_session_screenshots_session` ON `session_screenshots` (`session_id`);
CREATE INDEX IF NOT EXISTS `idx_session_screenshots_session_timestamp` ON `session_screenshots` (`session_id`, `timestamp`);
