# =============================================================================
# fs-cc Agent Desktop — Production Dockerfile
# =============================================================================
# Agent Desktop is a separate React app that connects to the same CC backend
# as the main CC frontend. It is served at /agent/ and uses the CC backend's
# Socket.IO path (/cc/socket.io).
# =============================================================================

# ── Stage 1: Vite build ────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

# VITE_BASE_PATH   — Vite --base; sets import.meta.env.BASE_URL for asset URLs.
# VITE_API_URL     — API base the browser sends requests to.
#                    Agent Desktop uses the CC backend (same as cc-frontend):
#                      Dev:  /api      — Vite proxy forwards to cc-backend
#                      Prod: /cc/api   — nginx routes /cc/api/* → cc-backend/api/*
# VITE_SOCKET_PATH — Agent Desktop shares the CC backend socket path (/cc/socket.io),
#                    NOT /agent/socket.io — nginx routes /cc/socket.io → cc-backend.
ARG VITE_BASE_PATH=/agent/
ARG VITE_API_URL=/cc/api
ARG VITE_SOCKET_PATH=/cc/socket.io

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_SOCKET_PATH=${VITE_SOCKET_PATH}

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then \
      npm ci --ignore-scripts; \
    else \
      npm install --ignore-scripts; \
    fi

COPY . .

RUN npm run build -- --base ${VITE_BASE_PATH}

# ── Stage 2: static file server ───────────────────────────────────────────────
FROM nginx:1.27-alpine AS serve

COPY nginx.prod.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
