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

# VITE_BASE_PATH   — Vite --base: sets import.meta.env.BASE_URL; used by BrowserRouter basename
#                    and for static asset URL generation (JS/CSS hrefs in index.html).
# VITE_API_URL     — API base the browser sends requests to. In prod this must include the
#                    sub-path prefix so nginx can route it:
#                      Dev  (npm run dev):  /api           — Vite proxy forwards to cc-backend
#                      Prod (Docker/nginx): /cc/api        — nginx routes /cc/api/* → cc-backend/api/*
# VITE_SOCKET_PATH — Socket.IO handshake path. Must match the nginx location block and
#                    the SOCKET_PATH env on cc-backend:
#                      Dev:  /socket.io       — Vite proxy forwards to cc-backend
#                      Prod: /cc/socket.io    — nginx routes /cc/socket.io → cc-backend
ARG VITE_BASE_PATH=/cc/
ARG VITE_API_URL=/cc/api
ARG VITE_SOCKET_PATH=/cc/socket.io

# System env vars set here take precedence over values in the copied .env file
# (Vite resolves VITE_* system env vars before .env files).
ENV VITE_API_URL=${VITE_API_URL}
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

COPY nginx.prod.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
