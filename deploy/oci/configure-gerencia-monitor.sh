#!/usr/bin/env bash

set -euo pipefail

APP_CONTAINER="${1:?container nao informado}"
DOCKER_NETWORK="${2:?rede nao informada}"
APP_ENV_FILE="${3:?arquivo de ambiente nao informado}"
APP_DATA_DIR="${4:?diretorio de dados nao informado}"
DOMAIN="${5:?dominio nao informado}"
GROUP_ID="${6:?grupo nao informado}"
ENV_BACKUP="$(mktemp)"
ENV_TEMP="$(mktemp)"
WEBHOOK_BACKUP="$(mktemp)"
IMAGE_TAG=""
WEBHOOK_CHANGED=false

cleanup() {
  rm -f "$ENV_BACKUP" "$ENV_TEMP" "$WEBHOOK_BACKUP" /tmp/configure-gerencia-monitor.sh
  unset PASSWORD PASSWORD_HASH WEBHOOK_TOKEN
}
trap cleanup EXIT

IFS= read -r PASSWORD
if (( ${#PASSWORD} < 12 )); then
  echo 'ERRO: a senha exclusiva precisa ter pelo menos 12 caracteres.' >&2
  exit 2
fi
if [[ "$GROUP_ID" != *@g.us ]]; then
  echo 'ERRO: identificador do grupo invalido.' >&2
  exit 2
fi
if [[ ! -f "$APP_ENV_FILE" ]] || ! docker container inspect "$APP_CONTAINER" >/dev/null 2>&1; then
  echo 'ERRO: aplicacao instalada nao encontrada.' >&2
  exit 3
fi

IMAGE_TAG="$(docker inspect --format '{{.Config.Image}}' "$APP_CONTAINER")"
PASSWORD_HASH="$(printf '%s' "$PASSWORD" | docker exec -i "$APP_CONTAINER" node -e '
  const bcrypt = require("bcryptjs");
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { value += chunk; });
  process.stdin.on("end", () => process.stdout.write(bcrypt.hashSync(value, 12)));
')"
WEBHOOK_TOKEN="$(openssl rand -hex 32)"
if [[ ${#PASSWORD_HASH} -ne 60 || ${#WEBHOOK_TOKEN} -lt 32 ]]; then
  echo 'ERRO: nao foi possivel gerar as credenciais.' >&2
  exit 4
fi

umask 077
cp -a "$APP_ENV_FILE" "$ENV_BACKUP"
docker exec "$APP_CONTAINER" node -e '
  const fetch = require("node-fetch");
  (async () => {
    const base = String(process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
    const instance = process.env.EVOLUTION_INSTANCE_NAME || "";
    const response = await fetch(base + "/webhook/find/" + encodeURIComponent(instance), {
      headers: { apikey: process.env.EVOLUTION_API_KEY || "" }
    });
    if (!response.ok) process.exit(2);
    process.stdout.write(JSON.stringify(await response.json()));
  })().catch(() => process.exit(2));
' > "$WEBHOOK_BACKUP"
if [[ ! -s "$WEBHOOK_BACKUP" ]]; then
  echo 'ERRO: nao foi possivel preservar a configuracao atual do webhook.' >&2
  exit 4
fi

(grep -v -E '^GERENCIA_(GROUP_CHAT_ID|CONTROL_PASSWORD_HASH|WEBHOOK_TOKEN)=' "$APP_ENV_FILE" || true) > "$ENV_TEMP"
{
  printf 'GERENCIA_GROUP_CHAT_ID=%s\n' "$GROUP_ID"
  printf 'GERENCIA_CONTROL_PASSWORD_HASH=%s\n' "$PASSWORD_HASH"
  printf 'GERENCIA_WEBHOOK_TOKEN=%s\n' "$WEBHOOK_TOKEN"
} >> "$ENV_TEMP"
install -m 0600 "$ENV_TEMP" "$APP_ENV_FILE"

start_app() {
  docker rm -f "$APP_CONTAINER" >/dev/null 2>&1 || true
  docker run -d \
    --name "$APP_CONTAINER" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    --env-file "$APP_ENV_FILE" \
    -v "$APP_DATA_DIR:/app/backend/data" \
    "$IMAGE_TAG" >/dev/null

  local state=''
  for _ in $(seq 1 24); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || true)"
    [[ "$state" == 'healthy' ]] && return 0
    [[ "$state" == 'unhealthy' || "$state" == 'exited' || "$state" == 'dead' ]] && break
    sleep 5
  done
  return 1
}

restore_webhook() {
  [[ "$WEBHOOK_CHANGED" != true ]] && return 0
  docker exec -i "$APP_CONTAINER" node -e '
    const fetch = require("node-fetch");
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; });
    process.stdin.on("end", async () => {
      try {
        const original = JSON.parse(input);
        const source = original.webhook || original;
        const payload = { webhook: {
          enabled: source.enabled !== false,
          url: source.url,
          headers: source.headers || {},
          byEvents: Boolean(source.webhookByEvents ?? source.byEvents),
          base64: Boolean(source.webhookBase64 ?? source.base64),
          events: Array.isArray(source.events) ? source.events : []
        }};
        const base = String(process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
        const response = await fetch(base + "/webhook/set/" + encodeURIComponent(process.env.EVOLUTION_INSTANCE_NAME || ""), {
          method: "POST", headers: { apikey: process.env.EVOLUTION_API_KEY || "", "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        process.exit(response.ok ? 0 : 1);
      } catch { process.exit(1); }
    });
  ' < "$WEBHOOK_BACKUP" || true
}

rollback() {
  restore_webhook
  cp "$ENV_BACKUP" "$APP_ENV_FILE"
  chmod 0600 "$APP_ENV_FILE"
  start_app || true
}

if ! start_app; then
  rollback
  echo 'ERRO: aplicacao nao ficou saudavel; configuracao anterior restaurada.' >&2
  exit 5
fi

if ! docker exec "$APP_CONTAINER" node -e '
  const state = require("./gerencia-monitor").state();
  process.exit(state.groupConfigured && state.passwordConfigured && state.webhookAuthConfigured && !state.active ? 0 : 1);
'; then
  rollback
  echo 'ERRO: backend recusou as credenciais; configuracao anterior restaurada.' >&2
  exit 6
fi

if ! printf '%s' "$PASSWORD" | docker exec -i "$APP_CONTAINER" node -e '
  const bcrypt = require("bcryptjs");
  let value = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { value += chunk; });
  process.stdin.on("end", async () => process.exit(await bcrypt.compare(value, process.env.GERENCIA_CONTROL_PASSWORD_HASH || "") ? 0 : 1));
'; then
  rollback
  echo 'ERRO: a senha nao corresponde ao hash apos o reinicio; configuracao anterior restaurada.' >&2
  exit 6
fi
unset PASSWORD

WEBHOOK_CHANGED=true
if ! docker exec -i "$APP_CONTAINER" node -e '
  const fetch = require("node-fetch");
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { input += chunk; });
  process.stdin.on("end", async () => {
    try {
      const original = JSON.parse(input);
      const source = original.webhook || original;
      const expectedUrl = "https://" + process.argv[1] + "/api/whatsapp/webhook";
      if (source.url !== expectedUrl || !Array.isArray(source.events) || !source.events.includes("MESSAGES_UPSERT")) process.exit(2);
      const payload = { webhook: {
        enabled: source.enabled !== false,
        url: source.url,
        headers: { ...(source.headers || {}), "X-Gerencia-Webhook-Token": process.env.GERENCIA_WEBHOOK_TOKEN },
        byEvents: Boolean(source.webhookByEvents ?? source.byEvents),
        base64: Boolean(source.webhookBase64 ?? source.base64),
        events: source.events
      }};
      const base = String(process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
      const instance = process.env.EVOLUTION_INSTANCE_NAME || "";
      const response = await fetch(base + "/webhook/set/" + encodeURIComponent(instance), {
        method: "POST", headers: { apikey: process.env.EVOLUTION_API_KEY || "", "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) process.exit(3);
      const verifyResponse = await fetch(base + "/webhook/find/" + encodeURIComponent(instance), {
        headers: { apikey: process.env.EVOLUTION_API_KEY || "" }
      });
      if (!verifyResponse.ok) process.exit(3);
      const verifiedBody = await verifyResponse.json();
      const verified = verifiedBody.webhook || verifiedBody;
      const sameEvents = JSON.stringify([...(verified.events || [])].sort()) === JSON.stringify([...source.events].sort());
      const valid = verified.url === source.url && sameEvents &&
        Boolean(verified.webhookByEvents ?? verified.byEvents) === payload.webhook.byEvents &&
        Boolean(verified.webhookBase64 ?? verified.base64) === payload.webhook.base64 &&
        verified.headers?.["X-Gerencia-Webhook-Token"] === process.env.GERENCIA_WEBHOOK_TOKEN;
      process.exit(valid ? 0 : 4);
    } catch { process.exit(4); }
  });
' "$DOMAIN" < "$WEBHOOK_BACKUP"; then
  rollback
  echo 'ERRO: webhook nao foi preservado/validado; configuracao anterior restaurada.' >&2
  exit 7
fi

if ! curl -fsS "https://${DOMAIN}/health" >/dev/null ||
   [[ "$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/gerencia/estado")" != '401' ]]; then
  rollback
  echo 'ERRO: smoke test final falhou; configuracao anterior restaurada.' >&2
  exit 8
fi

unset PASSWORD_HASH WEBHOOK_TOKEN
echo 'GERENCIA_CONFIG_OK active=false webhook_preserved=true'

