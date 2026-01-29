-- Remove anonymous ID and user tracking logic
-- Convert to session-based tracking model

-- Step 1: Drop user-related indexes and columns from events
DROP INDEX `idx_events_user`;
ALTER TABLE `events` DROP COLUMN `user_id`;
ALTER TABLE `events` DROP COLUMN `anonymous_id`;

-- Step 2: Drop user-related indexes and columns from sessions
DROP INDEX `idx_sessions_user`;
ALTER TABLE `sessions` DROP COLUMN `user_id`;
ALTER TABLE `sessions` DROP COLUMN `anonymous_id`;

-- Step 3: Drop users table entirely
DROP TABLE `users`;
