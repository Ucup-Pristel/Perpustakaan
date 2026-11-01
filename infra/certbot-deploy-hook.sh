#!/bin/sh
# certbot --deploy-hook: copy the renewed cert into TLS_DIR as real files (the
# nginx container cannot follow /etc/letsencrypt/live symlinks), then reload nginx.
#   sudo certbot certonly --webroot -w /opt/edulib/acme -d api.edulib.id \
#     --deploy-hook /opt/edulib/source/infra/certbot-deploy-hook.sh
# certbot stores the hook; `certbot renew` (systemd timer) re-runs it on renewal.
set -eu
ENV_FILE="${EDULIB_ENV_FILE:-/opt/edulib/prod.env}"
SOURCE="${EDULIB_SOURCE:-/opt/edulib/source}"
: "${RENEWED_LINEAGE:?must be run by certbot --deploy-hook}"
TLS_DIR="$(sed -n 's/^TLS_DIR=//p' "$ENV_FILE")"
[ -d "$TLS_DIR" ] || { echo "certbot-deploy-hook: TLS_DIR missing: $TLS_DIR" >&2; exit 1; }

install -m 0644 "$RENEWED_LINEAGE/fullchain.pem" "$TLS_DIR/fullchain.pem.new"
install -m 0600 "$RENEWED_LINEAGE/privkey.pem" "$TLS_DIR/privkey.pem.new"
mv -f "$TLS_DIR/fullchain.pem.new" "$TLS_DIR/fullchain.pem"
mv -f "$TLS_DIR/privkey.pem.new" "$TLS_DIR/privkey.pem"
# nginx -s reload keeps the old cert if the new config/cert fails to load.
docker compose --env-file "$ENV_FILE" -p "${COMPOSE_PROJECT_NAME:-edulib-prod}" \
  -f "$SOURCE/infra/compose.prod.yaml" exec -T nginx nginx -s reload
