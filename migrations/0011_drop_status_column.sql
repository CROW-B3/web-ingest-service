-- Drop status column and index from processed_sessions

DROP INDEX IF EXISTS `idx_processed_sessions_status`;
ALTER TABLE `processed_sessions` DROP COLUMN `status`;
