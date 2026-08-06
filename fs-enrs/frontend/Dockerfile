# =============================================================================
# fs-enrs Frontend — Production Dockerfile
# =============================================================================

# ── Stage 1: Vite build ────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_BASE_PATH=/enrs/
ARG VITE_SOCKET_PATH=/enrs/socket.io

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

# Write the nginx config inline so the image builds even when nginx.prod.conf
# is absent from the build context (e.g. on a fresh git clone where fs-enrs
# is tracked as a gitlink and the directory is empty).
RUN printf '%s\n' \
    'server {' \
    '    listen 80;' \
    '    server_name _;' \
    '    root /usr/share/nginx/html;' \
    '    index index.html;' \
    '' \
    '    location / {' \
    '        try_files $uri $uri/ /index.html;' \
    '    }' \
    '' \
    '    location ~* \.(js|css|woff2?|png|jpg|jpeg|gif|svg|ico|webp)$ {' \
    '        expires 1y;' \
    '        add_header Cache-Control "public, immutable";' \
    '        access_log off;' \
    '    }' \
    '' \
    '    location = /nginx-health {' \
    '        access_log off;' \
    '        return 200 "ok";' \
    '        add_header Content-Type text/plain;' \
    '    }' \
    '}' \
    > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
