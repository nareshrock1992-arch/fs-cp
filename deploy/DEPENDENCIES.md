# Omni Platform — Dependency Reference

Air-gapped deployment dependency audit. Every entry is traced to specific
source files. Do not add packages without re-running the audit.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  HOST OS (physical or VM)                                   │
│                                                             │
│  ┌────────────────────┐   ┌─────────────────────────────┐  │
│  │  FreeSWITCH        │   │  Docker Engine               │  │
│  │  (native process)  │   │                              │  │
│  │                    │   │  ┌──────────────────────┐    │  │
│  │  Lua scripts       │   │  │  enrs-backend :4100  │    │  │
│  │  io.popen(curl …)──┼───┼─▶│  (Node.js/Alpine)    │    │  │
│  │                    │   │  └──────────────────────┘    │  │
│  │  ESL :8021 ────────┼───┼─▶│  cc-backend   :4000  │    │  │
│  └────────────────────┘   │  └──────────────────────┘    │  │
│           ▲               │  ┌──────────────────────┐    │  │
│           │               │  │  postgres  :5432     │    │  │
│           │               │  │  redis     :6379     │    │  │
│           │               │  │  nginx     :80/:443  │    │  │
│  curl (HOST) satisfies    │  │  *-frontend (nginx)  │    │  │
│  Lua's HTTP calls.        │  └──────────────────────┘    │  │
│                           └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### CRITICAL DISTINCTION — curl on HOST vs curl in container

FreeSWITCH runs on the **HOST OS**. Lua scripts execute inside FreeSWITCH.
Every Lua HTTP call is:

```
FreeSWITCH (host process) → Lua → io.popen("curl …") → HOST OS curl
```

The `enrs-backend` Docker container also has `curl` installed (required by
`diagnosticsService.js`). **These are two completely independent dependencies.**
curl inside the Docker image does NOT satisfy Lua's curl requirement, and
curl on the host does NOT satisfy the diagnostics endpoint's curl check.

---

## A. Dependencies inside Docker images

### enrs-backend (node:20-alpine)

| Package | Source | Why |
|---------|--------|-----|
| tini    | `apk add` in Dockerfile | Correct PID-1 / signal forwarding |
| wget    | `apk add` in Dockerfile | HEALTHCHECK CMD (wget -qO- /health/ready) |
| curl    | `apk add` in Dockerfile | `diagnosticsService.js:335` calls `execSync('curl --version')` to probe curl availability for the /diagnostics endpoint |
| node:20-alpine base | FROM | Node.js runtime |
| npm production deps | `npm ci --omit=dev --ignore-scripts` | All packages in package.json `dependencies` |

**No native addons.** All npm dependencies are pure JavaScript:
- `bcryptjs` — pure JS (NOT native `bcrypt`)
- `pg` — pure JS postgres driver (no `pg-native`)
- `modesl` — pure JS FreeSWITCH ESL client
- `ioredis` — pure JS Redis client
- All others: pure JS

`npm ci --omit=dev --ignore-scripts` is safe and produces a fully working image.

### cc-backend (node:20-alpine)

| Package | Source | Why |
|---------|--------|-----|
| tini    | `apk add` in Dockerfile | Correct PID-1 / signal forwarding |
| wget    | `apk add` in Dockerfile | HEALTHCHECK CMD |
| node:20-alpine base | FROM | Node.js runtime |
| npm production deps | `npm ci --omit=dev --ignore-scripts` | package.json `dependencies` |

No native addons. Pure JS dependencies only.

### cc-frontend, enrs-frontend, agent-desktop (nginx:1.27-alpine)

Build-time Node.js (Vite) produces a static bundle. The serving image is
stock `nginx:1.27-alpine` with no additional packages installed.

### nginx (nginx:1.27-alpine)

Stock nginx:1.27-alpine. No additional packages. The `envsubst` binary for
template processing is provided by the base image.

### postgres (postgres:16-alpine), redis (redis:7-alpine)

Stock upstream images. No modifications. All required tools are built in.

---

## B. Dependencies on the FreeSWITCH HOST OS

These must be installed on the physical/VM host that runs FreeSWITCH.
Docker containers cannot satisfy any of these.

| Dependency | Severity | Used By | Source Evidence |
|------------|----------|---------|-----------------|
| **curl** | CRITICAL | Lua scripts via `io.popen` | `ens_blast_trigger.lua:54,69`; `ens_playback_handler.lua:59`; `ers_conference_bridge.lua:65,80,95`; generated `ivr_executor*.lua` (registry.js:587, luaGenerator.js:106,112) |
| **FreeSWITCH** | CRITICAL | Platform itself | FreeSWITCH runs natively on host |
| mod_lua | CRITICAL | All Lua scripts | Required to load/execute .lua files |
| mod_event_socket | CRITICAL | ESL (backend ↔ FS) | enrs-backend and cc-backend both connect via ESL |
| mod_sofia | CRITICAL | SIP calls | All inbound/outbound call handling |
| mod_conference | CRITICAL | ERS bridge | `ers_conference_bridge.lua` — conference room execution |
| mod_flite (or other TTS) | WARN | ENS/ERS Lua speak() | `ENRS_TTS_ENGINE` env var; default is `flite` |
| coreutils (mkdir, cp, sed, grep, id) | REQUIRED | deploy scripts | `prepare-directories.sh`, `prepare-freeswitch.sh` |

### What breaks when each is missing

| Missing dependency | Failure mode |
|--------------------|--------------|
| curl (host) | Lua `io.popen("curl …")` returns empty string. Lua functions silently return `nil`. ENS blasts never start. ERS incidents never open. IVR nodes calling backend silently skip. **No error in FreeSWITCH log unless Lua explicitly logs it.** |
| mod_lua | `application="lua"` in dialplan is unknown. Calls hit the lua action and drop immediately. |
| mod_event_socket | enrs-backend ESL connection fails. Campaign engine cannot originate calls. Conference events not received. Backend logs connection refused on port 8021. |
| mod_conference | ERS conference action fails. `ers_conference_bridge.lua` conference room never created. |
| mod_flite | `speak()` calls in Lua silently do nothing. Callers hear silence where prompts should play. |

---

## C. Dependencies on the deployment/admin machine

These are needed to run the scripts in `deploy/scripts/`.

| Dependency | Used By | Why |
|------------|---------|-----|
| bash | All deploy scripts | Scripts use bash-specific syntax (`[[ ]]`, `set -euo pipefail`) |
| docker + docker compose | All deploy scripts | Container management |
| openssl | `generate-self-signed.sh`, `validate-deployment.sh`, `verify-install.sh` | TLS certificate generation and inspection |
| curl | `post-install.sh`, `validate-deployment.sh`, `verify-install.sh` | Health endpoint probes |
| fs_cli | `prepare-freeswitch.sh`, `verify-install.sh` | FreeSWITCH configuration reload and variable verification |

---

## D. Additional execSync calls in ENRS backend (J: Diagnostics-only)

These run inside the `enrs-backend` Docker container when an admin hits
the `/diagnostics` endpoint. They are not required for normal call handling.

| Call | File:Line | What it does | Notes |
|------|-----------|--------------|-------|
| `execSync('curl --version')` | `diagnosticsService.js:335` | Checks if curl is in PATH | **curl must be in the Docker image** — fixed by adding curl to Dockerfile |
| `execSync('id -u freeswitch')` | `diagnosticsService.js:354` | Gets UID of freeswitch system user | Returns null if user does not exist in container (expected — FS runs on host) |
| `execSync('id -g freeswitch')` | `diagnosticsService.js:355` | Gets GID of freeswitch system user | Same as above |
| `execSync('fs_cli -x "…"')` | `fsConfig.js:21` | Auto-detects FS paths | Best-effort; returns null on failure; normal in Docker deployment |

---

## E. Runtime internet dependencies

**None at runtime.** All production Docker images use local Alpine package
mirrors already baked into the image at build time. No internet access is
required after images are built and loaded.

**Build-time internet is required** to pull base images and npm packages.
For air-gapped deployment, pre-build images and transfer via `docker save` /
`docker load`.

---

## F. Placeholder secrets that must be replaced before deployment

Verify these in `deploy/.env` before running any deploy script:

| Variable | Placeholder value | How to generate |
|----------|-------------------|-----------------|
| `INTERNAL_API_KEY` | `REPLACE_WITH_RANDOM_HEX_32` | `openssl rand -hex 32` |
| `FS_ESL_PASSWORD` | contains `CHANGE_ME` | Choose a strong password |
| `JWT_ACCESS_SECRET` | contains `CHANGE_ME` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | contains `CHANGE_ME` | `openssl rand -hex 32` |
| `REDIS_PASSWORD` | contains `CHANGE_ME` | `openssl rand -hex 32` |
| `POSTGRES_ADMIN_PASSWORD` | contains `CHANGE_ME` | Choose a strong password |

`prepare-freeswitch.sh` and `prepare-directories.sh` will abort with a clear
error if any placeholder is still present.

---

## G. Offline deployment checklist

Before taking the system to an air-gapped site:

1. **Build all Docker images on an internet-connected machine:**
   ```bash
   cd deploy
   docker compose build
   ```

2. **Save images to tar files:**
   ```bash
   docker save omni-postgres   | gzip > omni-postgres.tar.gz
   docker save omni-redis      | gzip > omni-redis.tar.gz
   docker save omni-cc-backend | gzip > omni-cc-backend.tar.gz
   docker save omni-enrs-backend | gzip > omni-enrs-backend.tar.gz
   docker save omni-cc-frontend  | gzip > omni-cc-frontend.tar.gz
   docker save omni-enrs-frontend | gzip > omni-enrs-frontend.tar.gz
   docker save omni-agent-desktop | gzip > omni-agent-desktop.tar.gz
   docker save omni-nginx      | gzip > omni-nginx.tar.gz
   ```

3. **Transfer to customer site and load:**
   ```bash
   for f in omni-*.tar.gz; do docker load < "$f"; done
   ```

4. **Install HOST OS dependencies (no internet needed if using offline packages):**
   ```bash
   # Must be done before FreeSWITCH starts
   apt-get install -y curl         # Debian/Ubuntu
   # yum install -y curl           # RHEL/CentOS
   ```

5. **Run pre-flight check:**
   ```bash
   bash deploy/scripts/validate-runtime-dependencies.sh
   ```

---

## H. Pre-flight check summary

Run before every deployment:

```bash
# On the FreeSWITCH host:
bash deploy/scripts/validate-runtime-dependencies.sh

# Expected output for a ready system:
#   [PASS] curl available on FreeSWITCH host: curl 7.x.x ...
#   [PASS] FreeSWITCH found: /usr/bin/fs_cli
#   [PASS] mod_lua: loaded
#   [PASS] mod_event_socket: present
#   [PASS] mod_sofia: present
#   [PASS] mod_conference: present
#   [PASS] Docker running: 24.x.x
#   [PASS] Docker Compose v2 plugin: available
#   [PASS] openssl: OpenSSL 3.x ...
#   ALL CRITICAL CHECKS PASSED
```
