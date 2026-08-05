-- IVR path tracking migration
-- Run once on the PostgreSQL server:
--   psql -U your_user -d your_db -f migrate_ivr.sql

ALTER TABLE calls ADD COLUMN IF NOT EXISTS ivr_path JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Widen columns that can receive FreeSWITCH UUIDs (36 chars) or longer strings
ALTER TABLE calls ALTER COLUMN vdn       TYPE VARCHAR(64);
ALTER TABLE calls ALTER COLUMN ani       TYPE VARCHAR(64);
ALTER TABLE calls ALTER COLUMN dnis      TYPE VARCHAR(64);
ALTER TABLE calls ALTER COLUMN call_uuid TYPE VARCHAR(64);

-- Index for IVR step queries
CREATE INDEX IF NOT EXISTS idx_calls_ivr_path ON calls USING gin (ivr_path);
