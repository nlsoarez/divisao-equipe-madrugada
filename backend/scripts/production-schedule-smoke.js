const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { client: supabase } = require('../supabase');

const API_BASE_URL = process.env.SMOKE_API_BASE_URL || 'http://127.0.0.1:3001';
const SCALE_CACHE_PATH = path.join(__dirname, '..', 'data', 'escala-cache.json');
let currentStage = 'startup';

async function requestScale(method = 'GET', dados) {
  const response = await fetch(`${API_BASE_URL}/api/escala`, {
    method,
    headers: dados === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: dados === undefined ? undefined : JSON.stringify({ dados })
  });
  const body = await response.json();

  if (!response.ok || !body.sucesso) {
    throw new Error(`API escala falhou com HTTP ${response.status}: ${body.erro || 'resposta invalida'}`);
  }

  return Object.prototype.hasOwnProperty.call(body, 'dados') ? body.dados : body;
}

async function clearSchedule() {
  await supabase.rpc('clear_schedule_document');
  fs.rmSync(SCALE_CACHE_PATH, { force: true });
}

async function restoreSchedule(original) {
  if (original && typeof original === 'object' && !Array.isArray(original)) {
    await requestScale('PUT', original);
    return;
  }

  await clearSchedule();
}

async function main() {
  if (process.env.SMOKE_CLEAR_ONLY === 'true') {
    currentStage = 'clear-only';
    await clearSchedule();
    console.log('PRODUCTION_SCHEDULE_CLEAR_RPC_OK');
    return;
  }

  currentStage = 'load-original';
  const loadedDocument = await requestScale();
  const staleSmokeMarker = loadedDocument?.__persistenceSmoke;
  if (process.env.SMOKE_INSPECT_ONLY === 'true') {
    console.log(JSON.stringify({
      type: loadedDocument === null ? 'null' : typeof loadedDocument,
      keys: loadedDocument && typeof loadedDocument === 'object' ? Object.keys(loadedDocument).sort() : [],
      staleSmokeMarker: typeof staleSmokeMarker === 'string' && staleSmokeMarker.startsWith('oci-persistence-smoke-')
    }));
    return;
  }
  const original = typeof staleSmokeMarker === 'string' && staleSmokeMarker.startsWith('oci-persistence-smoke-')
    ? null
    : loadedDocument;
  const marker = `oci-persistence-smoke-${Date.now()}`;
  const probe = {
    __persistenceSmoke: marker,
    calendario1: null,
    calendario2: null
  };
  let restoreRequired = false;

  try {
    restoreRequired = true;
    currentStage = 'write-probe';
    await requestScale('PUT', probe);
    currentStage = 'read-probe';
    const persistedProbe = await requestScale();
    assert.equal(persistedProbe.__persistenceSmoke, marker, 'marcador nao foi persistido pelo Supabase');
  } finally {
    if (restoreRequired) {
      const stageBeforeRestore = currentStage;
      currentStage = 'restore-original';
      await restoreSchedule(original);
      currentStage = stageBeforeRestore;
    }
  }

  currentStage = 'verify-restore';
  const restored = await requestScale();
  assert.deepStrictEqual(restored, original, 'documento anterior nao foi restaurado integralmente');
  console.log(`PRODUCTION_SCHEDULE_WRITE_READ_RESTORE_OK previous=${original ? 'present' : 'empty'}`);
}

main().catch((error) => {
  console.error(`PRODUCTION_SCHEDULE_SMOKE_FAILED stage=${currentStage}: ${error.message}`);
  process.exitCode = 1;
});
