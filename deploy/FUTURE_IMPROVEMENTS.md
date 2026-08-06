# Future Improvements

This file captures observations and recommendations that are NOT required for deployment.
None of these are blockers. Implement them in Phase 2: Production Hardening.

---

## Security

**S-1: ENRS startup validator — placeholder detection gap**
The ENRS `validator.js` checks for specific weak-value strings (e.g. `CHANGE_ME_access_secret_32plus`) and a minimum length of 32 chars. The current `.env.example` deliberately uses values that ARE in the weak list, so the guard fires correctly. Future improvement: extend the validator to catch any value matching `/^CHANGE_ME_|^REPLACE_WITH_/i` so the guard is robust against any placeholder naming convention.

**S-2: CC JWT guard — limited sentinel check**
`fs-cc/backend/config/index.js` checks `jwt.secret.includes('CHANGE-IN-PRODUCTION')`. This is a string-match guard. A stronger pattern would check minimum entropy (e.g. reject any value shorter than 32 chars or with Shannon entropy below a threshold).

**S-3: DB_SSL not configurable via `.env`**
`docker-compose.yml` hardcodes `DB_SSL: "false"` for both backends. For deployments with PostgreSQL TLS (e.g. managed cloud DBs), this needs to be an `.env` variable: `DB_SSL=${DB_SSL:-false}`.

**S-4: ESL listen-ip bound to 0.0.0.0**
If Docker containers cannot reach `host.docker.internal:8021` (which can happen with some kernel/network configurations), the workaround is setting FreeSWITCH ESL to listen on `0.0.0.0`. This is correct per the ACL (`loopback.auto`) but more exposure than necessary. A targeted firewall rule (`ufw allow from 172.30.0.0/24 to any port 8021`) is the better fix.

---

## Reliability

**R-1: CC migration — auto-run on first boot**
Currently `node db/init.js` must be run manually once. This is the only post-install step that cannot be automated within the current compose file. Improvement: add a Docker entrypoint or `command` override that checks for existing tables before running init, making it idempotent and removing the manual step.

**R-2: Redis eviction policy**
`redis.conf` sets `maxmemory-policy allkeys-lru`. Under memory pressure, Redis can evict ENRS rate-limit counters. For production, change to `volatile-lru` so only keys with TTL are evicted, and set `maxmemory` via an `.env` variable.

**R-3: ENS_PROBE middleware**
`fs-enrs/backend/server.js` lines 66–74 contain a `console.log` on every request marked `// TEMPORARY`. This produces verbose logs in production and was never removed. Remove or gate it behind `NODE_ENV !== 'production'`.

**R-4: DB_POOL_MAX hardcoded in compose**
Both backends have `DB_POOL_MAX: 10` hardcoded in `docker-compose.yml`. Externalize as `${DB_POOL_MAX:-10}` in `.env` so it can be tuned for production without editing the compose file.

**R-5: CC backend spuriously depends on Redis**
Fixed in current `docker-compose.yml` (redis removed from cc-backend depends_on). ✓ Already done.

---

## Observability

**O-1: Structured log output**
Both backends output mixed structured/unstructured logs. Adding a JSON log format option (e.g. `LOG_FORMAT=json` in `.env`) would improve log aggregation with tools like Loki, Datadog, or CloudWatch.

**O-2: Health endpoint detail**
`/api/health` currently returns `{"status":"ok"}`. Enriching it with DB connectivity, Redis ping, and ESL status would allow nginx or external monitors to detect partial failures.

**O-3: Redis monitoring**
`redis.conf` does not expose metrics. Adding `CONFIG enable-debug-command yes` (Redis 7.x) or enabling `redis-exporter` for Prometheus would improve visibility into Redis health.

---

## Operations

**O-4: Docker Compose subnet configurable**
`docker-compose.yml` hardcodes `subnet: 172.30.0.0/24`. On hosts with network conflicts, this cannot be changed without editing the compose file. Externalize as `${DOCKER_SUBNET:-172.30.0.0/24}`.

**O-5: COMPOSE_PROJECT_NAME in .env**
Already done — `name: ${COMPOSE_PROJECT_NAME:-omni}` allows multi-instance deployments. ✓ Already done.

**O-6: Let's Encrypt `--webroot` support**
The nginx volumes include the ACME webroot mount (`deploy/ssl/acme/`). The initial issue still requires `--standalone` (nginx stopped). Future improvement: include a `/.well-known/acme-challenge/` location block in the nginx config that is active even during HTTP, allowing `--webroot` for both initial issue and renewal without stopping nginx.

---

## Installer

**O-7: Interactive setup script**
A single `deploy/scripts/setup.sh` that prompts for all required values, generates secrets, writes `.env`, and runs all the prepare scripts would eliminate the manual `.env` editing step for customers without sysadmin experience.

**O-8: Upgrade script**
A `deploy/scripts/upgrade.sh` that pulls new images, runs migrations if needed, and performs a rolling restart.

**O-9: Rollback**
Tag images with versions and keep the previous image digest, enabling `docker compose up -d` with the previous `*_IMAGE` values in `.env` to roll back.

---

## Documentation

**O-10: Architecture diagram**
A visual diagram of the container network, port bindings, and FreeSWITCH integration paths would help operators understand the deployment without reading the full documentation.

**O-11: Multi-tenant setup guide**
No documentation exists for adding new tenants to the ENRS. This is an operational gap for multi-customer deployments.
