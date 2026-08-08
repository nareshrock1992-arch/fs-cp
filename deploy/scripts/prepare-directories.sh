#!/usr/bin/env bash
# prepare-directories.sh
# Create all host directories required by the Omni platform.
#
# Creates:
#   - FreeSWITCH directories (mounted into backend containers as volumes)
#   - Application directories (logs, uploads, ssl, acme webroot)
#
# Usage (from repo root):
#   sudo bash deploy/scripts/prepare-directories.sh
#
# Run BEFORE: docker compose up -d

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
created() { echo -e "${GREEN}  NEW ${NC}  $1"; }
exists()  { echo -e "${BLUE}  ---${NC}   $1 (already exists)"; }

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

[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} not found.\n       Run: cp ${DEPLOY_DIR}/.env.example ${ENV_FILE} && nano ${ENV_FILE}"

parse_var() {
  grep -E "^${1}=" "${ENV_FILE}" \
    | head -1 \
    | cut -d= -f2- \
    | sed -E 's/[[:space:]]+#.*$//' \
    | tr -d '"'"'"
}

# ---------------------------------------------------------------------------
# Load FS_* paths
# ---------------------------------------------------------------------------
FS_CONF_DIR=$(parse_var FS_CONF_DIR)
FS_DIALPLAN_DIR=$(parse_var FS_DIALPLAN_DIR)
FS_DIRECTORY_DIR=$(parse_var FS_DIRECTORY_DIR)
FS_SIP_PROFILE_DIR=$(parse_var FS_SIP_PROFILE_DIR)
FS_SCRIPT_DIR=$(parse_var FS_SCRIPT_DIR)
FS_SOUND_DIR=$(parse_var FS_SOUND_DIR)
FS_RECORDING_DIR=$(parse_var FS_RECORDING_DIR)
FS_STORAGE_DIR=$(parse_var FS_STORAGE_DIR)
FS_DB_DIR=$(parse_var FS_DB_DIR)
FS_LOG_DIR=$(parse_var FS_LOG_DIR)

step "Validating .env"
MISSING=0
for VAR in FS_CONF_DIR FS_DIALPLAN_DIR FS_DIRECTORY_DIR FS_SIP_PROFILE_DIR \
           FS_SCRIPT_DIR FS_SOUND_DIR FS_RECORDING_DIR FS_STORAGE_DIR \
           FS_DB_DIR FS_LOG_DIR; do
  VALUE=$(eval echo "\$$VAR")
  if [[ -z "${VALUE}" || "${VALUE}" == *"CHANGE_ME"* ]]; then
    warn "${VAR} is not set or is a placeholder in ${ENV_FILE}"
    MISSING=1
  else
    success "${VAR}=${VALUE}"
  fi
done
[[ "${MISSING}" -eq 0 ]] || die "Fix the missing variables in ${ENV_FILE} then re-run."

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------
make_dir() {
  local DIR="$1"
  local OWNER="${2:-}"
  if [[ -d "${DIR}" ]]; then
    exists "${DIR}"
  else
    mkdir -p "${DIR}"
    created "${DIR}"
  fi
  if [[ -n "${OWNER}" ]]; then
    chown "${OWNER}:${OWNER}" "${DIR}" 2>/dev/null || true
  fi
}

# ---------------------------------------------------------------------------
# FreeSWITCH directories
# ---------------------------------------------------------------------------
step "FreeSWITCH directories"
info "These directories are mounted into backend containers as volumes."
info "FreeSWITCH must own its config dirs — chown to 'freeswitch' if that user exists."

FS_USER="root"
id freeswitch &>/dev/null && FS_USER="freeswitch"
info "FreeSWITCH owner: ${FS_USER}"

make_dir "${FS_CONF_DIR}"          "${FS_USER}"
make_dir "${FS_DIALPLAN_DIR}"      "${FS_USER}"
make_dir "${FS_DIRECTORY_DIR}"     "${FS_USER}"
make_dir "${FS_SIP_PROFILE_DIR}"   "${FS_USER}"
make_dir "${FS_SCRIPT_DIR}"        "${FS_USER}"
make_dir "${FS_SOUND_DIR}"         "${FS_USER}"
make_dir "${FS_RECORDING_DIR}"     "${FS_USER}"
make_dir "${FS_STORAGE_DIR}"       "${FS_USER}"
make_dir "${FS_DB_DIR}"            "${FS_USER}"
make_dir "${FS_LOG_DIR}"           "${FS_USER}"

# ---------------------------------------------------------------------------
# Application directories
# ---------------------------------------------------------------------------
step "Application directories (owned by uid 1000 — container node user)"

APP_DIRS=(
  "${DEPLOY_DIR}/ssl"
  "${DEPLOY_DIR}/ssl/acme"
  "${DEPLOY_DIR}/logs/nginx"
  "${DEPLOY_DIR}/logs/cc-backend"
  "${DEPLOY_DIR}/logs/enrs-backend"
  "${DEPLOY_DIR}/uploads/cc"
  "${DEPLOY_DIR}/uploads/enrs"
)

for DIR in "${APP_DIRS[@]}"; do
  make_dir "${DIR}"
  chown -R 1000:1000 "${DIR}" 2>/dev/null || true
done

# ---------------------------------------------------------------------------
# Permissions check
# ---------------------------------------------------------------------------
step "Permissions check"
for DIR in "${FS_RECORDING_DIR}" "${FS_STORAGE_DIR}" "${FS_SCRIPT_DIR}"; do
  if [[ -w "${DIR}" ]]; then
    success "Writable: ${DIR}"
  else
    warn "Not writable: ${DIR} — backend containers may fail to write here"
  fi
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
step "Done"
success "All directories are ready."
echo ""
info "Next step:"
info "  sudo bash deploy/scripts/prepare-freeswitch.sh"
