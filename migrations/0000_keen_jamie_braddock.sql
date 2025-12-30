CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`session_id` text NOT NULL,
	`user_id` text,
	`anonymous_id` text NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`referrer` text,
	`timestamp` integer NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_project` ON `events` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_events_session` ON `events` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_events_type` ON `events` (`type`);--> statement-breakpoint
CREATE INDEX `idx_events_timestamp` ON `events` (`timestamp`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`api_key` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_api_key_unique` ON `projects` (`api_key`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text,
	`anonymous_id` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ended_at` integer,
	`duration` integer,
	`page_views` integer DEFAULT 0 NOT NULL,
	`interactions` integer DEFAULT 0 NOT NULL,
	`referrer` text,
	`initial_url` text,
	`user_agent` text,
	`ip_address` text,
	`country` text,
	`city` text,
	`device_type` text,
	`browser` text,
	`os` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_project` ON `sessions` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_started` ON `sessions` (`started_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`anonymous_id` text NOT NULL,
	`traits` text DEFAULT '{}' NOT NULL,
	`first_seen` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen` integer DEFAULT (unixepoch()) NOT NULL,
	`session_count` integer DEFAULT 0 NOT NULL,
	`event_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_users_project` ON `users` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_users_anonymous` ON `users` (`anonymous_id`);