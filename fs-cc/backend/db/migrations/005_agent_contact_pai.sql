-- ── Phase: Agent Contact PAI Normalization ───────────────────────────────────
-- Every mod_callcenter B-leg that must carry P-Asserted-Identity requires
-- {sip_cid_type=pid} in the agent contact string so sofia auto-generates
-- the PAI header from effective_caller_id_name/number.
--
-- This migration:
--   1. Adds agent_type column (internal | gateway) to track how contacts
--      were provisioned (aids troubleshooting; used by API/UI).
--   2. Infers type from existing contact strings.
--   3. Normalizes all contacts: strips any existing {key=val} prefix blocks
--      and prepends the canonical {sip_cid_type=pid} prefix.
--      Idempotent: contacts already starting with {sip_cid_type=pid} are
--      left unchanged by the WHERE guard.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add agent_type column ----------------------------------------------------
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS agent_type VARCHAR(16) NOT NULL DEFAULT 'gateway'
  CHECK (agent_type IN ('internal', 'gateway'));

-- 2. Infer type from existing contact string -----------------------------------
--    Contacts matching user/<digits>@ are internal SIP registrations.
--    Everything else (sofia/gateway/...) is gateway.
UPDATE agents
SET    agent_type = 'internal'
WHERE  contact ~ 'user/[0-9]+@'
   OR  contact ~ '\{[^}]*\}user/[0-9]+@';

-- 3. Normalize contacts -------------------------------------------------------
--    Strip ALL leading {key=value} blocks (any number, any keys), then prepend
--    the canonical {sip_cid_type=pid} block.
--    The regex (\{[^}]*\})* matches zero or more {…} prefix groups.
--    WHERE guard: skip rows that already carry the correct prefix exactly.
UPDATE agents
SET    contact = '{sip_cid_type=pid}' || regexp_replace(contact, '^(\{[^}]*\})*', '')
WHERE  contact NOT LIKE '{sip_cid_type=pid}%';
