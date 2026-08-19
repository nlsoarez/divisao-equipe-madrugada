#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${1:?dominio nao informado}"
IMAGE_TAG="${2:?imagem nao informada}"
DOCKER_NETWORK="${3:?rede Docker nao informada}"
CADDY_CONTAINER="${4:?container Caddy nao informado}"
CADDYFILE_PATH="${5:?Caddyfile nao informado}"
SUPABASE_URL="${6:?URL do Supabase nao informada}"
REUSE_EXISTING_SUPABASE_CONFIG="${7:-false}"
REUSE_EXISTING_ADMIN_PASSWORD="${8:-false}"

APP_CONTAINER="divisao-equipe-madrugada"
APP_DATA_DIR="/opt/divisao/data"
APP_ENV_FILE="/opt/divisao/.env"
CADDY_BEGIN="# BEGIN divisao-equipe-madrugada"
CADDY_END="# END divisao-equipe-madrugada"
CADDY_TEMP="$(mktemp)"
APP_ENV_TEMP="$(mktemp)"
CADDY_BACKUP="${CADDYFILE_PATH}.bak-$(date -u +%Y%m%dT%H%M%SZ)"

cleanup() {
  rm -f "$CADDY_TEMP" "$APP_ENV_TEMP" /tmp/configure-divisao.sh
  unset SUPABASE_SECRET_KEY SITE_PASSWORD ADMIN_PASSWORD_HASH ADMIN_SESSION_SECRET
}
trap cleanup EXIT

if [[ "$REUSE_EXISTING_SUPABASE_CONFIG" == "true" ]]; then
  if [[ ! -f "$APP_ENV_FILE" ]] || ! grep -q '^SUPABASE_SECRET_KEY=sb_secret_' "$APP_ENV_FILE"; then
    echo "ERRO: configuracao Supabase anterior nao encontrada na VM." >&2
    exit 2
  fi
else
  IFS= read -r SUPABASE_SECRET_KEY
  SUPABASE_SECRET_KEY="$(printf '%s' "$SUPABASE_SECRET_KEY" | tr -d '[:space:]')"

  if [[ "$SUPABASE_SECRET_KEY" != sb_secret_* ]]; then
    echo "ERRO: a chave precisa ser uma Supabase Secret key (sb_secret_...)." >&2
    exit 2
  fi
fi

if [[ "$REUSE_EXISTING_ADMIN_PASSWORD" != "true" ]]; then
  IFS= read -r SITE_PASSWORD
  if (( ${#SITE_PASSWORD} < 12 )); then
    echo "ERRO: a senha administrativa precisa ter pelo menos 12 caracteres." >&2
    exit 2
  fi
fi

if [[ ! -f "$CADDYFILE_PATH" ]]; then
  echo "ERRO: Caddyfile nao encontrado em $CADDYFILE_PATH." >&2
  exit 3
fi

if ! docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  echo "ERRO: rede Docker $DOCKER_NETWORK nao encontrada." >&2
  exit 3
fi

if ! docker image inspect "$IMAGE_TAG" >/dev/null 2>&1; then
  echo "ERRO: imagem Docker $IMAGE_TAG nao encontrada." >&2
  exit 3
fi

install -d -m 0750 -o 1000 -g 1000 "$APP_DATA_DIR"
if [[ "$REUSE_EXISTING_SUPABASE_CONFIG" != "true" ]]; then
  umask 077
  {
    printf 'NODE_ENV=production\n'
    printf 'PORT=3001\n'
    printf 'PUBLIC_DIR=/app/public\n'
    printf 'TZ=America/Sao_Paulo\n'
    printf 'CORS_ORIGIN=https://%s\n' "$DOMAIN"
    printf 'SUPABASE_URL=%s\n' "$SUPABASE_URL"
    printf 'SUPABASE_SECRET_KEY=%s\n' "$SUPABASE_SECRET_KEY"
    printf 'SUPABASE_SCHEMA=public\n'
    printf 'ALOCACAO_HUB_CHAT_ID=120363420668199320@g.us\n'
    printf 'COP_REDE_EMPRESARIAL_CHAT_ID=120363423786613991@g.us\n'
    printf 'EVOLUTION_ENABLED=false\n'
    printf 'EVOLUTION_API_URL=\n'
    printf 'EVOLUTION_API_KEY=\n'
    printf 'EVOLUTION_INSTANCE_NAME=\n'
    printf 'EVOLUTION_SOURCE_CHAT_ID=\n'
    printf 'WHATSAPP_POLLING_DISABLED=true\n'
    printf 'WHATSAPP_POLLING_INTERVAL=30000\n'
    printf 'VISIUM_BASE_URL=http://201.55.234.76/Consultas_/ConsultaInterfaceNode\n'
    printf 'VISIUM_TIMEOUT_MS=25000\n'
  } > "$APP_ENV_FILE"
  chmod 0600 "$APP_ENV_FILE"
  unset SUPABASE_SECRET_KEY
fi

if [[ "$REUSE_EXISTING_ADMIN_PASSWORD" == "true" ]]; then
  ADMIN_PASSWORD_HASH="$(sed -n 's/^ADMIN_PASSWORD_HASH=//p' "$APP_ENV_FILE" | tail -n 1)"
  if [[ -z "$ADMIN_PASSWORD_HASH" ]]; then
    ADMIN_PASSWORD_HASH="$(awk -v begin="$CADDY_BEGIN" -v end="$CADDY_END" '
      $0 == begin { managed = 1; next }
      $0 == end { managed = 0; next }
      managed && $1 == "operacao" { print $2; exit }
    ' "$CADDYFILE_PATH")"
  fi
else
  ADMIN_PASSWORD_HASH="$(printf '%s\n' "$SITE_PASSWORD" | docker exec -i "$CADDY_CONTAINER" caddy hash-password)"
fi
if [[ -z "$ADMIN_PASSWORD_HASH" ]]; then
  echo "ERRO: nao foi possivel obter o hash da senha administrativa." >&2
  exit 4
fi

ADMIN_SESSION_SECRET="$(sed -n 's/^ADMIN_SESSION_SECRET=//p' "$APP_ENV_FILE" | tail -n 1)"
if (( ${#ADMIN_SESSION_SECRET} < 32 )); then
  ADMIN_SESSION_SECRET="$(openssl rand -hex 32)"
fi

grep -v -E '^ADMIN_(PASSWORD_HASH|SESSION_SECRET)=' "$APP_ENV_FILE" > "$APP_ENV_TEMP"
{
  printf 'ADMIN_PASSWORD_HASH=%s\n' "$ADMIN_PASSWORD_HASH"
  printf 'ADMIN_SESSION_SECRET=%s\n' "$ADMIN_SESSION_SECRET"
} >> "$APP_ENV_TEMP"
install -m 0600 "$APP_ENV_TEMP" "$APP_ENV_FILE"

awk -v begin="$CADDY_BEGIN" -v end="$CADDY_END" '
  $0 == begin { skipping = 1; next }
  $0 == end { skipping = 0; next }
  !skipping { print }
' "$CADDYFILE_PATH" > "$CADDY_TEMP"

{
  printf '\n%s\n' "$CADDY_BEGIN"
  printf 'https://%s {\n' "$DOMAIN"
  printf '  encode zstd gzip\n'
  printf '  header {\n'
  printf '    Strict-Transport-Security "max-age=31536000; includeSubDomains"\n'
  printf '    X-Content-Type-Options "nosniff"\n'
  printf '    X-Frame-Options "SAMEORIGIN"\n'
  printf '    Referrer-Policy "strict-origin-when-cross-origin"\n'
  printf '  }\n'
  printf '  reverse_proxy %s:3001\n' "$APP_CONTAINER"
  printf '}\n'
  printf '%s\n' "$CADDY_END"
} >> "$CADDY_TEMP"

cp -a "$CADDYFILE_PATH" "$CADDY_BACKUP"
cp "$CADDY_TEMP" "$CADDYFILE_PATH"

if ! docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy/Caddyfile; then
  cp "$CADDY_BACKUP" "$CADDYFILE_PATH"
  echo "ERRO: configuracao Caddy invalida; arquivo anterior restaurado." >&2
  exit 5
fi

if docker container inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  docker rm -f "$APP_CONTAINER" >/dev/null
fi

docker run -d \
  --name "$APP_CONTAINER" \
  --restart unless-stopped \
  --network "$DOCKER_NETWORK" \
  --env-file "$APP_ENV_FILE" \
  -v "$APP_DATA_DIR:/app/backend/data" \
  "$IMAGE_TAG" >/dev/null

APP_HEALTH=""
for _ in $(seq 1 24); do
  APP_HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
  if [[ "$APP_HEALTH" == "healthy" ]]; then
    break
  fi
  if [[ "$APP_HEALTH" == "unhealthy" || "$APP_HEALTH" == "exited" || "$APP_HEALTH" == "dead" ]]; then
    break
  fi
  sleep 5
done

if [[ "$APP_HEALTH" != "healthy" ]]; then
  cp "$CADDY_BACKUP" "$CADDYFILE_PATH"
  echo "ERRO: aplicacao nao ficou saudavel (estado: ${APP_HEALTH:-desconhecido})." >&2
  docker logs --tail 80 "$APP_CONTAINER" >&2 || true
  exit 6
fi

docker exec "$CADDY_CONTAINER" wget -qO- "http://${APP_CONTAINER}:3001/health" >/dev/null
docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy/Caddyfile

PUBLIC_HEALTH="https://${DOMAIN}/health"
curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-all-errors "$PUBLIC_HEALTH" >/dev/null

PUBLIC_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "https://${DOMAIN}/")"
if [[ "$PUBLIC_STATUS" != "200" ]]; then
  echo "ERRO: a consulta publica retornou HTTP $PUBLIC_STATUS; esperado 200." >&2
  exit 7
fi

curl --fail --silent --show-error "https://${DOMAIN}/api/escala" >/dev/null

ADMIN_NO_AUTH_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "https://${DOMAIN}/admin")"
if [[ "$ADMIN_NO_AUTH_STATUS" != "200" ]]; then
  echo "ERRO: a tela de login /admin retornou HTTP $ADMIN_NO_AUTH_STATUS; esperado 200." >&2
  exit 7
fi

SESSION_NO_AUTH_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "https://${DOMAIN}/api/admin/session")"
if [[ "$SESSION_NO_AUTH_STATUS" != "401" ]]; then
  echo "ERRO: a sessao administrativa sem login retornou HTTP $SESSION_NO_AUTH_STATUS; esperado 401." >&2
  exit 7
fi

WRITE_NO_AUTH_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' -X PUT "https://${DOMAIN}/api/escala")"
if [[ "$WRITE_NO_AUTH_STATUS" != "401" ]]; then
  echo "ERRO: PUT /api/escala sem credenciais retornou HTTP $WRITE_NO_AUTH_STATUS; esperado 401." >&2
  exit 7
fi

unset SITE_PASSWORD ADMIN_PASSWORD_HASH ADMIN_SESSION_SECRET

echo "DEPLOY_OK public=https://${DOMAIN}/ admin=https://${DOMAIN}/admin password_only=true"
