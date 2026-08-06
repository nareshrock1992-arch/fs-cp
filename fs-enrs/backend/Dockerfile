# =============================================================================
# fs-enrs Backend — Production Dockerfile
# =============================================================================
# Multi-stage build:
#   deps        — installs production-only npm dependencies (cached layer)
#   production  — final lean image running as non-root with tini PID 1
# =============================================================================

# ── Stage 1: dependency installation ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --ignore-scripts; \
    else \
      npm install --omit=dev --ignore-scripts; \
    fi

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production

# tini for correct PID-1 signal forwarding; wget for HEALTHCHECK
RUN apk add --no-cache tini wget

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The ENRS backend auto-runs migrate.js on startup (server.js calls it before
# binding the HTTP server), so no manual migration step is required.
RUN mkdir -p uploads logs recordings \
    && chown -R node:node /app

USER node

EXPOSE 4100

# ENRS exposes richer health endpoints:
#   /health/live  — process is alive (no external deps)
#   /health/ready — DB + ESL connections established (gates load balancer traffic)
# Use /health/ready so Docker only marks the container healthy when it can
# actually serve real requests.
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=3 \
  CMD wget -qO- http://localhost:4100/health/ready || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
