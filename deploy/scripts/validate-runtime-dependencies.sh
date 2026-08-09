#!/usr/bin/env bash
# validate-runtime-dependencies.sh
# Air-gapped pre-flight dependency check for the Omni Platform.
#
# Run this script ON THE FREESWITCH HOST before first deployment and after
# any OS-level package changes. It checks every dependency proven by audit
# to be required for correct runtime operation.
#
# Usage:
#   bash deploy/scripts/validate-runtime-dependencies.sh
#
# Exit code:
#   0 — all CRITICAL checks passed (WARNs may still be present)
#   1 — one or more CRITICAL checks failed
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY EACH DEPENDENCY IS CHECKED
# ─────────────────────────────────────────────────────────────────────────────
# curl (FreeSWITCH HOST):
#   Every Lua script invokes curl via io.popen() for all HTTP calls to the
#   ENRS backend. There are 3 hand-written Lua scripts (ens_blast_trigger.lua,
#   ens_playback_handler.lua, ers_conference_bridge.lua) and generated
#   ivr_executor*.lua scripts — ALL use io.popen("curl ..."). A missing curl on
#   the FreeSWITCH host causes SILENT failure: Lua gets an empty response and
#   falls through to error paths without any visible crash.
#
#   IMPORTANT: curl inside the enrs-backend Docker container does NOT satisfy
#   this requirement. Lua runs inside FreeSWITCH on the HOST OS. Docker and
#   the HOST OS are entirely separate dependency surfaces.
#
# FreeSWITCH modules:
#   mod_lua    — required to run any Lua scripts
#   mod_event_socket — required for ESL (backend ↔ FreeSWITCH communication)
#   mod_sofia  — required for SIP call handling
#   mod_conference — required for ERS conference bridges
#
# Docker:
#   All application services run in Docker containers.
#
# openssl (deployment machine):
#   generate-self-signed.sh uses openssl to create TLS certs.
# ─────────────────────────────────────────────────────────────────────────────

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

CRITICAL_FAIL=0

pass()     { echo -e "  ${GREEN}[PASS]${NC}  $1"; }
warn()     { echo -e "  ${YELLOW}[WARN]${NC}  $1"; }
fail_crit(){ echo -e "  ${RED}[FAIL]${NC}  $1"; CRITICAL_FAIL=$((CRITICAL_FAIL+1)); }
step()     { echo -e "\n${BOLD}━━━  $1  ━━━${NC}"; }
info()     { echo -e "        ${BLUE}→${NC} $1"; }

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   Omni Platform — Runtime Dependency Pre-flight Check    ${NC}"
echo -e "${BOLD}   $(date)                                                ${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"

# ─────────────────────────────────────────────────────────────────────────────
# 1. FreeSWITCH HOST OS — CRITICAL dependencies
#    These must exist on the HOST machine where FreeSWITCH runs.
#    Docker containers cannot satisfy these requirements.
# ─────────────────────────────────────────────────────────────────────────────
step "FreeSWITCH HOST OS dependencies  [CRITICAL]"

echo ""
echo -e "  ${YELLOW}NOTE: The checks below probe the HOST OS, not any Docker container.${NC}"
echo -e "  ${YELLOW}      curl inside a Docker image does NOT satisfy Lua's curl requirement.${NC}"
echo ""

# curl — CRITICAL: every Lua script uses io.popen("curl ...") for HTTP
if command -v curl &>/dev/null; then
  CURL_VER=$(curl --version 2>/dev/null | head -1)
  pass "curl available on FreeSWITCH host: ${CURL_VER}"
else
  fail_crit "curl NOT FOUND on FreeSWITCH host"
  info "All Lua scripts (ens_blast_trigger.lua, ens_playback_handler.lua,"
  info "ers_conference_bridge.lua, ivr_executor*.lua) call curl via io.popen()."
  info "Without curl, every HTTP call to the ENRS backend silently returns empty."
  info "Fix (Debian/Ubuntu): sudo apt-get install -y curl"
  info "Fix (RHEL/CentOS):   sudo yum install -y curl"
fi

# FreeSWITCH itself
if command -v freeswitch &>/dev/null || command -v fs_cli &>/dev/null; then
  FS_CMD=$(command -v fs_cli 2>/dev/null || command -v freeswitch 2>/dev/null)
  pass "FreeSWITCH found: ${FS_CMD}"
else
  fail_crit "FreeSWITCH not found on this host"
  info "FreeSWITCH must be installed on the HOST OS — it does NOT run in Docker."
  info "Install: https://freeswitch.org/confluence/display/FREESWITCH/Installation"
fi

# Core utilities used by deploy scripts (always available but verify)
for CMD in mkdir cp sed grep id; do
  if command -v "$CMD" &>/dev/null; then
    pass "coreutil: ${CMD}"
  else
    fail_crit "coreutil missing: ${CMD}"
    info "Install coreutils package for your distro."
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# 2. FreeSWITCH modules — check if FS is running and modules are loaded
# ─────────────────────────────────────────────────────────────────────────────
step "FreeSWITCH modules  [CRITICAL if FS is running]"

if command -v fs_cli &>/dev/null && fs_cli -x "status" &>/dev/null 2>&1; then
  FS_STATUS=$(fs_cli -x "status" 2>/dev/null | head -1 || echo "")
  if echo "${FS_STATUS}" | grep -q "UP"; then
    pass "FreeSWITCH is running: ${FS_STATUS}"

    # mod_lua — required for all Lua scripts
    if fs_cli -x "module_exists mod_lua" 2>/dev/null | grep -qi "true\|yes\|loaded"; then
      pass "mod_lua: loaded"
    else
      # Try listing modules
      MOD_LUA=$(fs_cli -x "show modules" 2>/dev/null | grep -c "mod_lua" || echo "0")
      if [[ "${MOD_LUA}" -gt 0 ]]; then
        pass "mod_lua: present in module list"
      else
        fail_crit "mod_lua: NOT loaded"
        info "mod_lua is required for all Lua scripts (ERS, ENS, IVR)."
        info "Enable in /etc/freeswitch/autoload_configs/modules.conf.xml:"
        info "  <load module=\"mod_lua\"/>"
        info "Then: fs_cli -x 'load mod_lua'"
      fi
    fi

    # mod_event_socket — required for ESL (backend ↔ FS)
    ESL_MOD=$(fs_cli -x "show modules" 2>/dev/null | grep -c "mod_event_socket" || echo "0")
    if [[ "${ESL_MOD}" -gt 0 ]]; then
      pass "mod_event_socket: present"
    else
      fail_crit "mod_event_socket: NOT loaded"
      info "mod_event_socket is required for the ENRS/CC backend ESL connection."
      info "Enable: <load module=\"mod_event_socket\"/> in modules.conf.xml"
    fi

    # mod_sofia — required for SIP
    SOFIA_MOD=$(fs_cli -x "show modules" 2>/dev/null | grep -c "mod_sofia" || echo "0")
    if [[ "${SOFIA_MOD}" -gt 0 ]]; then
      pass "mod_sofia: present"
    else
      fail_crit "mod_sofia: NOT loaded"
      info "mod_sofia is required for all SIP call handling."
    fi

    # mod_conference — required for ERS conference bridges
    CONF_MOD=$(fs_cli -x "show modules" 2>/dev/null | grep -c "mod_conference" || echo "0")
    if [[ "${CONF_MOD}" -gt 0 ]]; then
      pass "mod_conference: present"
    else
      fail_crit "mod_conference: NOT loaded"
      info "mod_conference is required for ERS emergency conference bridges."
    fi

    # mod_flite — TTS (WARN only — not all deployments need TTS)
    FLITE_MOD=$(fs_cli -x "show modules" 2>/dev/null | grep -c "mod_flite\|mod_tts_commandline" || echo "0")
    if [[ "${FLITE_MOD}" -gt 0 ]]; then
      pass "TTS module (mod_flite or mod_tts_commandline): present"
    else
      warn "No TTS module found (mod_flite / mod_tts_commandline)"
      info "Lua scripts call speak() using the engine set in ENRS_TTS_ENGINE env var."
      info "Default: flite. If TTS is not needed, set TTS engine to a no-op."
      info "If TTS is needed: apt-get install freeswitch-mod-flite (Debian)"
    fi

    # Verify Lua integration variables
    echo ""
    info "Checking FreeSWITCH Lua integration variables:"
    IKEY=$(fs_cli -x "global_getvar FS_INTERNAL_KEY" 2>/dev/null | head -1 | tr -d '\r' || echo "")
    EURL=$(fs_cli -x "global_getvar ENRS_API_URL"    2>/dev/null | head -1 | tr -d '\r' || echo "")

    if [[ -n "${IKEY}" && "${IKEY}" != "REPLACE_WITH_RANDOM_HEX_32" && "${IKEY}" != "err" ]]; then
      pass "FS_INTERNAL_KEY: set (${#IKEY} chars)"
    else
      fail_crit "FS_INTERNAL_KEY: not set or still placeholder in vars.xml"
      info "Run: sudo bash deploy/scripts/prepare-freeswitch.sh"
    fi

    if [[ -n "${EURL}" && "${EURL}" != "err" ]]; then
      pass "ENRS_API_URL: ${EURL}"
    else
      fail_crit "ENRS_API_URL: not set in vars.xml"
      info "Run: sudo bash deploy/scripts/prepare-freeswitch.sh"
    fi

  else
    warn "FreeSWITCH is NOT running — skipping module checks"
    info "Start FreeSWITCH and re-run this script to check module availability."
  fi
else
  warn "fs_cli not found or FreeSWITCH not reachable — skipping module checks"
  info "Install fs_cli or start FreeSWITCH and re-run."
fi

# ─────────────────────────────────────────────────────────────────────────────
# 3. Docker — required to run all application containers
# ─────────────────────────────────────────────────────────────────────────────
step "Docker  [CRITICAL]"

if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
  DOCKER_VER=$(docker --version | grep -oP '\d+\.\d+(\.\d+)?' | head -1 || echo "unknown")
  pass "Docker running: ${DOCKER_VER}"
else
  fail_crit "Docker is not running or not installed"
  info "Install Docker Engine: https://docs.docker.com/engine/install/"
  info "Start: sudo systemctl start docker && sudo systemctl enable docker"
fi

COMPOSE_CMD=""
if docker compose version &>/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
  pass "Docker Compose v2 plugin: available"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
  pass "Docker Compose standalone: available"
else
  fail_crit "Docker Compose not found"
  info "Install Docker Compose plugin: sudo apt-get install docker-compose-plugin"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Deployment machine tools — needed to run deploy scripts
# ─────────────────────────────────────────────────────────────────────────────
step "Deployment machine tools  [WARN if missing]"

if command -v openssl &>/dev/null; then
  OSSL_VER=$(openssl version | head -1)
  pass "openssl: ${OSSL_VER}"
else
  warn "openssl not found"
  info "openssl is required by generate-self-signed.sh and validate-deployment.sh"
  info "Fix: sudo apt-get install -y openssl"
fi

# curl on deployment machine (validate-deployment.sh and post-install.sh use it)
if command -v curl &>/dev/null; then
  pass "curl on deployment machine: available (also needed by deploy scripts)"
else
  warn "curl not found on deployment machine"
  info "post-install.sh and validate-deployment.sh use curl to probe health endpoints."
  info "Fix: sudo apt-get install -y curl"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 5. Container healthchecks (optional — only useful after docker compose up)
# ─────────────────────────────────────────────────────────────────────────────
step "Container health (runs if containers are up)"

if [[ -n "${COMPOSE_CMD}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  DEPLOY_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
  cd "${DEPLOY_DIR}" 2>/dev/null || true

  if ${COMPOSE_CMD} ps 2>/dev/null | grep -q "running\|healthy\|Up"; then
    SERVICES=(postgres redis cc-backend enrs-backend cc-frontend agent-desktop enrs-frontend nginx)
    for SVC in "${SERVICES[@]}"; do
      SVC_ID=$(${COMPOSE_CMD} ps -q "${SVC}" 2>/dev/null | head -1 || echo "")
      if [[ -z "${SVC_ID}" ]]; then
        warn "${SVC}: not running"
        continue
      fi
      HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "${SVC_ID}" 2>/dev/null || echo "no healthcheck")
      case "${HEALTH}" in
        healthy)   pass "${SVC}: healthy" ;;
        starting)  warn "${SVC}: still starting" ;;
        unhealthy) fail_crit "${SVC}: unhealthy — check: docker compose logs ${SVC}" ;;
        *)         info "${SVC}: ${HEALTH}" ;;
      esac
    done
  else
    info "No containers currently running — skipping container health checks."
    info "Run 'docker compose up -d' then re-run this script."
  fi
else
  warn "Docker Compose not available — skipping container health checks."
fi

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   Summary${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════════════${NC}"
echo ""

if [[ ${CRITICAL_FAIL} -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}ALL CRITICAL CHECKS PASSED${NC}"
  echo -e "  ${GREEN}System meets air-gapped deployment requirements.${NC}"
  echo ""
  exit 0
else
  echo -e "  ${RED}${BOLD}${CRITICAL_FAIL} CRITICAL CHECK(S) FAILED${NC}"
  echo -e "  ${RED}Address all FAIL items before proceeding with deployment.${NC}"
  echo ""
  echo -e "  Most common blockers:"
  echo -e "    1. curl missing on FreeSWITCH host → apt-get install -y curl"
  echo -e "    2. FreeSWITCH modules not loaded → check /etc/freeswitch/autoload_configs/modules.conf.xml"
  echo -e "    3. FS_INTERNAL_KEY / ENRS_API_URL not set → sudo bash deploy/scripts/prepare-freeswitch.sh"
  echo ""
  exit 1
fi
