-- Migration 004: user permissions column
-- Adds an explicit TEXT[] permissions column to the users table.
-- Uses ADD COLUMN IF NOT EXISTS — safe to run on both fresh and existing databases.
--
-- NOTE: No BEGIN/COMMIT in this file. The migration runner wraps every migration
-- in a single transaction. Embedding a nested BEGIN/COMMIT would commit the
-- runner's outer transaction early, breaking atomicity.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users.permissions IS
  'Explicit permissions granted to this user. Admin role implicitly has all permissions. '
  'Supervisor role has only those listed here. Current defined values: view_reports';
