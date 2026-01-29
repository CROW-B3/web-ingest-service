ALTER TABLE `sessions` DROP COLUMN `page_views`;--> statement-breakpoint
ALTER TABLE `sessions` DROP COLUMN `interactions`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `last_seen`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `event_count`;