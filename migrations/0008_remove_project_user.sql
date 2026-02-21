-- Remove project and user concepts: session-only model
-- SQLite requires table recreation when dropping columns with foreign key constraints

PRAGMA foreign_keys = OFF;

-- Drop indexes that reference removed columns
DROP INDEX IF EXISTS `idx_sessions_project`;
DROP INDEX IF EXISTS `idx_sessions_user`;
DROP INDEX IF EXISTS `idx_events_project`;
DROP INDEX IF EXISTS `idx_events_user`;
DROP INDEX IF EXISTS `idx_events_project_timestamp`;
DROP INDEX IF EXISTS `idx_replay_chunks_project`;
DROP INDEX IF EXISTS `idx_users_project`;
DROP INDEX IF EXISTS `idx_users_anonymous`;

-- Recreate sessions without project_id, user_id, anonymous_id
CREATE TABLE `sessions_new` (
  `id` text PRIMARY KEY NOT NULL,
  `started_at` integer DEFAULT (unixepoch()) NOT NULL,
  `ended_at` integer,
  `duration` integer,
  `referrer` text,
  `initial_url` text,
  `user_agent` text,
  `ip_address` text,
  `country` text,
  `device_type` text,
  `browser` text,
  `os` text,
  `has_replay` integer DEFAULT false NOT NULL,
  `exit_context` text
);
INSERT INTO `sessions_new` SELECT `id`, `started_at`, `ended_at`, `duration`, `referrer`, `initial_url`, `user_agent`, `ip_address`, `country`, `device_type`, `browser`, `os`, `has_replay`, `exit_context` FROM `sessions`;
DROP TABLE `sessions`;
ALTER TABLE `sessions_new` RENAME TO `sessions`;
CREATE INDEX `idx_sessions_started` ON `sessions` (`started_at`);

-- Recreate events without project_id, user_id, anonymous_id
CREATE TABLE `events_new` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`),
  `type` text NOT NULL,
  `url` text NOT NULL,
  `timestamp` integer NOT NULL,
  `data` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL
);
INSERT INTO `events_new` SELECT `id`, `session_id`, `type`, `url`, `timestamp`, `data`, `created_at` FROM `events`;
DROP TABLE `events`;
ALTER TABLE `events_new` RENAME TO `events`;
CREATE INDEX `idx_events_session` ON `events` (`session_id`);
CREATE INDEX `idx_events_type` ON `events` (`type`);
CREATE INDEX `idx_events_timestamp` ON `events` (`timestamp`);
CREATE INDEX `idx_events_session_timestamp` ON `events` (`session_id`, `timestamp`);
CREATE INDEX `idx_events_type_timestamp` ON `events` (`type`, `timestamp`);

-- Recreate replay_chunks without project_id
CREATE TABLE `replay_chunks_new` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `sessions`(`id`),
  `chunk_index` integer NOT NULL,
  `r2_key` text NOT NULL,
  `event_count` integer NOT NULL,
  `size_bytes` integer NOT NULL,
  `start_timestamp` integer NOT NULL,
  `end_timestamp` integer NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL
);
INSERT INTO `replay_chunks_new` SELECT `id`, `session_id`, `chunk_index`, `r2_key`, `event_count`, `size_bytes`, `start_timestamp`, `end_timestamp`, `created_at` FROM `replay_chunks`;
DROP TABLE `replay_chunks`;
ALTER TABLE `replay_chunks_new` RENAME TO `replay_chunks`;
CREATE INDEX `idx_replay_chunks_session` ON `replay_chunks` (`session_id`);
CREATE INDEX `idx_replay_chunks_session_chunk` ON `replay_chunks` (`session_id`, `chunk_index`);

-- Drop users and projects tables
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `projects`;

PRAGMA foreign_keys = ON;
