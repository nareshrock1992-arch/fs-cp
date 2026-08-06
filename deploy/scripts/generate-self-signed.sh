#!/usr/bin/env bash
# generate-self-signed.sh
# Create a self-signed TLS certificate for Phase 1 deployment (IP access).
#
# Reads SERVER_NAME from deploy/.env.
# Writes deploy/ssl/fullchain.pem and deploy/ssl/privkey.pem.
#
# Usage (from repo root):
#   bash deploy/scripts/generate-self-signed.sh
#
# Run BEFORE: docker compose up -d
# Replace with a real certificate for Phase 2 (domain access).

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

[[ -f "${ENV_FILE}" ]] || die "${ENV_FILE} not found.\n       Run: cp ${DEPLOY_DIR}/.env.example ${ENV_FILE} && nano ${ENV_FILE}"

SERVER_NAME=$(grep -E '^SERVER_NAME=' "${ENV_FILE}" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
[[ -n "${SERVER_NAME}" ]] || die "SERVER_NAME is not set in ${ENV_FILE}"

SSL_DIR="${DEPLOY_DIR}/ssl"
CERT="${SSL_DIR}/fullchain.pem"
KEY="${SSL_DIR}/privkey.pem"

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------
step "Checking prerequisites"
command -v openssl &>/dev/null || die "openssl is not installed.\n       apt-get install -y openssl"
success "openssl found: $(openssl version)"

# ---------------------------------------------------------------------------
# Skip if certificate still valid
# ---------------------------------------------------------------------------
if [[ -f "${CERT}" && -f "${KEY}" ]]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "${CERT}" 2>/dev/null | cut -d= -f2 || true)
  if [[ -n "${EXPIRY}" ]]; then
    EXPIRY_EPOCH=$(date -d "${EXPIRY}" +%s 2>/dev/null || echo 0)
    DAYS_LEFT=$(( (EXPIRY_EPOCH - $(date +%s)) / 86400 ))
    if [[ ${DAYS_LEFT} -gt 30 ]]; then
      step "Certificate check"
      success "Certificate exists and expires in ${DAYS_LEFT} days — skipping generation"
      info "  CN:     $(openssl x509 -subject -noout -in "${CERT}" 2>/dev/null | sed 's/.*CN\s*=\s*//')"
      info "  Expiry: ${EXPIRY}"
      exit 0
    else
      warn "Certificate expires in ${DAYS_LEFT} days — regenerating"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Generate
# ---------------------------------------------------------------------------
step "Generating self-signed certificate"
info "  CN: ${SERVER_NAME}"
info "  Output: ${SSL_DIR}/"

mkdir -p "${SSL_DIR}"

openssl req -x509 -nodes \
  -newkey rsa:2048 \
  -keyout "${KEY}" \
  -out "${CERT}" \
  -days 365 \
  -subj "/CN=${SERVER_NAME}/O=Omni Platform/C=US" \
  -addext "subjectAltName=IP:${SERVER_NAME},DNS:${SERVER_NAME}" \
  2>/dev/null

chmod 600 "${KEY}"
chmod 644 "${CERT}"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
step "Done"
success "Certificate: ${CERT}"
success "Private key: ${KEY}"
echo ""
info "Fingerprint (SHA-256):"
openssl x509 -fingerprint -noout -sha256 -in "${CERT}" | sed 's/^/    /'
echo ""
warn "This is a self-signed certificate."
warn "Browsers will display a security warning — accept it for Phase 1 access."
info "See DEPLOYMENT_GUIDE.md Phase 2 for replacing with a real certificate."
