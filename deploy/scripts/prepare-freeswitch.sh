#!/usr/bin/env bash
# prepare-freeswitch.sh
# Apply Omni Platform integration settings to FreeSWITCH configuration.
#
# What this script does:
#   1. Updates event_socket.conf.xml with FS_ESL_PASSWORD from .env
#   2. Writes FS_INTERNAL_KEY and ENRS_API_URL into vars.xml
#   3. Reloads FreeSWITCH config if the process is running
#
# All edits are backed up before modification (.bak.YYYYMMDDHHMMSS suffix).
#
# Usage (from repo root):
#   sudo bash deploy/scripts/prepare-freeswitch.sh
#
# Run BEFORE: docker compose up -d
# Re-run after changing FS_ESL_PASSWORD or INTERNAL_API_KEY in .env.

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
# Must run as root
# ---------------------------------------------------------------------------
[[ "${EUID}" -eq 0 ]] || die "This script must be run as root.\n       Run: sudo bash $0"

# ---------------------------------------------------------------------------
# Locate .env
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${DEPLOY_DIR}/.env"

[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} not found."

parse_var() {
  grep -E "^${1}=" "${ENV_FILE}" \
    | head -1 \
    | cut -d= -f2- \
    | sed -E 's/[[:space:]]+#.*$//' \
    | tr -d '"'"'"
}

FS_CONF_DIR=$(parse_var FS_CONF_DIR)
FS_ESL_PASSWORD=$(parse_var FS_ESL_PASSWORD)
INTERNAL_API_KEY=$(parse_var INTERNAL_API_KEY)
ENRS_API_URL=$(parse_var ENRS_API_URL)

# ---------------------------------------------------------------------------
# Validate — reject placeholders
# ---------------------------------------------------------------------------
step "Validating .env"

[[ -n "${FS_CONF_DIR}" ]]     || die "FS_CONF_DIR is not set in ${ENV_FILE}"
[[ -n "${FS_ESL_PASSWORD}" ]] || die "FS_ESL_PASSWORD is not set in ${ENV_FILE}"
[[ -n "${INTERNAL_API_KEY}" ]] || die "INTERNAL_API_KEY is not set in ${ENV_FILE}"
[[ -n "${ENRS_API_URL}" ]]    || die "ENRS_API_URL is not set in ${ENV_FILE}"

[[ "${FS_ESL_PASSWORD}" != *"CHANGE_ME"* ]] \
  || die "FS_ESL_PASSWORD is still a placeholder. Set a real password in ${ENV_FILE}."
[[ "${INTERNAL_API_KEY}" != "REPLACE_WITH_RANDOM_HEX_32" ]] \
  || die "INTERNAL_API_KEY is still a placeholder.\n       Generate: openssl rand -hex 32"
[[ -d "${FS_CONF_DIR}" ]] \
  || die "FS_CONF_DIR does not exist: ${FS_CONF_DIR}\n       Run prepare-directories.sh first."

success "FS_CONF_DIR:      ${FS_CONF_DIR}"
success "FS_ESL_PASSWORD:  (set, ${#FS_ESL_PASSWORD} chars)"
success "INTERNAL_API_KEY: (set, ${#INTERNAL_API_KEY} chars)"
success "ENRS_API_URL:     ${ENRS_API_URL}"

# ---------------------------------------------------------------------------
# 1. event_socket.conf.xml — ESL password
# ---------------------------------------------------------------------------
step "event_socket.conf.xml — ESL password"

ESL_CONF="${FS_CONF_DIR}/autoload_configs/event_socket.conf.xml"
AUTOLOAD_DIR="$(dirname "${ESL_CONF}")"

if [[ ! -f "${ESL_CONF}" ]]; then
  warn "${ESL_CONF} not found — creating minimal config"
  mkdir -p "${AUTOLOAD_DIR}"
  cat > "${ESL_CONF}" <<XMLEOF
<configuration name="event_socket.conf" description="Socket Client">
  <settings>
    <param name="nat-map" value="false"/>
    <param name="listen-ip" value="127.0.0.1"/>
    <param name="listen-port" value="8021"/>
    <param name="password" value="${FS_ESL_PASSWORD}"/>
    <param name="apply-inbound-acl" value="loopback.auto"/>
  </settings>
</configuration>
XMLEOF
  success "Created: ${ESL_CONF}"
else
  BACKUP="${ESL_CONF}.bak.$(date +%Y%m%d%H%M%S)"
  cp "${ESL_CONF}" "${BACKUP}"
  info "Backup: ${BACKUP}"

  if grep -q 'name="password"' "${ESL_CONF}"; then
    sed -i 's|name="password" value="[^"]*"|name="password" value="'"${FS_ESL_PASSWORD}"'"|g' "${ESL_CONF}"
    success "Updated ESL password in ${ESL_CONF}"
  else
    warn "Could not find <param name=\"password\"> — edit manually:"
    warn "  ${ESL_CONF}"
    warn "  Set: <param name=\"password\" value=\"${FS_ESL_PASSWORD}\"/>"
  fi
fi

# Verify listen-ip
LISTEN_IP=$(grep 'name="listen-ip"' "${ESL_CONF}" 2>/dev/null | grep -o 'value="[^"]*"' | cut -d'"' -f2 || echo "unset")
info "listen-ip is: ${LISTEN_IP}"
if [[ "${LISTEN_IP}" == "127.0.0.1" || "${LISTEN_IP}" == "0.0.0.0" || "${LISTEN_IP}" == "::" ]]; then
  success "listen-ip is acceptable for Docker containers via host.docker.internal"
else
  warn "listen-ip is '${LISTEN_IP}' — Docker containers connect via host.docker.internal:8021"
  warn "Ensure the host firewall allows the Docker bridge (172.30.0.0/24) to reach port 8021"
fi

# ---------------------------------------------------------------------------
# 2. vars.xml — FS_INTERNAL_KEY and ENRS_API_URL
# ---------------------------------------------------------------------------
step "vars.xml — Lua integration variables"

VARS_XML="${FS_CONF_DIR}/vars.xml"
[[ -f "${VARS_XML}" ]] || die "${VARS_XML} not found.\n       Is FreeSWITCH installed at ${FS_CONF_DIR}?"

BACKUP="${VARS_XML}.bak.$(date +%Y%m%d%H%M%S)"
cp "${VARS_XML}" "${BACKUP}"
info "Backup: ${BACKUP}"

write_var() {
  local FILE="$1" NAME="$2" VALUE="$3"
  local ESCAPED_VALUE
  ESCAPED_VALUE=$(printf '%s\n' "${VALUE}" | sed 's/[[\.*^$()+?{|]/\\&/g')

  if grep -q "\"${NAME}\"" "${FILE}" 2>/dev/null; then
    # Update existing data= attribute
    sed -i "s|name=\"${NAME}\" data=\"[^\"]*\"|name=\"${NAME}\" data=\"${ESCAPED_VALUE}\"|g" "${FILE}"
    success "Updated: \$\${${NAME}}"
  else
    # Append before </include>
    sed -i "s|</include>|  <X-PRE-PROCESS cmd=\"set\" data=\"${NAME}=${ESCAPED_VALUE}\"/>\n</include>|" "${FILE}"
    success "Added:   \$\${${NAME}}"
  fi
}

write_var "${VARS_XML}" "FS_INTERNAL_KEY" "${INTERNAL_API_KEY}"
write_var "${VARS_XML}" "ENRS_API_URL"    "${ENRS_API_URL}"

# ---------------------------------------------------------------------------
# 3. Reload FreeSWITCH
# ---------------------------------------------------------------------------
step "FreeSWITCH reload"

if command -v fs_cli &>/dev/null && fs_cli -x "status" &>/dev/null 2>&1; then
  info "FreeSWITCH is running — reloading configuration"
  fs_cli -x "reloadxml"            2>&1 | grep -v "^$" | sed 's/^/    /' || true
  fs_cli -x "reload mod_event_socket" 2>&1 | grep -v "^$" | sed 's/^/    /' || true
  success "Configuration reloaded"

  info "Verifying Lua variables:"
  KEY_CHECK=$(fs_cli -x "global_getvar FS_INTERNAL_KEY" 2>/dev/null | head -1 || echo "")
  URL_CHECK=$(fs_cli -x "global_getvar ENRS_API_URL"    2>/dev/null | head -1 || echo "")
  [[ -n "${KEY_CHECK}" && "${KEY_CHECK}" != "REPLACE_WITH_RANDOM_HEX_32" ]] \
    && success "FS_INTERNAL_KEY is set" || warn "FS_INTERNAL_KEY not visible — may need FS restart"
  [[ -n "${URL_CHECK}" ]] \
    && success "ENRS_API_URL = ${URL_CHECK}" || warn "ENRS_API_URL not visible — may need FS restart"
else
  warn "FreeSWITCH is not running or fs_cli is unavailable"
  info "Configuration changes will take effect on next FreeSWITCH start"
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
step "Done"
success "FreeSWITCH integration configured."
echo ""
info "After FreeSWITCH starts, verify with:"
info "  fs_cli -x \"global_getvar FS_INTERNAL_KEY\""
info "  fs_cli -x \"global_getvar ENRS_API_URL\""
echo ""
info "Next step:"
info "  bash deploy/scripts/generate-self-signed.sh"
