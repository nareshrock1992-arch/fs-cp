#!/usr/bin/env bash
# post-install.sh
# Post-deployment validation script for the Omni platform.
#
# Run after "docker compose up -d" to verify that all services are healthy
# and that both databases were initialized correctly.
#
# Both CC and ENRS now run migrations + admin bootstrap automatically in their
# container entrypoints — this script only waits, validates, and reports.
#
# Usage (from any directory):
#   bash deploy/scripts/post-install.sh

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}  INFO${NC}  $1"; }
success() { echo -e "${GREEN}  OK  ${NC}  $1"; }
warn()    { echo -e "${YELLOW}  WARN${NC}  $1"; }
die()     { echo -e "${RED} ERROR${NC} $1" >&2; exit 1; }
step()    { echo -e "\n${BOLD}==> $1${NC}"; }

# ---------------------------------------------------------------------------
# Locate deploy directory and .env — works regardless of caller's cwd
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"

[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} not found. Copy .env.example to .env and fill in all values."

# Change into the deploy directory so all "docker compose" commands find
# docker-compose.yml without needing --project-directory on every call.
cd "${DEPLOY_DIR}"

parse_var() {
  grep -E "^${1}=" "${ENV_FILE}" \
    | head -1 \
    | cut -d= -f2- \
    | sed -E 's/[[:space:]]+#.*$//' \
    | tr -d '"'"'"
}

SERVER_NAME=$(parse_var SERVER_NAME)
CC_BACKEND_PORT=$(parse_var CC_BACKEND_PORT)
ENRS_BACKEND_PORT=$(parse_var ENRS_BACKEND_PORT)
POSTGRES_ADMIN_USER=$(parse_var POSTGRES_ADMIN_USER)
POSTGRES_ADMIN_USER="${POSTGRES_ADMIN_USER:-postgres}"
CC_DB_NAME=$(parse_var CC_DB_NAME)
CC_DB_NAME="${CC_DB_NAME:-fs_cc}"
ENRS_DB_NAME=$(parse_var ENRS_DB_NAME)
ENRS_DB_NAME="${ENRS_DB_NAME:-fs_enrs}"
CC_ADMIN_USERNAME=$(parse_var CC_INITIAL_ADMIN_USERNAME)
ENRS_ADMIN_EMAIL=$(parse_var INITIAL_ADMIN_EMAIL)
CC_API_BASE=$(parse_var CC_API_BASE)
ENRS_API_BASE=$(parse_var ENRS_API_BASE)

# ---------------------------------------------------------------------------
# Validate frontend routing variables — missing values cause API 404s
# ---------------------------------------------------------------------------
if [[ -z "${CC_API_BASE}" ]]; then
  warn "CC_API_BASE is not set in ${ENV_FILE}"
  warn "  CC and Agent Desktop will return 404 on all API calls until this is fixed."
  warn "  Add to .env:  CC_API_BASE=/cc/api"
  warn "  Then rebuild: docker compose build cc-frontend agent-desktop && docker compose up -d"
fi
if [[ -z "${ENRS_API_BASE}" ]]; then
  warn "ENRS_API_BASE is not set in ${ENV_FILE}"
  warn "  ENRS will return 404 on all API calls until this is fixed."
  warn "  Add to .env:  ENRS_API_BASE=/enrs/api/v1"
  warn "  Then rebuild: docker compose build enrs-frontend && docker compose up -d"
fi

# Detect compose command (v2 plugin vs standalone)
COMPOSE="docker compose"
${COMPOSE} version &>/dev/null 2>&1 || COMPOSE="docker-compose"

# ---------------------------------------------------------------------------
# Helper: resolve a service to its running container ID via compose.
# ---------------------------------------------------------------------------
container_id() {
  local SVC="$1"
  ${COMPOSE} ps -q "${SVC}" 2>/dev/null | head -1
}

# ---------------------------------------------------------------------------
# Helper: return the health status of a compose service
# ---------------------------------------------------------------------------
container_health() {
  local SVC="$1"
  local ID
  ID=$(container_id "${SVC}")
  if [[ -z "${ID}" ]]; then echo "missing"; return; fi
  docker inspect --format='{{.State.Health.Status}}' "${ID}" 2>/dev/null || echo "unknown"
}

# ---------------------------------------------------------------------------
# Helper: wait until a service is healthy (or fail after MAX seconds)
# ---------------------------------------------------------------------------
wait_healthy() {
  local SVC="$1"
  local MAX="${2:-120}"
  local ELAPSED=0
  printf "  Waiting for ${BOLD}%s${NC} to be healthy " "${SVC}"
  while true; do
    local STATUS
    STATUS=$(container_health "${SVC}")
    case "${STATUS}" in
      healthy)
        echo -e " ${GREEN}ready${NC}"
        return 0
        ;;
      missing)
        echo ""
        die "Service '${SVC}' has no container. Run: docker compose up -d"
        ;;
    esac
    if [[ ${ELAPSED} -ge ${MAX} ]]; then
      echo ""
      die "${SVC} did not become healthy within ${MAX}s.
       Inspect logs with: docker compose logs ${SVC}"
    fi
    printf "."
    sleep 3
    ELAPSED=$((ELAPSED + 3))
  done
}

# ---------------------------------------------------------------------------
# Step 1: Wait for PostgreSQL
# ---------------------------------------------------------------------------
step "PostgreSQL"
wait_healthy "postgres"

# ---------------------------------------------------------------------------
# Step 2: Wait for CC backend
#
# The CC entrypoint (docker-entrypoint.sh) automatically runs:
#   1. scripts/migrate.js — applies any unapplied migrations
#   2. scripts/seed-initial-admin.js — creates the first admin if none exists
#
# The container does not become healthy until all of the above succeed and
# server.js is listening on /api/health.
# Allow 90 s: 60 s start_period in compose + 30 s polling buffer.
# ---------------------------------------------------------------------------
step "Contact Center backend (auto-migration + bootstrap in entrypoint)"
wait_healthy "cc-backend" 90

CC_TABLES=$(${COMPOSE} exec -T postgres \
  psql -U "${POSTGRES_ADMIN_USER}" -d "${CC_DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d ' \n' || echo "0")

if [[ "${CC_TABLES}" =~ ^[0-9]+$ ]] && [[ "${CC_TABLES}" -gt 0 ]]; then
  success "CC schema ready (${CC_TABLES} tables)"
else
  die "CC has no tables — migration did not run.\n       Check: docker compose logs cc-backend"
fi

# ---------------------------------------------------------------------------
# Step 3: Wait for ENRS backend
#
# The ENRS entrypoint (docker-entrypoint.sh) automatically runs:
#   1. src/db/migrate.js — applies all pending migrations
#   2. src/db/seed-initial-admin.js — creates SUPER_ADMIN if none exists
#
# Waiting for 'healthy' guarantees both completed without error.
# Allow 180 s: 120 s start_period in compose + 60 s polling buffer.
# ---------------------------------------------------------------------------
step "ENRS backend (auto-migration + bootstrap in entrypoint)"
wait_healthy "enrs-backend" 180

ENRS_TABLES=$(${COMPOSE} exec -T postgres \
  psql -U "${POSTGRES_ADMIN_USER}" -d "${ENRS_DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d ' \n' || echo "0")

if [[ "${ENRS_TABLES}" =~ ^[0-9]+$ ]] && [[ "${ENRS_TABLES}" -gt 10 ]]; then
  success "ENRS schema ready (${ENRS_TABLES} tables)"
elif [[ "${ENRS_TABLES}" =~ ^[0-9]+$ ]] && [[ "${ENRS_TABLES}" -gt 0 ]]; then
  warn "ENRS has only ${ENRS_TABLES} tables (expected >10). Partial migration?"
  warn "Check: docker compose logs enrs-backend"
else
  die "ENRS has no tables — migration did not run.\n       Check: docker compose logs enrs-backend"
fi

# ---------------------------------------------------------------------------
# Step 4: Health endpoint checks (from host, via loopback port bindings)
# ---------------------------------------------------------------------------
step "Health endpoints"

check_http() {
  local NAME="$1" URL="$2"
  local CODE
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${URL}" 2>/dev/null || echo "000")
  if [[ "${CODE}" == "200" ]]; then
    success "${NAME}: HTTP 200"
  else
    warn "${NAME}: HTTP ${CODE} (${URL})"
  fi
}

check_http "CC backend   /api/health"    "http://127.0.0.1:${CC_BACKEND_PORT}/api/health"
check_http "ENRS backend /health/ready"  "http://127.0.0.1:${ENRS_BACKEND_PORT}/health/ready"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
step "Post-install complete"

echo ""
echo -e "${BOLD}  Access URLs${NC}"
echo "  ─────────────────────────────────────────────"
echo -e "  Contact Center  → ${BLUE}https://${SERVER_NAME}/cc/${NC}"
echo -e "  Agent Desktop   → ${BLUE}https://${SERVER_NAME}/agent/${NC}"
echo -e "  ENRS            → ${BLUE}https://${SERVER_NAME}/enrs/${NC}"
echo ""
echo -e "${BOLD}  ENRS Admin Login${NC}"
echo "  ─────────────────────────────────────────────"
if [[ -n "${ENRS_ADMIN_EMAIL}" ]]; then
  echo "  Email:    ${ENRS_ADMIN_EMAIL}"
else
  echo "  Email:    (see INITIAL_ADMIN_EMAIL in .env, or check enrs-backend logs)"
fi
echo "  Password: (as set in INITIAL_ADMIN_PASSWORD in .env)"
echo ""
echo -e "${BOLD}  CC Admin Login${NC}"
echo "  ─────────────────────────────────────────────"
if [[ -n "${CC_ADMIN_USERNAME}" ]]; then
  echo "  Username: ${CC_ADMIN_USERNAME}"
else
  echo "  Username: (see CC_INITIAL_ADMIN_USERNAME in .env, or check cc-backend logs)"
fi
echo "  Password: (as set in CC_INITIAL_ADMIN_PASSWORD in .env)"
echo ""
warn "Change all default passwords immediately after first login."
echo ""
info "Run full verification:"
info "  bash deploy/scripts/verify-install.sh"
