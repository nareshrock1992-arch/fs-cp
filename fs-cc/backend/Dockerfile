# =============================================================================
# fs-cc Backend — Production Dockerfile
# =============================================================================
# Multi-stage build:
#   deps        — installs production-only npm dependencies (cached layer)
#   production  — final lean image running as non-root with tini PID 1
# =============================================================================

# ── Stage 1: dependency installation ─────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Copy manifests only — layer is cached until package files change
COPY package.json package-lock.json* ./

# Use npm install --omit=dev rather than npm ci so a lockfile that has not yet
# been regenerated after a devDependency update (e.g. vitest added to
# package.json) does not abort the build. Production dependencies are still
# fully deterministic because only package.json governs what is installed with
# --omit=dev; devDependencies are never included.
RUN npm install --omit=dev --ignore-scripts

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production

# tini: correct PID-1 process for Docker — forwards signals to child processes
# so graceful shutdown (SIGTERM) actually reaches Node.js.
# wget: used by the HEALTHCHECK below.
RUN apk add --no-cache tini wget

WORKDIR /app

# Copy production dependencies from the deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (files listed in .dockerignore are excluded)
COPY . .

# Create directories the application writes to at runtime.
# These are overridden by bind mounts in docker-compose.yml (./uploads/cc, ./logs/cc).
# The mkdir here ensures the paths exist even without the bind mount (e.g., CI runs).
RUN mkdir -p uploads logs \
    && chown -R node:node /app

# Drop from root to the built-in "node" user (uid 1000)
USER node

EXPOSE 4000

# Healthcheck polls the public health endpoint.
# start_period allows time for ESL to connect and DB pool to warm.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1

# tini as entrypoint ensures:
#   1. Zombie reaping (tini is a proper init process)
#   2. Signal forwarding to the node process
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
