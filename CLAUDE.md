# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Role — Integration and Deployment ONLY

**fs-cp is NOT an application-development repository.**

fs-cp exists solely to:

- Integrate the ENRS application (from `fs-enrs`) and the Contact Center application (from `fs-cc`)
- Build production Docker images
- Maintain Docker Compose orchestration
- Maintain Nginx production configuration
- Maintain deployment scripts and production environment templates
- Run integration tests against the combined system

## Authoritative Sources

| Code | Authoritative Repository |
|---|---|
| ENRS application (backend, frontend, migrations, tests) | **fs-enrs** |
| Contact Center application (backend, frontend, migrations, tests) | **fs-cc** |
| Docker Compose, Nginx, deployment scripts, integration env | **fs-cp** (here) |

## Non-Negotiable Rules

1. **Never edit ENRS application code here.** If a bug is found in `fs-cp/fs-enrs/`, fix it in `fs-enrs`, commit it there, then sync it here.
2. **Never edit CC application code here.** If a bug is found in `fs-cp/fs-cc/`, fix it in `fs-cc`, commit it there, then sync it here.
3. **Never copy fs-cp application code back into fs-enrs or fs-cc.** The flow is one-way: source repos → fs-cp.
4. **Never assume fs-cp is the authoritative version of any application file.** fs-enrs and fs-cc always win for their own code.

## Direction of Flow

```
fs-enrs  ────────────────► fs-cp/fs-enrs   (development → integration)
fs-cc    ────────────────► fs-cp/fs-cc     (development → integration)
```

This direction is never reversed automatically.

## What Belongs Here (fs-cp authoritative)

- `deploy/docker-compose.yml`
- `deploy/.env.example`
- `deploy/nginx/`
- `deploy/scripts/`
- `fs-enrs/backend/Dockerfile` (production build configuration only — application code inside comes from fs-enrs)
- `fs-cc/backend/Dockerfile` (production build configuration only)
- Integration routing configuration

## Drift Protocol

If working tree differs from committed HEAD:

1. Classify every difference as APPLICATION CODE (not yours) or DEPLOYMENT/INTEGRATION CONFIG (yours).
2. For application code differences: determine which source repo is authoritative. Do not resolve by editing here.
3. For deployment config differences: these are fs-cp-authoritative. Commit them here.
4. Never overwrite deployment config by blindly syncing from source repos.

## Integration Sequence

Only after source repos (`fs-enrs`, `fs-cc`) are verified, tested, and committed:

1. Copy fs-enrs HEAD into `fs-cp/fs-enrs/`
2. Copy fs-cc HEAD into `fs-cp/fs-cc/`
3. Preserve all deployment files in `deploy/`, `fs-enrs/backend/Dockerfile`, `fs-cc/backend/Dockerfile`
4. Commit the integration update
5. Build Docker images
6. Run integration tests

## Commands

```bash
# Integration build
cd deploy && docker compose build

# Start integrated system
cd deploy && docker compose up -d

# View logs
docker compose logs -f enrs-backend
docker compose logs -f cc-backend

# Stop
cd deploy && docker compose down
```

## Phase Protocol

Any multi-repo task must proceed in phases. Stop at the end of each phase and wait for explicit approval before continuing.

See `fs-enrs/GOVERNANCE.md` — Multi-Repository Governance section for the full phase protocol.

---

## Chosen Integration Method — Plain-Copy Embed (deliberate)

fs-cp embeds **plain-copy subsets** of the authoritative repos at `fs-cp/fs-enrs/` and
`fs-cp/fs-cc/`, and builds production images from those contexts via
`deploy/docker-compose.yml`. This was chosen over git submodules for simplicity; the
trade-off is that **every authoritative change must be re-synced** into fs-cp. To keep that
cheap and safe, always sync with the reusable command below — never by hand.

**Authoritative HEAD always wins** over the embedded copy and over any previous sync report
or commit message. Verify by **content** (LF-normalized git blob compare), never by commit
message. (Real incidents have shown the embed silently drifting phases behind, and a
commit message claiming a sync that did not fully happen.)

## Reusable Claude Commands (type one line instead of a long prompt)

- **`/sync-fscp`** — governed sync of fs-cp with current fs-cc/fs-enrs HEAD: read-first,
  LF-identical copy of the coherent feature set, preserves fs-cp-local files, wires new env
  vars, runs the authoritative test suite, and STOPS before commit. Add a note when useful,
  e.g. `/sync-fscp new STT service in fs-enrs/services/stt` or `/sync-fscp build images too`.
- **`/verify-fscp`** — READ-ONLY forensic compare of each embed vs its authoritative HEAD
  (no changes). Run it before a sync to preview the delta, or after to confirm in-sync.

They live in `.claude/commands/` and encode the rules in this file + `FS-CP-GOVERNANCE.md`,
so the guardrails apply without re-typing them. Update the rules here/in the governance doc
and the commands inherit them.

## Preserve-List — fs-cp-local files a sync must NEVER overwrite or delete

Evidence-based, from real syncs. A sync updates application source only; these stay:

- `deploy/**` — `docker-compose.yml`, `.env.example`, `nginx/`, `scripts/`, `ssl/`
  (`deploy/.env` is git-ignored, local secrets — never printed or committed)
- `fs-cc/backend/Dockerfile`, `fs-cc/backend/docker-entrypoint.sh`,
  `fs-cc/backend/scripts/{migrate.js,seed-initial-admin.js}`
- `fs-enrs/backend/Dockerfile`, `fs-enrs/services/piper/Dockerfile`,
  `fs-enrs/backend/src/infrastructure/config/validator.js` (fs-cp-local deployment validator)
- every `*/.env` and `*/.env.*` (secrets stay local; only `.env.example` is the tracked template)
- **Any file present in fs-cp but absent from the authoritative repo** → investigate;
  default to PRESERVE and report it.

## Environment-Variable Wiring Rule

When an authoritative change adds a **consumed** env/config var (a service URL, model path,
feature flag, a required setting like `BUSINESS_TIMEZONE`), it must be traced end-to-end and
wired here:

```
Docker/compose environment:  →  process env  →  backend config loader  →  business logic
```

- Add it to the service's `environment:` block in `deploy/docker-compose.yml`.
- Document it (with a safe placeholder — NEVER a real secret) in `deploy/.env.example`.
- A backend that fail-fasts on a missing required var will **crash-loop** at deploy time if
  this wiring is skipped. This is the most common "it built but won't start" cause.

## New Component / Feature Playbook (future-proofing: TTS, STT, AI agents, new services)

Any new capability added upstream reaches production the same, mechanical way — no special
casing:

1. **Author + test it in the authoritative repo first** (fs-enrs or fs-cc), commit there.
   fs-cp is never where a feature is written.
2. **Promote the coherent set** via `/sync-fscp` — not just the obvious file: backend +
   frontend + routes + services + migrations + config + package.json/lock + tests, as one unit.
3. **New env/config vars** → follow the Environment-Variable Wiring Rule above.
4. **A new standalone service** (like Piper — e.g. a future STT or AI-agent service): it
   needs its own compose service + a Dockerfile whose build context lives in the
   authoritative repo (e.g. `fs-enrs/services/<name>`), a network entry, a healthcheck, and
   — if other containers call it — the **dual-URL pattern** from `FS-CP-GOVERNANCE.md` §5/§14
   (container-network URL for in-Docker callers, host URL for PM2/dev). Reuse that pattern;
   do not invent a new one, and do not resurrect obsolete variable names.
5. **Database changes** ride along as migrations from the authoritative repo (applied by the
   backend's entrypoint/migration runner). fs-cp authors no migrations of its own.
6. **Never**: author schema/migrations in fs-cp, commit real secrets, redesign the Docker
   architecture, edit app code in fs-cp, or reverse the source → fs-cp flow.

To keep promotion mechanical as the platform grows, design upstream features to be
**config-driven** (no hardcoded IPs/paths/secrets), **self-contained** (a service owns its
Dockerfile in its own repo), and **self-documenting** (add a matching `.env.example` entry
whenever you introduce a consumed variable).
