-- Add export tracking fields to sessions table
ALTER TABLE `sessions` ADD COLUMN `exported_to_interaction_service` INTEGER DEFAULT 0 NOT NULL;
ALTER TABLE `sessions` ADD COLUMN `exported_at` INTEGER;

-- Create index for exported sessions
CREATE INDEX IF NOT EXISTS `idx_sessions_exported` ON `sessions`(`exported_to_interaction_service`);

-- Create rrweb_snapshots table for session replay data
CREATE TABLE IF NOT EXISTS `rrweb_snapshots` (
  `id` TEXT PRIMARY KEY NOT NULL,
  `session_id` TEXT NOT NULL REFERENCES `sessions`(`id`),
  `timestamp` INTEGER NOT NULL,
  `event_type` TEXT NOT NULL,
  `data` TEXT NOT NULL,
  `compressed` INTEGER DEFAULT 0 NOT NULL,
  `created_at` INTEGER DEFAULT (unixepoch()) NOT NULL
);

-- Create indexes for rrweb_snapshots
CREATE INDEX IF NOT EXISTS `idx_rrweb_session` ON `rrweb_snapshots`(`session_id`);
CREATE INDEX IF NOT EXISTS `idx_rrweb_timestamp` ON `rrweb_snapshots`(`timestamp`);
