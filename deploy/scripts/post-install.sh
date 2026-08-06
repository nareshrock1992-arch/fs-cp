#!/usr/bin/env bash
# post-install.sh
# One-time post-deployment tasks for the Omni platform.
#
# Run ONCE after "docker compose up -d" when all containers are healthy.
# This script is safe to re-run — it checks before migrating.
#
# Tasks:
#   1. Wait for postgres and cc-backend to be healthy
#   2. Run Contact Center (fs-cc) database schema migration (once only)
#   3. Verify ENRS auto-migration completed
#   4. Check all backend health endpoints
#   5. Print access URLs
#
# Usage (from repo root):
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
die()     { echo -e "${RED}  ERROR${NC} $1" >&2; exit 1; }
step()    { echo -e "\n${BOLD}==> $1${NC}"; }

# ---------------------------------------------------------------------------
# Locate .env
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"

[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} not found."

parse_var() { grep -E "^${1}=" "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"'"'"' '; }

SERVER_NAME=$(parse_var SERVER_NAME)
CC_BACKEND_PORT=$(parse_var CC_BACKEND_PORT)
ENRS_BACKEND_PORT=$(parse_var ENRS_BACKEND_PORT)
COMPOSE_PROJECT=$(parse_var COMPOSE_PROJECT_NAME)
COMPOSE_PROJECT="${COMPOSE_PROJECT:-omni}"

# Detect compose command
COMPOSE="docker compose"
${COMPOSE} version &>/dev/null 2>&1 || COMPOSE="docker-compose"

# ---------------------------------------------------------------------------
# Helper: wait for container healthy
# ---------------------------------------------------------------------------
wait_healthy() {
  local SVC="$1"
  local CONTAINER="${COMPOSE_PROJECT}-${SVC}-1"
  local MAX=120 ELAPSED=0
  printf "  Waiting for ${BOLD}${SVC}${NC} to be healthy "
  while true; do
    STATUS=$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo "missing")
    case "${STATUS}" in
      healthy)   echo -e " ${GREEN}ready${NC}"; return 0 ;;
      missing)   echo ""; die "Container ${CONTAINER} not found. Is 'docker compose up -d' running?" ;;
    esac
    if [[ ${ELAPSED} -ge ${MAX} ]]; then
      echo ""
      die "${SVC} did not become healthy in ${MAX}s.\n       Check: docker compose logs ${SVC}"
    fi
    printf "."
    sleep 3; ELAPSED=$((ELAPSED + 3))
  done
}

# ---------------------------------------------------------------------------
# Step 1: Wait for dependencies
# ---------------------------------------------------------------------------
step "Waiting for containers"
wait_healthy "postgres"
wait_healthy "cc-backend"
wait_healthy "enrs-backend"

# ---------------------------------------------------------------------------
# Step 2: CC database migration (run once)
# ---------------------------------------------------------------------------
step "Contact Center database migration"

TABLE_COUNT=$(${COMPOSE} exec -T postgres \
  psql -U postgres -d fs_cc -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d ' \n' || echo "0")

if [[ "${TABLE_COUNT}" =~ ^[0-9]+$ ]] && [[ "${TABLE_COUNT}" -gt 0 ]]; then
  success "CC schema already exists (${TABLE_COUNT} tables) — skipping migration"
  warn "To rebuild: drop the fs_cc database, restart postgres, then re-run this script"
else
  info "Running: docker compose exec cc-backend node db/init.js"
  ${COMPOSE} exec -T cc-backend node db/init.js && success "CC database schema created" \
    || die "CC migration failed.\n       Check: docker compose logs cc-backend"
fi

# ---------------------------------------------------------------------------
# Step 3: Verify ENRS auto-migration
# ---------------------------------------------------------------------------
step "ENRS database migration"

ENRS_TABLES=$(${COMPOSE} exec -T postgres \
  psql -U postgres -d fs_enrs -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d ' \n' || echo "0")

if [[ "${ENRS_TABLES}" =~ ^[0-9]+$ ]] && [[ "${ENRS_TABLES}" -gt 10 ]]; then
  success "ENRS schema ready (${ENRS_TABLES} tables)"
elif [[ "${ENRS_TABLES}" =~ ^[0-9]+$ ]] && [[ "${ENRS_TABLES}" -gt 0 ]]; then
  warn "ENRS has ${ENRS_TABLES} tables (expected >10). Check: docker compose logs enrs-backend"
else
  die "ENRS has no tables — migration failed.\n       Check: docker compose logs enrs-backend"
fi

# ---------------------------------------------------------------------------
# Step 4: Health endpoint checks
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

check_http "CC backend health"   "http://127.0.0.1:${CC_BACKEND_PORT}/api/health"
check_http "ENRS backend health" "http://127.0.0.1:${ENRS_BACKEND_PORT}/api/health"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
step "Post-install complete"

SEED_EMAIL=$(parse_var SEED_ADMIN_EMAIL)

echo ""
echo -e "${BOLD}  Access URLs${NC}"
echo "  ─────────────────────────────────────────────"
echo -e "  Contact Center  → ${BLUE}https://${SERVER_NAME}/cc/${NC}"
echo -e "  Agent Desktop   → ${BLUE}https://${SERVER_NAME}/agent/${NC}"
echo -e "  ENRS            → ${BLUE}https://${SERVER_NAME}/enrs/${NC}"
echo ""
echo -e "${BOLD}  ENRS Admin Login${NC}"
echo "  ─────────────────────────────────────────────"
echo "  Email:    ${SEED_EMAIL}"
echo "  Password: (as set in SEED_ADMIN_PASSWORD in .env)"
echo ""
warn "Change the ENRS admin password immediately after first login."
echo ""
info "Run full verification:"
info "  bash deploy/scripts/verify-install.sh"
