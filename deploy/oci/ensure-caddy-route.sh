#!/bin/sh

set -eu

CADDY_CONTAINER="${CADDY_CONTAINER:-dashboard-indicadores-cop-caddy-1}"
APP_CONTAINER="${APP_CONTAINER:-divisao-equipe-madrugada}"
DOMAIN="${DIVISAO_DOMAIN:-divisao.163-176-155-119.sslip.io}"
BEGIN_MARKER="# BEGIN divisao-equipe-madrugada"
END_MARKER="# END divisao-equipe-madrugada"

# O dashboard recria o Caddy a partir de um diretório de release diferente a
# cada deploy. Descobrir o bind mount ativo evita depender de um release fixo.
if ! docker inspect "$CADDY_CONTAINER" >/dev/null 2>&1; then
  exit 0
fi

CADDYFILE_PATH="$(docker inspect "$CADDY_CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')"

if [ -z "$CADDYFILE_PATH" ] || [ ! -f "$CADDYFILE_PATH" ]; then
  echo "Caddyfile ativo não encontrado para $CADDY_CONTAINER." >&2
  exit 1
fi

if grep -Fq "$BEGIN_MARKER" "$CADDYFILE_PATH"; then
  exit 0
fi

BACKUP_PATH="${CADDYFILE_PATH}.before-divisao-$(date +%Y%m%d%H%M%S)"
cp "$CADDYFILE_PATH" "$BACKUP_PATH"

cat >>"$CADDYFILE_PATH" <<EOF

$BEGIN_MARKER
https://$DOMAIN {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "SAMEORIGIN"
    Referrer-Policy "strict-origin-when-cross-origin"
  }
  reverse_proxy $APP_CONTAINER:3001
}
$END_MARKER
EOF

if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile >/dev/null; then
  cp "$BACKUP_PATH" "$CADDYFILE_PATH"
  echo "Rota não aplicada: o Caddy rejeitou a configuração; backup restaurado." >&2
  exit 1
fi

docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile >/dev/null
echo "Rota HTTPS de $DOMAIN restaurada em $CADDYFILE_PATH."

