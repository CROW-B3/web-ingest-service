CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`processed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`event_count` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_idempotency_project` ON `idempotency_keys` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_idempotency_processed` ON `idempotency_keys` (`processed_at`);--> statement-breakpoint
CREATE INDEX `idx_events_project_timestamp` ON `events` (`project_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_session_timestamp` ON `events` (`session_id`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_type_timestamp` ON `events` (`type`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_user` ON `events` (`user_id`);