#!/usr/bin/env bash

set -euo pipefail

APP_CONTAINER="divisao-equipe-madrugada"
APP_ENV_FILE="/opt/divisao/.env"
APP_DATA_DIR="/opt/divisao/data"
DOCKER_NETWORK="dashboard-indicadores-cop_default"
ENV_TEMP="$(mktemp)"
ENV_BACKUP="$(mktemp)"

cleanup() {
  rm -f "$ENV_TEMP" "$ENV_BACKUP" /tmp/update-divisao-supabase-secret.sh
  unset SUPABASE_SECRET_KEY
}
trap cleanup EXIT

IFS= read -r SUPABASE_SECRET_KEY
SUPABASE_SECRET_KEY="$(printf '%s' "$SUPABASE_SECRET_KEY" | tr -d '[:space:]')"
if [[ "$SUPABASE_SECRET_KEY" != sb_secret_* ]]; then
  echo "ERRO: a chave precisa ser uma Supabase Secret key (sb_secret_...)." >&2
  exit 2
fi

if [[ ! -f "$APP_ENV_FILE" ]]; then
  echo "ERRO: arquivo de ambiente nao encontrado em $APP_ENV_FILE." >&2
  exit 3
fi

IMAGE_TAG="$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER" 2>/dev/null || true)"
if [[ -z "$IMAGE_TAG" ]]; then
  echo "ERRO: container $APP_CONTAINER nao encontrado." >&2
  exit 3
fi

cp -a "$APP_ENV_FILE" "$ENV_BACKUP"
SECRET_REPLACED=false
while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    SUPABASE_SECRET_KEY=*)
      printf 'SUPABASE_SECRET_KEY=%s\n' "$SUPABASE_SECRET_KEY" >> "$ENV_TEMP"
      SECRET_REPLACED=true
      ;;
    *)
      printf '%s\n' "$line" >> "$ENV_TEMP"
      ;;
  esac
done < "$APP_ENV_FILE"

if [[ "$SECRET_REPLACED" != "true" ]]; then
  printf 'SUPABASE_SECRET_KEY=%s\n' "$SUPABASE_SECRET_KEY" >> "$ENV_TEMP"
fi
unset SUPABASE_SECRET_KEY

cp "$ENV_TEMP" "$APP_ENV_FILE"
chmod 0600 "$APP_ENV_FILE"

start_app() {
  docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$APP_CONTAINER" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    --env-file "$APP_ENV_FILE" \
    -v "$APP_DATA_DIR:/app/backend/data" \
    "$IMAGE_TAG" >/dev/null
}

wait_for_health() {
  local state=""
  for _ in $(seq 1 24); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
    if [[ "$state" == "healthy" ]]; then
      return 0
    fi
    if [[ "$state" == "unhealthy" || "$state" == "exited" || "$state" == "dead" ]]; then
      return 1
    fi
    sleep 5
  done
  return 1
}

rollback() {
  cp "$ENV_BACKUP" "$APP_ENV_FILE"
  chmod 0600 "$APP_ENV_FILE"
  start_app
  wait_for_health || true
}

start_app
if ! wait_for_health; then
  echo "ERRO: aplicacao nao ficou saudavel com a nova chave; restaurando configuracao anterior." >&2
  docker logs --tail 60 "$APP_CONTAINER" >&2 || true
  rollback
  exit 4
fi

if ! docker exec "$APP_CONTAINER" wget -qO- http://127.0.0.1:3001/api/escala | grep -q '"sucesso":true'; then
  echo "ERRO: o Supabase rejeitou a chave ou a leitura da escala; restaurando configuracao anterior." >&2
  docker logs --tail 60 "$APP_CONTAINER" >&2 || true
  rollback
  exit 5
fi

echo "SUPABASE_SECRET_OK container=${APP_CONTAINER} api_escala=ok"
