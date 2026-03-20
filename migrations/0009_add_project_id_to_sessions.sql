-- Add project_id column to sessions table for organization scoping
ALTER TABLE `sessions` ADD COLUMN `project_id` TEXT;

-- Create index for project_id lookups
CREATE INDEX IF NOT EXISTS `idx_sessions_project_id` ON `sessions`(`project_id`);
