-- Add has_replay column to sessions table
ALTER TABLE `sessions` ADD `has_replay` integer DEFAULT false NOT NULL;

-- Create replay_chunks table
CREATE TABLE `replay_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`r2_key` text NOT NULL,
	`event_count` integer NOT NULL,
	`size_bytes` integer NOT NULL,
	`start_timestamp` integer NOT NULL,
	`end_timestamp` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `idx_replay_chunks_session` ON `replay_chunks` (`session_id`);
CREATE INDEX `idx_replay_chunks_session_chunk` ON `replay_chunks` (`session_id`,`chunk_index`);
CREATE INDEX `idx_replay_chunks_project` ON `replay_chunks` (`project_id`);

-- Create session_metrics table
CREATE TABLE `session_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`total_time_on_site` integer DEFAULT 0 NOT NULL,
	`total_visible_time` integer DEFAULT 0 NOT NULL,
	`page_view_count` integer DEFAULT 0 NOT NULL,
	`max_scroll_depth` integer DEFAULT 0 NOT NULL,
	`rage_click_count` integer DEFAULT 0 NOT NULL,
	`interaction_count` integer DEFAULT 0 NOT NULL,
	`has_replay` integer DEFAULT false NOT NULL,
	`lcp_ms` integer,
	`fid_ms` integer,
	`cls` integer,
	`fcp_ms` integer,
	`ttfb_ms` integer,
	`error_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE UNIQUE INDEX `idx_session_metrics_session` ON `session_metrics` (`session_id`);
CREATE INDEX `idx_session_metrics_project` ON `session_metrics` (`project_id`);

-- Create replay_screenshots table
CREATE TABLE `replay_screenshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`timestamp` integer NOT NULL,
	`event_type` text NOT NULL,
	`viewport_width` integer NOT NULL,
	`viewport_height` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);

CREATE INDEX `idx_replay_screenshots_session` ON `replay_screenshots` (`session_id`);
CREATE INDEX `idx_replay_screenshots_session_timestamp` ON `replay_screenshots` (`session_id`,`timestamp`);
CREATE INDEX `idx_replay_screenshots_project` ON `replay_screenshots` (`project_id`);
