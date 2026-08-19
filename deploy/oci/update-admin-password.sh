#!/usr/bin/env bash

set -euo pipefail

APP_CONTAINER="${1:-divisao-equipe-madrugada}"
CADDY_CONTAINER="${2:-dashboard-indicadores-cop-caddy-1}"
APP_ENV_FILE="${3:-/opt/divisao/.env}"
DOCKER_NETWORK="${4:-dashboard-indicadores-cop_default}"
APP_DATA_DIR="${5:-/opt/divisao/data}"
ENV_BACKUP="$(mktemp)"
ENV_TEMP="$(mktemp)"

cleanup() {
  rm -f "$ENV_BACKUP" "$ENV_TEMP" /tmp/update-divisao-admin-password.sh
  unset NEW_PASSWORD ADMIN_PASSWORD_HASH ADMIN_SESSION_SECRET
}
trap cleanup EXIT

IFS= read -r NEW_PASSWORD
if (( ${#NEW_PASSWORD} < 12 )); then
  echo "ERRO: a nova senha precisa ter pelo menos 12 caracteres." >&2
  exit 2
fi

if [[ ! -f "$APP_ENV_FILE" ]]; then
  echo "ERRO: ambiente da aplicacao nao encontrado." >&2
  exit 3
fi

if ! docker container inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  echo "ERRO: container da aplicacao nao encontrado." >&2
  exit 3
fi

IMAGE_TAG="$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER")"
ADMIN_PASSWORD_HASH="$(printf '%s\n' "$NEW_PASSWORD" | docker exec -i "$CADDY_CONTAINER" caddy hash-password)"
ADMIN_SESSION_SECRET="$(openssl rand -hex 32)"
if [[ -z "$ADMIN_PASSWORD_HASH" || -z "$ADMIN_SESSION_SECRET" ]]; then
  echo "ERRO: nao foi possivel gerar as credenciais administrativas." >&2
  exit 4
fi

cp -a "$APP_ENV_FILE" "$ENV_BACKUP"
(grep -v -E '^ADMIN_(PASSWORD_HASH|SESSION_SECRET)=' "$APP_ENV_FILE" || true) > "$ENV_TEMP"
{
  printf 'ADMIN_PASSWORD_HASH=%s\n' "$ADMIN_PASSWORD_HASH"
  printf 'ADMIN_SESSION_SECRET=%s\n' "$ADMIN_SESSION_SECRET"
} >> "$ENV_TEMP"
install -m 0600 "$ENV_TEMP" "$APP_ENV_FILE"

start_app() {
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

  local state=""
  for _ in $(seq 1 24); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
    if [[ "$state" == "healthy" ]]; then
      return 0
    fi
    if [[ "$state" == "unhealthy" || "$state" == "exited" || "$state" == "dead" ]]; then
      break
    fi
    sleep 5
  done
  return 1
}

rollback() {
  cp "$ENV_BACKUP" "$APP_ENV_FILE"
  chmod 0600 "$APP_ENV_FILE"
  start_app || true
}

if ! start_app; then
  echo "ERRO: aplicacao nao ficou saudavel; restaurando a senha anterior." >&2
  rollback
  exit 5
fi

if ! printf '%s' "$NEW_PASSWORD" | docker exec -i "$APP_CONTAINER" node -e '
  const bcrypt = require("bcryptjs");
  let password = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { password += chunk; });
  process.stdin.on("end", async () => {
    const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH || "");
    process.exit(valid ? 0 : 1);
  });
'; then
  echo "ERRO: a nova senha nao foi validada; restaurando a senha anterior." >&2
  rollback
  exit 6
fi

unset NEW_PASSWORD ADMIN_PASSWORD_HASH ADMIN_SESSION_SECRET
echo "ADMIN_PASSWORD_UPDATE_OK"
