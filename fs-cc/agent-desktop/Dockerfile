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

# VITE_BASE_PATH  — serves at /agent/ sub-path
# VITE_SOCKET_PATH — connects to cc-backend which owns /cc/socket.io.
#                    The agent desktop shares the CC backend, so the socket
#                    path is /cc/socket.io, not /agent/socket.io.
ARG VITE_BASE_PATH=/agent/
ARG VITE_SOCKET_PATH=/cc/socket.io

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
