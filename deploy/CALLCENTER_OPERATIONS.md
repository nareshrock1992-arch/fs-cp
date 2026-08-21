# Callcenter Operations Guide

Production deployment, agent provisioning, PAI verification, and troubleshooting
reference for the **fs-cc Contact Center** application integrated with
**FreeSWITCH mod_callcenter** and **Avaya Session Manager**.

**Repos:** fs-cc · fs-cp · fs-enrs  
**FreeSWITCH:** mod_callcenter + mod_sofia + mod_event_socket  
**Audience:** Operations / Platform Engineers

---

## A — System Architecture & Ownership

### Call identity flow

```
Inbound PSTN / SIP call
  ↓  caller_id_name + caller_id_number set on A-leg
fs-enrs — IVR / call flow (fs-enrs owns this)
  ↓  callcenter support@default (cc.xml dialplan)
FreeSWITCH mod_callcenter — queue + agent dispatch
  ↓  mod_callcenter copies A-leg identity → B-leg effective_caller_id_*
fs-cc — agent provisioning (fs-cc owns agent contacts)
  ↓  PostgreSQL agents table (source of truth)
  ↓  startup: pushToFreeSWITCH() → callcenter_config agent set contact
FreeSWITCH mod_sofia — B-leg INVITE generation
  ↓  {sip_cid_type=pid} triggers PAI auto-generation
SIP INVITE to Avaya agent
  ↓  P-Asserted-Identity: "Caller Name" <sip:CALLER_NUM@DOMAIN>
Avaya Session Manager → Agent display
```

### Repository ownership

| Repository | Owns | Does NOT own |
|------------|------|-------------|
| `fs-enrs` | IVR flow, ENS/ERS originate paths, IVR → callcenter handoff (cc.xml) | Agent CRUD, callcenter provisioning |
| `fs-cc` | Agents, queues, tiers (PostgreSQL), ESL provisioning, agent contact contract, admin UI | IVR flow, ENS/ERS |
| `fs-cp` | Docker Compose deployment, env configuration, Nginx, PostgreSQL init, migration orchestration | Business logic |

> **CRITICAL:** Agent contact strings — including the `{sip_cid_type=pid}` PAI prefix — are
> the exclusive responsibility of **fs-cc**. Do not implement agent provisioning in fs-enrs.
> Do not manually edit FreeSWITCH `callcenter.db` as a permanent fix — PostgreSQL is the
> source of truth.

---

## B — Required FreeSWITCH Modules

| Module | Purpose | Status |
|--------|---------|--------|
| `mod_sofia` | SIP stack — generates B-leg INVITE, reads `sip_cid_type`, emits `P-Asserted-Identity` | REQUIRED |
| `mod_callcenter` | Queue engine — dispatches agents, copies A-leg identity to B-leg effective CID | REQUIRED |
| `mod_event_socket` | ESL — fs-cc backend connects on port 8021 to provision agents and receive events | REQUIRED |
| `mod_lua` | Lua scripting for IVR flow execution (fs-enrs) | REQUIRED |

```bash
# Verify modules are loaded
fs_cli> module_exists mod_sofia
true
fs_cli> module_exists mod_callcenter
true
fs_cli> module_exists mod_event_socket
true
```

---

## C — Required Network Connectivity

| From | To | Port / Protocol | Purpose |
|------|----|-----------------|---------|
| fs-cc backend container | FreeSWITCH | TCP 8021 | ESL — agent provisioning + event stream |
| FreeSWITCH | Avaya Session Manager | UDP/TCP 5060 (or 5080 ext) | SIP signaling — B-leg INVITE to agents |
| FreeSWITCH | Agent SIP endpoints | UDP/TCP 5060 + RTP 16384–32767 | SIP + media |
| Docker containers | PostgreSQL | TCP 5432 | fs-cc DB access |

> **Firewall:** RTP ports (16384–32767) must be open bidirectionally between FreeSWITCH and
> every SIP endpoint. A firewall blocking RTP causes one-way or silent audio even when SIP
> signaling succeeds.

---

## D — Sofia Profile Configuration

### Internal profile (agent registrations)

```bash
fs_cli> sofia status profile internal
Name         internal
Data         sip:mod_sofia@<YOUR-SERVER-IP>:5060;transport=udp
State        RUNNING
```

### External / Gateway profile (Avaya SM)

| Parameter | Value | Required | Effect |
|-----------|-------|----------|--------|
| `caller-id-in-from` | `false` | YES | FreeSWITCH puts "FreeSWITCH" in From URI; forces Avaya SM to read caller identity from PAI |
| `extension-in-contact` | `true` | Recommended | Puts agent extension in Contact URI |
| `proxy` | `<AVAYA-SM-IP>:5080` | YES | Avaya SM address |
| `register` | `false` | YES | Gateway does not register — SM trusts FS as NOREG peer |
| `sip_cid_type` on gateway level | (not set) | DO NOT SET | Set only in agent contact string — not at profile level |

```xml
<!-- sip_profiles/external/service-provider.xml -->
<include>
  <gateway name="service-provider">
    <param name="proxy"              value="<AVAYA-SM-IP>:5080"/>
    <param name="register"           value="false"/>
    <param name="caller-id-in-from"  value="false"/>
    <param name="extension-in-contact" value="true"/>
  </gateway>
</include>
```

```bash
fs_cli> sofia status gateway service-provider
Name        service-provider
Profile     external
State       NOREG
```

---

## E — Avaya Session Manager Configuration

| Avaya SM Setting | Required Value |
|-----------------|----------------|
| Trust PAI header from FreeSWITCH | Enabled (trusted domain / SIP entity) |
| Send caller ID from From URI | Disabled (use PAI instead) |
| FreeSWITCH as SIP Entity | Entity type: SIP Trunk |
| Transport | UDP or TCP (match FreeSWITCH gateway) |
| NOREG / trusted | No registration required from FS |

> **Why PAI is required:** When `caller-id-in-from=false`, FreeSWITCH replaces the From URI
> user-part with "FreeSWITCH". Avaya SM sees `From: "FreeSWITCH" <sip:FreeSWITCH@…>` and
> cannot derive caller identity from it. Setting `{sip_cid_type=pid}` on the agent contact
> causes sofia to auto-generate `P-Asserted-Identity` from the channel's
> `effective_caller_id_name/number`, which Avaya SM reads instead.

---

## F — IVR → Callcenter Handoff Dialplan

```xml
<!-- deploy/freeswitch/dialplan/default/cc.xml -->
<extension name="callcenter-support">
  <condition field="destination_number" expression="^2020$">
    <action application="answer"/>
    <action application="callcenter" data="support@default"/>
  </condition>
</extension>
```

No caller-ID modification occurs at this handoff. The A-leg carries `caller_id_name` and
`caller_id_number` set by the IVR Lua script. `mod_callcenter` automatically copies these to
the B-leg's `effective_caller_id_name/number` when it originates the agent call.

---

## G — SIP Domain Configuration

The SIP domain is the IP or FQDN of the FreeSWITCH internal SIP profile.

### Variable chain

```
fs-cp/deploy/.env  →  SIP_DOMAIN=<FREESWITCH-IP>
  →  docker-compose.yml  FS_SIP_DOMAIN: ${SIP_DOMAIN}
  →  cc-backend container env: FS_SIP_DOMAIN
  →  config.fs.sipDomain
  →  buildContact()
  →  agents.contact in PostgreSQL
  →  startup pushToFreeSWITCH()
  →  FreeSWITCH callcenter_config agent set contact
  →  B-leg originate → PAI
```

### Variable locations

| Layer | Variable | Dev value | Prod value |
|-------|----------|-----------|-----------|
| `fs-cp/deploy/.env` | `SIP_DOMAIN` | Tailscale IP of FS | Production FS LAN IP or FQDN |
| `docker-compose.yml` (cc-backend env) | `FS_SIP_DOMAIN: ${SIP_DOMAIN}` | (propagated) | (propagated) |
| `fs-cc/backend/.env` (dev only) | `FS_SIP_DOMAIN` | dev IP | N/A — set by fs-cp in prod |

> **Never hardcode IP addresses** (`192.168.1.133`, `<DEV_SIP_IP>`, or any other) in source
> code. All IPs flow from `SIP_DOMAIN` in `fs-cp/deploy/.env`.

---

## H — Callcenter Queue Setup

Queues are managed via the fs-cc admin UI. Key parameters:

| Parameter | Recommended | Notes |
|-----------|-------------|-------|
| Strategy | `longest-idle-agent` | Routes to the longest-idle agent |
| Max Wait Time | `300` (seconds) | 0 = unlimited |
| MOH Sound | `local_stream://moh` | Music on hold |
| Agent No-Answer Status | `On Break` | Prevents immediate re-ring on missed call |

```bash
fs_cli> callcenter_config queue list
name|strategy|moh-sound|...
support@default|longest-idle-agent|local_stream://moh|...
```

---

## I — Agent Setup — Production Procedure

Agents are configured via the fs-cc admin UI. The backend builds the complete FreeSWITCH
contact string automatically, including the mandatory `{sip_cid_type=pid}` prefix.

### Internal SIP agent (registered extension)

Admin enters:
- Endpoint Type: **Internal (SIP extension)**
- Extension: `1002`

System generates:
```
{sip_cid_type=pid}user/1002@<FS_SIP_DOMAIN>
```

### Gateway agent (SIP trunk routing)

Admin enters:
- Endpoint Type: **Gateway (SIP trunk)**
- Gateway Name: `service-provider`
- Destination: `0507221769`

System generates:
```
{sip_cid_type=pid}sofia/gateway/service-provider/0507221769
```

### Agent parameters

| Parameter | Default | Notes |
|-----------|---------|-------|
| Max No Answer | 3 | Calls before agent goes On Break |
| Wrap-up Time | 20s | ACW before next call |
| Reject Delay | 2s | Retry delay after agent rejects |
| Busy Delay | 60s | Retry delay when agent line busy |

---

## J — The Agent Contact PAI Contract

> **Invariant:** Every agent contact stored in PostgreSQL and provisioned to FreeSWITCH
> MUST begin with `{sip_cid_type=pid}`. This is enforced server-side by `buildContact()` in
> `fs-cc/backend/controllers/agentsController.js` and normalized for existing data by
> migration `005_agent_contact_pai.sql`.

### Why this prefix is required

`mod_callcenter` creates a fresh B-leg originate for each agent. It does NOT copy A-leg
`sip_h_*` channel variables to the B-leg. The only way to inject variables into the B-leg
originate is the `{vars}` prefix in the agent contact string. When `{sip_cid_type=pid}` is
present, sofia auto-generates `P-Asserted-Identity` from `effective_caller_id_name/number`.

### buildContact() behavior

| Input | Output |
|-------|--------|
| `agentType=internal, extension=1002` | `{sip_cid_type=pid}user/1002@<FS_SIP_DOMAIN>` |
| `agentType=gateway, gateway=service-provider, destination=0507221769` | `{sip_cid_type=pid}sofia/gateway/service-provider/0507221769` |
| `contact=user/1002@192.168.1.133` (legacy raw) | `{sip_cid_type=pid}user/1002@192.168.1.133` |
| `contact={sip_cid_type=pid}user/1002@domain` (already prefixed) | `{sip_cid_type=pid}user/1002@domain` (idempotent) |
| `contact={old=val}user/1002@domain` (wrong prefix) | `{sip_cid_type=pid}user/1002@domain` (normalized) |

---

## K — FreeSWITCH Runtime Verification

```bash
# List all agents and their contacts
fs_cli> callcenter_config agent list
name|type|contact|status|state|...
Agent_1002|callback|{sip_cid_type=pid}user/1002@<DOMAIN>|Logged Out|...

# Every contact must contain {sip_cid_type=pid}

# Tier and queue membership
fs_cli> callcenter_config tier list
queue|agent|state|level|position
support@default|Agent_1002|Ready|1|1

# Agent SIP registration
fs_cli> sofia status profile internal reg
User: 1002@<DOMAIN>
Contact: "1002" <sip:1002@<AGENT-IP>:5060;...>
```

---

## L — PostgreSQL Verification

```sql
-- Connect: psql -U fs_cc_user -d fs_cc

-- Check all agent contacts
SELECT agent_id, agent_type, contact, active
FROM   agents
ORDER  BY agent_id;

-- Verify all active agents have the PAI prefix
-- This query should return 0 rows in a correctly provisioned system
SELECT agent_id, contact
FROM   agents
WHERE  active = true
  AND  contact NOT LIKE '{sip_cid_type=pid}%';
```

> If the query returns rows: **do not manually update the database**. Run migration
> `005_agent_contact_pai.sql` (it is idempotent), then restart fs-cc so
> `pushToFreeSWITCH()` reprojects the corrected contacts.

---

## M — SIP Trace & PAI Verification

```bash
# Enable SIP tracing
fs_cli> sofia global siptrace on

# Disable after test
fs_cli> sofia global siptrace off
```

### Expected INVITE structure

```
INVITE sip:1002@<AGENT-IP>:5060 SIP/2.0
From: "FreeSWITCH" <sip:FreeSWITCH@<FS-IP>>;tag=...
To: <sip:1002@<DOMAIN>>
P-Asserted-Identity: "Caller Name" <sip:0501234567@<DOMAIN>>
Remote-Party-ID: "Caller Name" <sip:0501234567@<DOMAIN>>;party=calling;...
```

### PAI values to verify

| Header field | Expected value |
|-------------|----------------|
| Display name | Original caller's name (from IVR A-leg) |
| SIP URI user-part | Original caller's number (E.164) |
| SIP URI domain | FreeSWITCH SIP domain (`FS_SIP_DOMAIN`) |
| Header count | Exactly 1 PAI header |

---

## N — Restart & Recovery Behavior

| Event | fs-cc behavior | Expected outcome |
|-------|---------------|-----------------|
| fs-cc restart | `runStartupSequence()` → `pushToFreeSWITCH()` reads PostgreSQL → pushes contacts to FS | All contacts restored with `{sip_cid_type=pid}` |
| FreeSWITCH restart | fs-cc ESL reconnects → `runStartupSequence()` runs again | All contacts restored |
| Container recreation | New container starts, runs startup sequence from PostgreSQL | All contacts restored |
| Full platform redeploy (`docker compose up`) | Containers recreated; each runs startup sequence | Agents fully restored from PostgreSQL |

> **`callcenter.db` is ephemeral by design.** FreeSWITCH's SQLite file is a runtime cache,
> always rebuilt from PostgreSQL on fs-cc startup. Never restore from a backup of it.

---

## O — Troubleshooting Matrix

| Symptom | Cause | Diagnosis | Fix |
|---------|-------|-----------|-----|
| PAI absent from B-leg INVITE | `{sip_cid_type=pid}` missing from agent contact | `callcenter_config agent list` — contact does not start with prefix | Run migration 005; restart fs-cc |
| PAI duplicated (appears twice) | Both gateway profile AND contact string have `sip_cid_type=pid` | Check gateway XML for `sip_cid_type` | Remove from gateway XML; keep only in agent contact |
| PAI shows wrong number | A-leg `effective_caller_id_number` wrong before entering queue | Check FS log for `Caller-Orig-Caller-ID-Number` at queue entry | Fix caller identity in IVR Lua script |
| PAI shows "FreeSWITCH" | `effective_caller_id_name` not set on A-leg | Log A-leg before queue entry | Set caller name in IVR flow |
| Avaya shows DID/trigger number | Avaya SM not reading PAI; reading From URI instead | Check if SM entity is configured to trust PAI from FreeSWITCH | Enable PAI trust on Avaya SM SIP entity |
| Agent does not ring | Agent not Available, not in tier, or SIP not registered | `callcenter_config agent list`; `sofia status profile internal reg` | Set agent Available; verify SIP registration |
| Works until fs-cc restart | PostgreSQL contacts lack prefix — manual `callcenter.db` fix was applied | `SELECT contact FROM agents WHERE active=true` | Run migration 005; restart fs-cc |
| FS_SIP_DOMAIN not configured | `FS_SIP_DOMAIN` env var is empty | Check cc-backend logs; check docker-compose env section | Set `SIP_DOMAIN` in `deploy/.env`; redeploy |
| ENS regression — ENS PAI wrong | ENS uses explicit `sip_h_P-Asserted-Identity` in eslService.js — independent of callcenter | Check `fs-enrs/backend/src/services/eslService.js` `originateCampaignCall()` | Do not modify ENS ESL path; verify `SIP_DOMAIN` in ENRS container |

---

## P — Backup & Recovery

### PostgreSQL (authoritative source of truth)

```bash
# Backup
pg_dump -U fs_cc_user -d fs_cc -F c -f /backup/fs_cc_$(date +%Y%m%d).dump

# Restore
pg_restore -U fs_cc_user -d fs_cc -F c /backup/fs_cc_YYYYMMDD.dump
```

### fs-cp deploy/.env

Contains all production secrets and configuration. Store in a secrets manager or encrypted
vault — excluded from git by design. Losing this file requires regenerating all secrets.

### Do NOT back up or restore callcenter.db

FreeSWITCH's `callcenter.db` SQLite file is rebuilt from PostgreSQL on every fs-cc startup.
Restoring an old backup is counterproductive — it will be overwritten at next startup.

---

## Q — Production Acceptance Checklist

Complete before declaring the callcenter ready for production traffic.

**Platform**
- [ ] fs-cc backend healthy — `GET /api/health` returns 200
- [ ] PostgreSQL healthy — fs-cc backend logs show DB connected
- [ ] FreeSWITCH healthy — `fs_cli -x status` returns READY
- [ ] mod_callcenter loaded — `module_exists mod_callcenter` returns true
- [ ] Sofia internal profile RUNNING
- [ ] Gateway NOREG — `sofia status gateway service-provider` → State: NOREG

**Agent provisioning**
- [ ] Agent SIP registered — `sofia status profile internal reg` shows agent extension
- [ ] Agent Available in admin UI — green lamp
- [ ] Agent assigned to queue tier — `callcenter_config tier list` shows agent in queue
- [ ] PostgreSQL contact correct — all active agents start with `{sip_cid_type=pid}`
- [ ] FS runtime contact correct — `callcenter_config agent list` all contacts contain prefix

**End-to-end call test**
- [ ] Inbound call enters queue — verify in fs-cc Live Calls dashboard
- [ ] Agent rings
- [ ] PAI present in B-leg INVITE — enable siptrace; verify `P-Asserted-Identity` header
- [ ] PAI appears exactly once — no duplicate PAI headers
- [ ] PAI number correct — matches original caller's number, not DID/trigger
- [ ] PAI name correct — matches caller name from IVR flow
- [ ] Avaya agent display correct — agent phone shows caller name and number

**Regression**
- [ ] ENS regression clean — ENS test call; verify ENS PAI unchanged
- [ ] ERS regression clean — ERS test incident; verify responder ring unchanged
- [ ] Restart survival verified — restart fs-cc; wait 30s; re-verify FS contacts
- [ ] Full redeploy verified — `docker compose down && docker compose up -d`; re-verify

> **Acceptance verdict:** All boxes checked → READY FOR PRODUCTION.
> Any unchecked item → resolve and retest from that item forward.
