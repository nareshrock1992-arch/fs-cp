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
