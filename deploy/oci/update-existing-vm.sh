#!/usr/bin/env bash

set -euo pipefail

NEW_IMAGE="${1:?imagem nova nao informada}"
APP_CONTAINER="${2:?container nao informado}"
DOCKER_NETWORK="${3:?rede nao informada}"
APP_ENV_FILE="${4:?arquivo de ambiente nao informado}"
APP_DATA_DIR="${5:?diretorio de dados nao informado}"
CADDY_CONTAINER="${6:?container Caddy nao informado}"
DOMAIN="${7:?dominio nao informado}"
ARCHIVE=/tmp/divisao-update.zip
REMOTE_SCRIPT=/tmp/update-divisao-existing-vm.sh
RELEASE_DIR="/opt/divisao/releases/${NEW_IMAGE##*:}"
OLD_IMAGE=""

cleanup() {
  rm -f "$ARCHIVE" "$REMOTE_SCRIPT"
}
trap cleanup EXIT

if [[ ! -f "$ARCHIVE" || ! -f "$APP_ENV_FILE" ]]; then
  echo 'ERRO: pacote ou ambiente da aplicacao nao encontrado.' >&2
  exit 2
fi
if ! docker container inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  echo 'ERRO: container atual nao encontrado; atualizacao cancelada.' >&2
  exit 2
fi
if ! docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1; then
  echo 'ERRO: rede Docker nao encontrada; atualizacao cancelada.' >&2
  exit 2
fi

OLD_IMAGE="$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER")"
install -d -m 0750 -o 1000 -g 1000 "$APP_DATA_DIR"
if [[ ! "$RELEASE_DIR" =~ ^/opt/divisao/releases/[0-9a-f]{12}$ ]]; then
  echo 'ERRO: diretorio de release recusado por seguranca.' >&2
  exit 2
fi
rm -rf "$RELEASE_DIR"
install -d -m 0755 "$RELEASE_DIR"
unzip -q "$ARCHIVE" -d "$RELEASE_DIR"
docker build --pull=false -t "$NEW_IMAGE" -f "$RELEASE_DIR/Dockerfile" "$RELEASE_DIR"

start_app() {
  local image="$1"
  docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$APP_CONTAINER" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    --env-file "$APP_ENV_FILE" \
    -v "$APP_DATA_DIR:/app/backend/data" \
    "$image" >/dev/null

  local state=''
  for _ in $(seq 1 24); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
    [[ "$state" == 'healthy' ]] && return 0
    [[ "$state" == 'unhealthy' || "$state" == 'exited' || "$state" == 'dead' ]] && break
    sleep 5
  done
  return 1
}

rollback() {
  echo "ERRO: validacao falhou; restaurando $OLD_IMAGE." >&2
  start_app "$OLD_IMAGE" || true
}

if ! start_app "$NEW_IMAGE"; then
  rollback
  exit 3
fi

if ! docker exec "$CADDY_CONTAINER" wget -qO- "http://${APP_CONTAINER}:3001/health" >/dev/null; then
  rollback
  exit 4
fi
if ! curl -fsS --retry 5 --retry-delay 2 "https://${DOMAIN}/health" >/dev/null; then
  rollback
  exit 4
fi
if [[ "$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/")" != '200' ]]; then
  rollback
  exit 4
fi
if [[ "$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/escala")" != '200' ]]; then
  rollback
  exit 4
fi
if [[ "$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/gerencia/estado")" != '401' ]]; then
  rollback
  exit 4
fi

ln -sfn "$RELEASE_DIR" /opt/divisao/current
echo "UPDATE_OK image=$NEW_IMAGE previous=$OLD_IMAGE"

