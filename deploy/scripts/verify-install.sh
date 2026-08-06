#!/usr/bin/env bash
# verify-install.sh
# Full system verification for the Omni platform.
#
# Checks every component and prints PASS / WARN / FAIL per item.
# Exit code: 0 = all PASS, 1 = one or more FAIL.
#
# Usage (from repo root):
#   bash deploy/scripts/verify-install.sh

set -uo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

PASS_COUNT=0; WARN_COUNT=0; FAIL_COUNT=0

pass() { echo -e "  ${GREEN}PASS${NC}  $1"; PASS_COUNT=$((PASS_COUNT+1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; WARN_COUNT=$((WARN_COUNT+1)); }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; FAIL_COUNT=$((FAIL_COUNT+1)); }
step() { echo -e "\n${BOLD}[ $1 ]${NC}"; }

# ---------------------------------------------------------------------------
# Locate .env
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo -e "${RED}ERROR${NC}: ${ENV_FILE} not found" >&2; exit 1
fi

parse_var() { grep -E "^${1}=" "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"'"'"' '; }

SERVER_NAME=$(parse_var SERVER_NAME)
CC_BACKEND_PORT=$(parse_var CC_BACKEND_PORT)
ENRS_BACKEND_PORT=$(parse_var ENRS_BACKEND_PORT)
FS_ESL_PORT=$(parse_var FS_ESL_PORT)
FS_CONF_DIR=$(parse_var FS_CONF_DIR)
FS_SCRIPT_DIR=$(parse_var FS_SCRIPT_DIR)
FS_RECORDING_DIR=$(parse_var FS_RECORDING_DIR)
POSTGRES_ADMIN_USER=$(parse_var POSTGRES_ADMIN_USER)
POSTGRES_ADMIN_USER="${POSTGRES_ADMIN_USER:-postgres}"
CC_DB_NAME=$(parse_var CC_DB_NAME)
CC_DB_NAME="${CC_DB_NAME:-fs_cc}"
ENRS_DB_NAME=$(parse_var ENRS_DB_NAME)
ENRS_DB_NAME="${ENRS_DB_NAME:-fs_enrs}"
REDIS_PASSWORD=$(parse_var REDIS_PASSWORD)

COMPOSE="docker compose"
${COMPOSE} version &>/dev/null 2>&1 || COMPOSE="docker-compose"

# Change into the deploy directory so all "docker compose" commands find
# docker-compose.yml without needing --project-directory on every call.
cd "${DEPLOY_DIR}"

# Resolve a service to its container ID via compose — works regardless of
# whether docker-compose.yml uses explicit container_name or auto-naming.
_container_id() {
  local SVC="$1"
  ${COMPOSE} ps -q "${SVC}" 2>/dev/null | head -1
}

container_health() {
  local SVC="$1"
  local ID
  ID=$(_container_id "${SVC}")
  if [[ -z "${ID}" ]]; then echo "missing"; return; fi
  docker inspect --format='{{.State.Health.Status}}' "${ID}" 2>/dev/null || echo "missing"
}

check_http() {
  local URL="$1" FLAGS="${2:--s}"
  curl ${FLAGS} -o /dev/null -w "%{http_code}" --max-time 5 "${URL}" 2>/dev/null || echo "000"
}

# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "${BOLD}   Omni Platform — Installation Verify${NC}"
echo -e "${BOLD}   $(date)${NC}"
echo -e "${BOLD}══════════════════════════════════════════${NC}"

# ---------------------------------------------------------------------------
# 1. Docker
# ---------------------------------------------------------------------------
step "Docker"

if docker info &>/dev/null 2>&1; then
  DOCKER_VER=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1)
  pass "Docker is running (${DOCKER_VER})"
else
  fail "Docker is not running — start with: systemctl start docker"
fi

if ${COMPOSE} version &>/dev/null 2>&1; then
  pass "Docker Compose available"
else
  fail "Docker Compose not found"
fi

# ---------------------------------------------------------------------------
# 2. Container health
# ---------------------------------------------------------------------------
step "Container Health"

SERVICES=(postgres redis cc-backend enrs-backend cc-frontend agent-desktop enrs-frontend nginx)
for SVC in "${SERVICES[@]}"; do
  STATUS=$(container_health "${SVC}")
  case "${STATUS}" in
    healthy)   pass "${SVC}: healthy" ;;
    starting)  warn "${SVC}: still starting (wait and re-run)" ;;
    unhealthy) fail "${SVC}: unhealthy — docker compose logs ${SVC}" ;;
    missing)   fail "${SVC}: container not found — docker compose up -d" ;;
    *)         warn "${SVC}: status=${STATUS}" ;;
  esac
done

# ---------------------------------------------------------------------------
# 3. Backend health endpoints
# ---------------------------------------------------------------------------
step "Backend Health Endpoints"

CODE=$(check_http "http://127.0.0.1:${CC_BACKEND_PORT}/api/health")
[[ "${CODE}" == "200" ]] && pass "CC backend /api/health: HTTP 200" \
  || fail "CC backend /api/health: HTTP ${CODE}"

CODE=$(check_http "http://127.0.0.1:${ENRS_BACKEND_PORT}/api/health")
[[ "${CODE}" == "200" ]] && pass "ENRS backend /api/health: HTTP 200" \
  || fail "ENRS backend /api/health: HTTP ${CODE}"

# ---------------------------------------------------------------------------
# 4. nginx routing
# ---------------------------------------------------------------------------
step "Nginx Routing"

for PATH_CHECK in "/cc/" "/agent/" "/enrs/" "/_health"; do
  CODE=$(check_http "https://${SERVER_NAME}${PATH_CHECK}" "-sk")
  if [[ "${CODE}" =~ ^(200|301|302|304)$ ]]; then
    pass "https://${SERVER_NAME}${PATH_CHECK}: HTTP ${CODE}"
  else
    fail "https://${SERVER_NAME}${PATH_CHECK}: HTTP ${CODE}"
  fi
done

# Internal API must be blocked at nginx
INTERNAL_CODE=$(check_http "https://${SERVER_NAME}/enrs/api/v1/internal/ers/lookup" "-sk")
if [[ "${INTERNAL_CODE}" == "403" ]]; then
  pass "Internal API blocked by nginx: HTTP 403"
else
  fail "Internal API returned HTTP ${INTERNAL_CODE} (expected 403)"
fi

# ---------------------------------------------------------------------------
# 5. TLS certificate
# ---------------------------------------------------------------------------
step "TLS Certificate"

CERT_INFO=$(echo | timeout 5 openssl s_client \
  -connect "${SERVER_NAME}:443" -servername "${SERVER_NAME}" 2>/dev/null \
  | openssl x509 -noout -subject -enddate 2>/dev/null || true)

if [[ -z "${CERT_INFO}" ]]; then
  warn "Could not retrieve TLS certificate from ${SERVER_NAME}:443"
else
  EXPIRY=$(echo "${CERT_INFO}" | grep notAfter | cut -d= -f2)
  EXPIRY_EPOCH=$(date -d "${EXPIRY}" +%s 2>/dev/null || echo 0)
  DAYS=$(( (EXPIRY_EPOCH - $(date +%s)) / 86400 ))

  if   [[ ${DAYS} -lt 0 ]];  then fail "TLS certificate EXPIRED ${DAYS#-} days ago"
  elif [[ ${DAYS} -lt 14 ]]; then fail "TLS certificate expires in ${DAYS} days — renew now"
  elif [[ ${DAYS} -lt 30 ]]; then warn "TLS certificate expires in ${DAYS} days"
  else                             pass "TLS certificate valid — ${DAYS} days remaining"
  fi

  if echo "${CERT_INFO}" | grep -q "O = Omni Platform"; then
    warn "Self-signed certificate (Phase 1 only — browsers will warn)"
  fi
fi

# ---------------------------------------------------------------------------
# 6. PostgreSQL
# ---------------------------------------------------------------------------
step "PostgreSQL"

PG_STATUS=$(container_health "postgres")
if [[ "${PG_STATUS}" == "healthy" ]]; then
  pass "PostgreSQL container: healthy"

  CC_TABLES=$(${COMPOSE} exec -T postgres \
    psql -U "${POSTGRES_ADMIN_USER}" -d "${CC_DB_NAME}" -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
    2>/dev/null | tr -d ' \n' || echo "0")
  ENRS_TABLES=$(${COMPOSE} exec -T postgres \
    psql -U "${POSTGRES_ADMIN_USER}" -d "${ENRS_DB_NAME}" -t -c \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
    2>/dev/null | tr -d ' \n' || echo "0")

  if [[ "${CC_TABLES}" =~ ^[0-9]+$ ]] && [[ "${CC_TABLES}" -gt 0 ]]; then
    pass "CC database (fs_cc): ${CC_TABLES} tables"
  else
    fail "CC database: no tables — run: bash deploy/scripts/post-install.sh"
  fi

  if [[ "${ENRS_TABLES}" =~ ^[0-9]+$ ]] && [[ "${ENRS_TABLES}" -gt 10 ]]; then
    pass "ENRS database (fs_enrs): ${ENRS_TABLES} tables"
  else
    fail "ENRS database: ${ENRS_TABLES} tables (expected >10) — check enrs-backend logs"
  fi
else
  fail "PostgreSQL not healthy"
fi

# ---------------------------------------------------------------------------
# 7. Redis
# ---------------------------------------------------------------------------
step "Redis"

REDIS_STATUS=$(container_health "redis")
if [[ "${REDIS_STATUS}" == "healthy" ]]; then
  pass "Redis container: healthy"
  REDIS_PING=$(${COMPOSE} exec -T redis \
    redis-cli --no-auth-warning -a "${REDIS_PASSWORD}" ping 2>/dev/null || echo "FAIL")
  [[ "${REDIS_PING}" == "PONG" ]] && pass "Redis PING: PONG" \
    || warn "Redis PING failed — check REDIS_PASSWORD in .env"
else
  fail "Redis not healthy"
fi

# ---------------------------------------------------------------------------
# 8. FreeSWITCH ESL
# ---------------------------------------------------------------------------
step "FreeSWITCH ESL"

ESL_TARGET="127.0.0.1"  # test from host (containers use host.docker.internal)

if timeout 3 bash -c "echo >/dev/tcp/${ESL_TARGET}/${FS_ESL_PORT}" 2>/dev/null; then
  pass "ESL port ${ESL_TARGET}:${FS_ESL_PORT} is reachable"
else
  fail "ESL port ${ESL_TARGET}:${FS_ESL_PORT} is not reachable — is FreeSWITCH running?"
fi

if command -v fs_cli &>/dev/null; then
  FS_STATUS=$(fs_cli -x "status" 2>/dev/null | head -1 || echo "unavailable")
  if echo "${FS_STATUS}" | grep -q "UP"; then
    pass "FreeSWITCH: ${FS_STATUS}"

    IKEY=$(fs_cli -x "global_getvar FS_INTERNAL_KEY" 2>/dev/null | head -1 || echo "")
    EURL=$(fs_cli -x "global_getvar ENRS_API_URL"    2>/dev/null | head -1 || echo "")

    if [[ -n "${IKEY}" && "${IKEY}" != "REPLACE_WITH_RANDOM_HEX_32" ]]; then
      pass "FS_INTERNAL_KEY set in vars.xml"
    else
      fail "FS_INTERNAL_KEY missing — run: sudo bash deploy/scripts/prepare-freeswitch.sh"
    fi

    if [[ -n "${EURL}" ]]; then
      pass "ENRS_API_URL = ${EURL}"
    else
      fail "ENRS_API_URL missing — run: sudo bash deploy/scripts/prepare-freeswitch.sh"
    fi
  else
    warn "FreeSWITCH not running or status unavailable: ${FS_STATUS}"
  fi
else
  warn "fs_cli not found — cannot verify FreeSWITCH Lua variables"
fi

# ---------------------------------------------------------------------------
# 9. Lua scripts deployed
# ---------------------------------------------------------------------------
step "Lua Scripts"

if [[ -n "${FS_SCRIPT_DIR}" && -d "${FS_SCRIPT_DIR}" ]]; then
  LUA_COUNT=$(find "${FS_SCRIPT_DIR}" -name "*.lua" 2>/dev/null | wc -l || echo 0)
  if [[ "${LUA_COUNT}" -gt 0 ]]; then
    pass "Lua scripts in ${FS_SCRIPT_DIR}: ${LUA_COUNT} files"
  else
    warn "No Lua scripts in ${FS_SCRIPT_DIR} — deploy via IVR builder after first login"
  fi
else
  warn "FS_SCRIPT_DIR not set or does not exist: ${FS_SCRIPT_DIR}"
fi

# ---------------------------------------------------------------------------
# 10. Directories and permissions
# ---------------------------------------------------------------------------
step "Directories and Permissions"

CHECK_DIRS=(
  "${FS_CONF_DIR}"
  "${FS_SCRIPT_DIR}"
  "${FS_RECORDING_DIR}"
  "${DEPLOY_DIR}/ssl"
  "${DEPLOY_DIR}/logs/nginx"
  "${DEPLOY_DIR}/uploads/enrs"
)
for DIR in "${CHECK_DIRS[@]}"; do
  if [[ -d "${DIR}" ]]; then
    pass "Exists: ${DIR}"
  else
    fail "Missing: ${DIR} — run: sudo bash deploy/scripts/prepare-directories.sh"
  fi
done

# ---------------------------------------------------------------------------
# 11. SSL certificates
# ---------------------------------------------------------------------------
step "SSL Certificates"

CERT="${DEPLOY_DIR}/ssl/fullchain.pem"
KEY="${DEPLOY_DIR}/ssl/privkey.pem"

[[ -f "${CERT}" ]] && pass "fullchain.pem exists" || fail "fullchain.pem missing — run: bash deploy/scripts/generate-self-signed.sh"
[[ -f "${KEY}" ]]  && pass "privkey.pem exists"   || fail "privkey.pem missing — run: bash deploy/scripts/generate-self-signed.sh"

if [[ -f "${CERT}" ]]; then
  CERT_EXPIRY=$(openssl x509 -enddate -noout -in "${CERT}" 2>/dev/null | cut -d= -f2 || echo "unknown")
  pass "Certificate expiry: ${CERT_EXPIRY}"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "${BOLD}   Summary${NC}"
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "  ${GREEN}PASS${NC}  ${PASS_COUNT}"
echo -e "  ${YELLOW}WARN${NC}  ${WARN_COUNT}"
echo -e "  ${RED}FAIL${NC}  ${FAIL_COUNT}"
echo ""

if [[ ${FAIL_COUNT} -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}RESULT: FAILED — address FAIL items before going live${NC}"
  exit 1
elif [[ ${WARN_COUNT} -gt 0 ]]; then
  echo -e "  ${YELLOW}${BOLD}RESULT: WARNINGS — review WARN items${NC}"
  echo ""
  echo -e "  Access: ${BLUE}https://${SERVER_NAME}/cc/${NC}"
  exit 0
else
  echo -e "  ${GREEN}${BOLD}RESULT: ALL CHECKS PASSED${NC}"
  echo ""
  echo -e "  Contact Center  → ${BLUE}https://${SERVER_NAME}/cc/${NC}"
  echo -e "  Agent Desktop   → ${BLUE}https://${SERVER_NAME}/agent/${NC}"
  echo -e "  ENRS            → ${BLUE}https://${SERVER_NAME}/enrs/${NC}"
  exit 0
fi
