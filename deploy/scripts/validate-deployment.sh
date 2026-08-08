#!/usr/bin/env bash
# validate-deployment.sh
# Comprehensive deployment validation — runs all runtime checks that require
# the live Docker/FreeSWITCH environment.
#
# Run from /opt/omni/deploy after post-install.sh completes:
#   bash scripts/validate-deployment.sh
#
# Produces a PASS/FAIL report for every item in the deployment checklist.

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

PASS=0; WARN=0; FAIL=0

pass() { echo -e "  ${GREEN}PASS${NC}  $1"; PASS=$((PASS+1)); }
warn() { echo -e "  ${YELLOW}WARN${NC}  $1"; WARN=$((WARN+1)); }
fail() { echo -e "  ${RED}FAIL${NC}  $1"; FAIL=$((FAIL+1)); }
step() { echo -e "\n${BOLD}[ $1 ]${NC}"; }
info() { echo -e "  ${BLUE}    ${NC}  $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"
cd "${DEPLOY_DIR}"

[[ -f "${ENV_FILE}" ]] || { echo "ERROR: ${ENV_FILE} not found"; exit 1; }

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
REDIS_PASSWORD=$(parse_var REDIS_PASSWORD)
FS_ESL_PORT=$(parse_var FS_ESL_PORT)
FS_ESL_PASSWORD=$(parse_var FS_ESL_PASSWORD)
FS_CONF_DIR=$(parse_var FS_CONF_DIR)
FS_SCRIPT_DIR=$(parse_var FS_SCRIPT_DIR)
FS_RECORDING_DIR=$(parse_var FS_RECORDING_DIR)
POSTGRES_ADMIN_USER=$(parse_var POSTGRES_ADMIN_USER)
POSTGRES_ADMIN_USER="${POSTGRES_ADMIN_USER:-postgres}"
CC_DB_NAME=$(parse_var CC_DB_NAME)
CC_DB_NAME="${CC_DB_NAME:-fs_cc}"
ENRS_DB_NAME=$(parse_var ENRS_DB_NAME)
ENRS_DB_NAME="${ENRS_DB_NAME:-fs_enrs}"
CC_ADMIN_PASSWORD=$(parse_var CC_ADMIN_PASSWORD)
CC_ADMIN_PASSWORD="${CC_ADMIN_PASSWORD:-admin123}"
CC_API_BASE=$(parse_var CC_API_BASE)
ENRS_API_BASE=$(parse_var ENRS_API_BASE)

COMPOSE="docker compose"
${COMPOSE} version &>/dev/null || COMPOSE="docker-compose"

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   Omni Platform — Deployment Validation                  ${NC}"
echo -e "${BOLD}   $(date)                                                ${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"

# ---------------------------------------------------------------------------
# 1. .env PARSING — verify no # artifacts in critical values
# ---------------------------------------------------------------------------
step "1. .env Parsing"

PARSE_VARS=(SERVER_NAME FS_CONF_DIR FS_SCRIPT_DIR FS_RECORDING_DIR \
            FS_ESL_PASSWORD REDIS_PASSWORD CC_API_BASE ENRS_API_BASE)
PARSE_FAIL=0
for VAR in "${PARSE_VARS[@]}"; do
  VAL=$(parse_var "$VAR")
  if [[ -z "$VAL" ]]; then
    fail "parse_var ${VAR}: empty (missing from .env)"
    PARSE_FAIL=1
  elif [[ "$VAL" == *"#"* ]]; then
    fail "parse_var ${VAR}: contains # artifact: [${VAL}]"
    PARSE_FAIL=1
  else
    pass "parse_var ${VAR}: [${VAL}]"
  fi
done
[[ $PARSE_FAIL -eq 0 ]] && info "All .env values parsed cleanly — no comment artifacts"

# ---------------------------------------------------------------------------
# 2. FREESWITCH ESL PASSWORD — verify event_socket.conf.xml and auth
# ---------------------------------------------------------------------------
step "2. FreeSWITCH ESL Password"

ESL_CONF="${FS_CONF_DIR}/autoload_configs/event_socket.conf.xml"
if [[ -f "${ESL_CONF}" ]]; then
  CONF_PASS=$(grep 'name="password"' "${ESL_CONF}" | grep -oP 'value="\K[^"]+' || echo "")
  if [[ "${CONF_PASS}" == "${FS_ESL_PASSWORD}" ]]; then
    pass "event_socket.conf.xml password matches .env FS_ESL_PASSWORD"
    info "Password length: ${#CONF_PASS} chars"
    if [[ "${CONF_PASS}" == *"#"* ]]; then
      fail "ESL password contains # — comment artifact leaked into XML"
    fi
  else
    fail "event_socket.conf.xml password does NOT match .env FS_ESL_PASSWORD"
    info "XML has:  [${CONF_PASS}]"
    info ".env has: [${FS_ESL_PASSWORD}]"
    info "Fix: sudo bash scripts/prepare-freeswitch.sh"
  fi
else
  fail "event_socket.conf.xml not found at ${ESL_CONF}"
fi

# Live ESL authentication test
if command -v fs_cli &>/dev/null; then
  FS_AUTH=$(fs_cli -x "status" 2>/dev/null | head -1 || echo "auth_failed")
  if echo "${FS_AUTH}" | grep -q "UP"; then
    pass "FreeSWITCH ESL authentication: SUCCESS (fs_cli connected)"
    info "Status: ${FS_AUTH}"
  else
    fail "FreeSWITCH ESL authentication FAILED — password mismatch or FS not running"
    info "Output: ${FS_AUTH}"
    info "Fix: sudo bash scripts/prepare-freeswitch.sh && sudo fs_cli -x 'reload mod_event_socket'"
  fi
else
  warn "fs_cli not found — skipping live ESL auth test"
fi

# ---------------------------------------------------------------------------
# 3. FREESWITCH DIRECTORIES — verify configured paths exist and match FS
# ---------------------------------------------------------------------------
step "3. FreeSWITCH Directories"

for VAR_DIR_PAIR in \
  "FS_CONF_DIR:${FS_CONF_DIR}" \
  "FS_SCRIPT_DIR:${FS_SCRIPT_DIR}" \
  "FS_RECORDING_DIR:${FS_RECORDING_DIR}"; do
  VAR="${VAR_DIR_PAIR%%:*}"
  DIR="${VAR_DIR_PAIR##*:}"
  if [[ -d "${DIR}" ]]; then
    pass "${VAR}: ${DIR} — exists"
  else
    fail "${VAR}: ${DIR} — MISSING (fix: sudo bash scripts/prepare-directories.sh)"
  fi
done

if command -v fs_cli &>/dev/null && fs_cli -x "status" 2>/dev/null | grep -q "UP"; then
  FS_CONF_LIVE=$(fs_cli -x "global_getvar conf_dir" 2>/dev/null | head -1 | tr -d '\r' || echo "")
  FS_SCRIPT_LIVE=$(fs_cli -x "global_getvar scripts_dir" 2>/dev/null | head -1 | tr -d '\r' || echo "")
  FS_REC_LIVE=$(fs_cli -x "global_getvar recordings_dir" 2>/dev/null | head -1 | tr -d '\r' || echo "")

  [[ "${FS_CONF_DIR}" == "${FS_CONF_LIVE}" ]] \
    && pass "FS_CONF_DIR matches FreeSWITCH conf_dir" \
    || warn "FS_CONF_DIR=[${FS_CONF_DIR}] != FreeSWITCH conf_dir=[${FS_CONF_LIVE}]"

  [[ "${FS_SCRIPT_DIR}" == "${FS_SCRIPT_LIVE}" ]] \
    && pass "FS_SCRIPT_DIR matches FreeSWITCH scripts_dir" \
    || warn "FS_SCRIPT_DIR=[${FS_SCRIPT_DIR}] != FreeSWITCH scripts_dir=[${FS_SCRIPT_LIVE}]"

  [[ "${FS_RECORDING_DIR}" == "${FS_REC_LIVE}" ]] \
    && pass "FS_RECORDING_DIR matches FreeSWITCH recordings_dir" \
    || warn "FS_RECORDING_DIR=[${FS_RECORDING_DIR}] != FreeSWITCH recordings_dir=[${FS_REC_LIVE}]"
else
  warn "FreeSWITCH not running — skipping live FS directory verification"
fi

# ---------------------------------------------------------------------------
# 4. NGINX INTERNAL API BLOCK — must return 403
# ---------------------------------------------------------------------------
step "4. Nginx Internal API Block"

INTERNAL_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 \
  "https://${SERVER_NAME}/enrs/api/v1/internal/ers/lookup" 2>/dev/null || echo "000")
if [[ "${INTERNAL_CODE}" == "403" ]]; then
  pass "Internal API blocked: HTTPS → HTTP 403"
else
  fail "Internal API returned HTTP ${INTERNAL_CODE} (expected 403)"
  info "Check: curl -k -i https://${SERVER_NAME}/enrs/api/v1/internal/ers/lookup"
fi

# ---------------------------------------------------------------------------
# 5. NGINX ROUTING — verify each sub-path (SERVER_NAME must be clean)
# ---------------------------------------------------------------------------
step "5. Nginx Routing (SERVER_NAME=[${SERVER_NAME}])"

for PATH_CHECK in "/cc/" "/agent/" "/enrs/" "/_health"; do
  URL="https://${SERVER_NAME}${PATH_CHECK}"
  CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${URL}" 2>/dev/null || echo "000")
  if [[ "${CODE}" =~ ^(200|301|302|304)$ ]]; then
    pass "${URL}: HTTP ${CODE}"
  else
    fail "${URL}: HTTP ${CODE}"
  fi
done

# ---------------------------------------------------------------------------
# 6. TLS VERIFICATION
# ---------------------------------------------------------------------------
step "6. TLS Certificate"

if [[ "${SERVER_NAME}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  CERT_INFO=$(echo Q | timeout 5 openssl s_client \
    -connect "${SERVER_NAME}:443" 2>/dev/null \
    | openssl x509 -noout -subject -enddate 2>/dev/null || true)
else
  CERT_INFO=$(echo Q | timeout 5 openssl s_client \
    -connect "${SERVER_NAME}:443" -servername "${SERVER_NAME}" 2>/dev/null \
    | openssl x509 -noout -subject -enddate 2>/dev/null || true)
fi

if [[ -z "${CERT_INFO}" ]]; then
  warn "Could not retrieve TLS certificate from ${SERVER_NAME}:443"
  info "Check: echo Q | openssl s_client -connect ${SERVER_NAME}:443"
else
  EXPIRY=$(echo "${CERT_INFO}" | grep notAfter | cut -d= -f2)
  EXPIRY_EPOCH=$(date -d "${EXPIRY}" +%s 2>/dev/null || echo 0)
  DAYS=$(( (EXPIRY_EPOCH - $(date +%s)) / 86400 ))
  if   [[ ${DAYS} -lt 0 ]];  then fail "TLS certificate EXPIRED ${DAYS#-} days ago"
  elif [[ ${DAYS} -lt 14 ]]; then fail "TLS certificate expires in ${DAYS} days"
  elif [[ ${DAYS} -lt 30 ]]; then warn "TLS certificate expires in ${DAYS} days"
  else                             pass "TLS certificate valid — ${DAYS} days remaining"
  fi
  echo "${CERT_INFO}" | grep -q "O = Omni Platform" \
    && warn "Self-signed certificate (acceptable for Phase 1)" || true
fi

# ---------------------------------------------------------------------------
# 7. REDIS — verify password parses correctly and PING succeeds
# ---------------------------------------------------------------------------
step "7. Redis"

if [[ "${REDIS_PASSWORD}" == *"#"* ]]; then
  fail "REDIS_PASSWORD contains # — parse_var did not strip comment. Fix parse_var and re-run."
else
  REDIS_PING=$(${COMPOSE} exec -T redis \
    redis-cli --no-auth-warning -a "${REDIS_PASSWORD}" ping 2>/dev/null | tr -d '\r' || echo "FAIL")
  if [[ "${REDIS_PING}" == "PONG" ]]; then
    pass "Redis PING: PONG (password correct)"
  else
    fail "Redis PING returned [${REDIS_PING}] — check REDIS_PASSWORD in .env"
    info "Parsed REDIS_PASSWORD length: ${#REDIS_PASSWORD} chars"
    info "Test manually: docker compose exec redis redis-cli -a '<password>' ping"
  fi
fi

# ---------------------------------------------------------------------------
# 8. CC DATABASE + ADMIN USER
# ---------------------------------------------------------------------------
step "8. CC Database and Admin User"

CC_TABLES=$(${COMPOSE} exec -T postgres \
  psql -U "${POSTGRES_ADMIN_USER}" -d "${CC_DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d ' \n' || echo "0")

if [[ "${CC_TABLES}" =~ ^[0-9]+$ ]] && [[ "${CC_TABLES}" -gt 0 ]]; then
  pass "CC database (${CC_DB_NAME}): ${CC_TABLES} tables"
else
  fail "CC database has no tables — run: bash scripts/post-install.sh"
fi

ADMIN_ROW=$(${COMPOSE} exec -T postgres \
  psql -U "${POSTGRES_ADMIN_USER}" -d "${CC_DB_NAME}" -t -c \
  "SELECT username, role FROM users WHERE username='admin';" \
  2>/dev/null | tr -d '\r' | grep -v '^$' || echo "")

if [[ -n "${ADMIN_ROW}" ]]; then
  pass "CC admin user exists: $(echo "${ADMIN_ROW}" | xargs)"
else
  fail "CC admin user not found — run: bash scripts/post-install.sh"
fi

# Test actual CC login API
info "Testing CC login API (admin / CC_ADMIN_PASSWORD) ..."
LOGIN_RESP=$(curl -sk --max-time 10 \
  -X POST "https://${SERVER_NAME}/cc/api/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"${CC_ADMIN_PASSWORD}\"}" \
  -w "\nHTTP_CODE:%{http_code}" 2>/dev/null || echo "CURL_FAILED")

HTTP_CODE=$(echo "${LOGIN_RESP}" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "${LOGIN_RESP}" | grep -v "HTTP_CODE:")

if [[ "${HTTP_CODE}" == "200" ]]; then
  pass "CC login API: HTTP 200 (admin authenticated)"
elif [[ "${HTTP_CODE}" == "401" ]]; then
  fail "CC login API: HTTP 401 (wrong password or user missing)"
  info "Body: ${BODY}"
  info "Check CC_ADMIN_PASSWORD in .env and re-run post-install.sh"
elif [[ "${HTTP_CODE}" == "404" ]]; then
  fail "CC login API: HTTP 404 — nginx routing issue (CC_API_BASE not set?)"
  info "CC_API_BASE=[${CC_API_BASE}]"
  info "Rebuild: docker compose build cc-frontend agent-desktop && docker compose up -d"
else
  warn "CC login API: HTTP ${HTTP_CODE} — ${BODY}"
fi

# ---------------------------------------------------------------------------
# 9. CC SEEDING IDEMPOTENCY — run seed twice, confirm no duplicates
# ---------------------------------------------------------------------------
step "9. CC Seeding Idempotency"

PRE_COUNT=$(${COMPOSE} exec -T postgres \
  psql -U "${POSTGRES_ADMIN_USER}" -d "${CC_DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM users WHERE username='admin';" \
  2>/dev/null | tr -d ' \n' || echo "0")

${COMPOSE} exec -T \
  -e CC_ADMIN_PASSWORD="${CC_ADMIN_PASSWORD}" \
  cc-backend node /app/scripts/seedUsers.js &>/dev/null || true

POST_COUNT=$(${COMPOSE} exec -T postgres \
  psql -U "${POSTGRES_ADMIN_USER}" -d "${CC_DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM users WHERE username='admin';" \
  2>/dev/null | tr -d ' \n' || echo "0")

if [[ "${PRE_COUNT}" == "${POST_COUNT}" ]] && [[ "${POST_COUNT}" == "1" ]]; then
  pass "Second seed run: no duplicate admin created (count stayed at 1)"
else
  fail "Seed idempotency failed: count was ${PRE_COUNT}, now ${POST_COUNT}"
fi

# ---------------------------------------------------------------------------
# 10. ENRS MIGRATION
# ---------------------------------------------------------------------------
step "10. ENRS Migration"

ENRS_TABLES=$(${COMPOSE} exec -T postgres \
  psql -U "${POSTGRES_ADMIN_USER}" -d "${ENRS_DB_NAME}" -t -c \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d ' \n' || echo "0")

if [[ "${ENRS_TABLES}" =~ ^[0-9]+$ ]] && [[ "${ENRS_TABLES}" -gt 10 ]]; then
  pass "ENRS database (${ENRS_DB_NAME}): ${ENRS_TABLES} tables"
else
  fail "ENRS database: ${ENRS_TABLES} tables (expected >10)"
  info "Check: docker compose logs enrs-backend | grep -i migrat"
fi

# ENRS health
ENRS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  "http://127.0.0.1:${ENRS_BACKEND_PORT}/health/ready" 2>/dev/null || echo "000")
[[ "${ENRS_CODE}" == "200" ]] \
  && pass "ENRS /health/ready: HTTP 200" \
  || fail "ENRS /health/ready: HTTP ${ENRS_CODE}"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   Summary${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"
echo -e "  ${GREEN}PASS${NC}  ${PASS}"
echo -e "  ${YELLOW}WARN${NC}  ${WARN}"
echo -e "  ${RED}FAIL${NC}  ${FAIL}"
echo ""

if [[ ${FAIL} -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}RESULT: FAILED — address FAIL items before going live${NC}"
  exit 1
elif [[ ${WARN} -gt 0 ]]; then
  echo -e "  ${YELLOW}${BOLD}RESULT: WARNINGS — review WARN items${NC}"
else
  echo -e "  ${GREEN}${BOLD}RESULT: ALL VALIDATION CHECKS PASSED${NC}"
fi
echo ""
