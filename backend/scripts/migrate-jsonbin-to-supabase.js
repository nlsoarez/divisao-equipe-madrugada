/* eslint-disable no-console */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { client: supabase } = require('../supabase');
const storage = require('../storage');
const storageHub = require('../storageHub');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const snapshotOnly = args.has('--snapshot-only');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável obrigatória ausente: ${name}`);
  return value;
}

function sourceHeaders(masterKey, accessKey) {
  return {
    'X-Master-Key': masterKey,
    ...(accessKey ? { 'X-Access-Key': accessKey } : {})
  };
}

async function fetchBin(binId, headers) {
  const response = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
    headers,
    timeout: 30000
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`JSONBin ${response.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text).record;
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function chunk(items, size = 500) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function countScheduleDays(document) {
  const calendars = [
    document?.calendario1,
    document?.calendario2?.rio_es,
    document?.calendario2?.leste,
    document?.calendario2?.dadosOriginais ? document.calendario2 : null
  ].filter(Boolean);
  return calendars.reduce(
    (total, calendar) => total + Object.keys(calendar.dadosOriginais || {}).length,
    0
  );
}

async function upsertBatches(table, rows, onConflict) {
  for (const batch of chunk(rows)) {
    await supabase.upsert(table, batch, onConflict);
  }
}

function assertContains(sourceIds, targetIds, label) {
  const missing = sourceIds.filter(id => !targetIds.has(id));
  if (missing.length) {
    throw new Error(`${label}: ${missing.length} registros não foram encontrados no destino`);
  }
}

function dedupeBy(rows, keyFactory) {
  return [...new Map(rows.map(row => [keyFactory(row), row])).values()];
}

async function main() {
  const jsonBinMasterKey = required('JSONBIN_MASTER_KEY');
  const jsonBinAccessKey = process.env.JSONBIN_ACCESS_KEY || '';
  const commonHeaders = sourceHeaders(jsonBinMasterKey, jsonBinAccessKey);

  const scaleBinId = required('SCALE_BIN_ID');
  const whatsappBinId = required('WHATSAPP_BIN_ID');
  const hubBinId = process.env.ALOCACAO_HUB_BIN_ID || '';

  console.log('[Migração] Lendo JSONBin em modo somente leitura...');
  const [schedule, whatsapp, hub] = await Promise.all([
    fetchBin(scaleBinId, commonHeaders),
    fetchBin(whatsappBinId, commonHeaders),
    hubBinId
      ? fetchBin(
        hubBinId,
        sourceHeaders(
          process.env.ALOCACAO_HUB_MASTER_KEY || jsonBinMasterKey,
          process.env.ALOCACAO_HUB_ACCESS_KEY || jsonBinAccessKey
        )
      )
      : Promise.resolve({ alocacoes: [] })
  ]);

  const snapshot = {
    exportedAt: new Date().toISOString(),
    source: {
      scaleBinId,
      whatsappBinId,
      hubBinId: hubBinId || null
    },
    records: { schedule, whatsapp, hub }
  };
  const snapshotHash = sha256(snapshot.records);
  const snapshotDir = path.join(__dirname, '..', 'data-migration');
  fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshotPath = path.join(snapshotDir, `jsonbin-${snapshot.exportedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new Error('Escala de origem invalida: esperado um objeto JSON');
  }
  if (!whatsapp || typeof whatsapp !== 'object' || Array.isArray(whatsapp)) {
    throw new Error('Storage WhatsApp de origem invalido: esperado um objeto JSON');
  }
  if (!hub || typeof hub !== 'object' || Array.isArray(hub)) {
    throw new Error('Storage HUB de origem invalido: esperado um objeto JSON');
  }

  const copRows = dedupeBy(
    (whatsapp.copRedeInforma || []).map(item =>
      storage._internals.messageToRow(item, 'cop_rede_informa')
    ),
    row => `${row.channel}:${row.message_id}`
  );
  const enterpriseRows = dedupeBy(
    (whatsapp.copRedeEmpresarial || []).map(item =>
      storage._internals.messageToRow(item, 'cop_rede_empresarial')
    ),
    row => `${row.channel}:${row.message_id}`
  );
  const alertRows = dedupeBy(
    (whatsapp.alertas || []).map(storage._internals.alertToRow),
    row => row.alert_id
  );
  const hubRows = dedupeBy(
    (hub.alocacoes || []).map(storageHub._internals.allocationToRow),
    row => row.message_id
  );

  const summary = {
    snapshotPath,
    snapshotSha256: snapshotHash,
    scheduleDays: countScheduleDays(schedule),
    messages: copRows.length + enterpriseRows.length,
    alerts: alertRows.length,
    hubAllocations: hubRows.length
  };
  console.log('[Migração] Snapshot criado:', JSON.stringify(summary));

  if (snapshotOnly || dryRun) {
    console.log(`[Migração] ${snapshotOnly ? 'Snapshot concluído' : 'Dry-run concluído'}; destino não alterado.`);
    return;
  }

  if (!supabase.isConfigured()) {
    throw new Error('Defina SUPABASE_URL e SUPABASE_SECRET_KEY para importar o snapshot.');
  }

  await supabase.rpc('replace_schedule_document', { p_document: schedule });
  await upsertBatches('operational_messages', [...copRows, ...enterpriseRows], 'channel,message_id');
  await upsertBatches('operational_alerts', alertRows, 'alert_id');
  await upsertBatches('hub_allocations', hubRows, 'message_id');

  const [targetSchedule, targetMessages, targetAlerts, targetHub] = await Promise.all([
    supabase.rpc('get_schedule_document'),
    supabase.selectAll('operational_messages', { select: 'channel,message_id' }),
    supabase.selectAll('operational_alerts', { select: 'alert_id' }),
    supabase.selectAll('hub_allocations', { select: 'message_id' })
  ]);

  if (countScheduleDays(targetSchedule) !== summary.scheduleDays) {
    throw new Error('Escala: contagem de dias divergiu após a importação');
  }
  if (JSON.stringify(canonicalize(targetSchedule)) !== JSON.stringify(canonicalize(schedule))) {
    throw new Error('Escala: o documento reconstruido divergiu da origem');
  }
  assertContains(
    [...copRows, ...enterpriseRows].map(row => `${row.channel}:${row.message_id}`),
    new Set(targetMessages.map(row => `${row.channel}:${row.message_id}`)),
    'Mensagens'
  );
  assertContains(
    alertRows.map(row => row.alert_id),
    new Set(targetAlerts.map(row => row.alert_id)),
    'Alertas'
  );
  assertContains(
    hubRows.map(row => row.message_id),
    new Set(targetHub.map(row => row.message_id)),
    'HUB'
  );

  await supabase.upsert('data_migration_runs', [{
    source: 'jsonbin',
    snapshot_sha256: snapshotHash,
    schedule_count: summary.scheduleDays,
    message_count: summary.messages,
    alert_count: summary.alerts,
    hub_allocation_count: summary.hubAllocations,
    details: { snapshotFile: path.basename(snapshotPath) }
  }], 'source,snapshot_sha256');

  console.log('[Migração] Importação e verificação concluídas:', JSON.stringify(summary));
}

main().catch(error => {
  console.error('[Migração] Falha:', error.message);
  process.exitCode = 1;
});
