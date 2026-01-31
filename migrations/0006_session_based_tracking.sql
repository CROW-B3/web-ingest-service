-- Drop foreign key constraints and rewrite tables to remove user/project tracking
-- Drop events table (will be recreated without user_id, project_id, anonymous_id)
DROP TABLE `events`;

-- Drop sessions table (will be recreated without user_id, project_id, anonymous_id)
DROP TABLE `sessions`;

-- Drop users table
DROP TABLE `users`;

-- Drop projects table
DROP TABLE `projects`;

-- Recreate sessions table with simplified schema
CREATE TABLE `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  `metadata` text
);

CREATE INDEX `idx_sessions_created` on `sessions` (`created_at`);

-- Recreate events table with simplified schema
CREATE TABLE `events` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `type` text NOT NULL,
  `url` text NOT NULL,
  `timestamp` integer NOT NULL,
  `data` text,
  `created_at` integer NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`)
);

CREATE INDEX `idx_events_session` on `events` (`session_id`);
CREATE INDEX `idx_events_type` on `events` (`type`);
CREATE INDEX `idx_events_timestamp` on `events` (`timestamp`);
CREATE INDEX `idx_events_session_timestamp` on `events` (`session_id`, `timestamp`);
CREATE INDEX `idx_events_type_timestamp` on `events` (`type`, `timestamp`);
