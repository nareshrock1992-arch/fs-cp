# =============================================================================
# Common Nginx — Production Dockerfile
# =============================================================================
# Single nginx container that:
#   - Serves the Omni Dashboard (static HTML) at /
#   - Routes /cc/, /agent/, /enrs/ to the respective frontend containers
#   - Proxies /cc/api/, /enrs/api/ to the backend containers
#   - Handles WebSocket upgrades for /cc/socket.io and /enrs/socket.io
#   - Terminates TLS (self-signed cert initially; swap for Let's Encrypt later)
#
# The main server config is templated (conf.d/omni.conf.template) so that
# SERVER_NAME can be switched from an IP to a domain by changing one .env var.
# envsubst is provided by the nginx:alpine base image at
# /docker-entrypoint.d/20-envsubst-on-templates.sh which processes every file
# in /etc/nginx/templates/*.template → /etc/nginx/conf.d/<name>.
# =============================================================================

FROM nginx:1.27-alpine

# ── Static assets ─────────────────────────────────────────────────────────────
# Dashboard is the root "/" page — a pure HTML tile with links to each app.
RUN mkdir -p /usr/share/nginx/html/error_pages
COPY dashboard/index.html /usr/share/nginx/html/index.html
COPY error_pages/          /usr/share/nginx/html/error_pages/

# ── nginx configuration ───────────────────────────────────────────────────────
# Main nginx.conf (workers, gzip, logging, map for WebSocket upgrade header)
COPY nginx.conf /etc/nginx/nginx.conf

# Snippets (included from the server block template)
COPY snippets/ /etc/nginx/snippets/

# Template — envsubst replaces ${SERVER_NAME} at container start
COPY conf.d/omni.conf.template /etc/nginx/templates/omni.conf.template

# Remove the default stub config so it does not conflict
RUN rm -f /etc/nginx/conf.d/default.conf

EXPOSE 80 443
