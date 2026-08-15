BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users.permissions IS
  'Explicit permissions granted to this user. Admin role implicitly has all permissions. '
  'Supervisor role has only those listed here. Current defined values: view_reports';

COMMIT;
