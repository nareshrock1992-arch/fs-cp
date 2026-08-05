# =============================================================================
# fs-cc Frontend — Production Dockerfile
# =============================================================================
# Multi-stage:
#   build   — Vite build with sub-path base and socket path baked in
#   serve   — nginx:alpine serving the static bundle
# =============================================================================

# ── Stage 1: Vite build ────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# Build-time configuration.
# These are intentionally ARGs (not ENV) so they are baked into the static
# bundle at build time. They cannot be changed at runtime — the image must be
# rebuilt if these values change.
#
# VITE_BASE_PATH  — Vite's --base option. Sets import.meta.env.BASE_URL which
#                   BrowserRouter uses as its basename. Must end with "/".
# VITE_SOCKET_PATH — Path the Socket.IO client sends the upgrade request to.
#                    Must match the SOCKET_PATH env on the cc-backend container
#                    and the nginx location block.
ARG VITE_BASE_PATH=/cc/
ARG VITE_SOCKET_PATH=/cc/socket.io

# Expose to Vite's env substitution system (VITE_ prefix)
ENV VITE_SOCKET_PATH=${VITE_SOCKET_PATH}

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --ignore-scripts; \
    else \
      npm install --ignore-scripts; \
    fi

COPY . .

# --base sets the public base URL for all static asset references in index.html
# and all JS/CSS imports. React Router reads import.meta.env.BASE_URL (which
# Vite sets from --base) via the basename={import.meta.env.BASE_URL} prop.
RUN npm run build -- --base ${VITE_BASE_PATH}

# ── Stage 2: static file server ───────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve

# Remove the default nginx config — the production config is mounted / copied
COPY nginx.prod.conf /etc/nginx/conf.d/default.conf

# Static bundle from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
