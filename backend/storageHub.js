/** Persistência das alocações de HUB no Supabase. */

const crypto = require('crypto');
const { client: supabase } = require('./supabase');

const { createReadCache } = require('./readCache');
const cache = createReadCache();
const HUB_TIME_ZONE = 'America/Sao_Paulo';

function stableId(value) {
  return `hub-${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`;
}

function parseDate(value) {
  if (!value) return null;
  const br = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  const parsed = br
    ? new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]), Number(br[4] || 0), Number(br[5] || 0), Number(br[6] || 0))
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoOrNull(value) { const parsed = parseDate(value); return parsed ? parsed.toISOString() : null; }
function toDateOnly(value) {
  const br = value && String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${String(br[2]).padStart(2, '0')}-${String(br[1]).padStart(2, '0')}`;
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}
function allocationToRow(allocation) {
  const messageId = String(allocation.messageId || allocation.id || stableId(allocation));
  return {
    message_id: messageId,
    record_id: allocation.id ? String(allocation.id) : null,
    allocation_type: ['DIURNO', 'MADRUGADA'].includes(allocation.tipoAlocacao) ? allocation.tipoAlocacao : null,
    allocation_date: toDateOnly(allocation.data),
    received_at: toIsoOrNull(allocation.dataRecebimento),
    payload: allocation,
    updated_at: new Date().toISOString()
  };
}
function allocationFromRow(row) {
  return {
    ...(row.payload || {}), id: row.payload?.id || row.record_id || row.message_id,
    messageId: row.payload?.messageId || row.message_id,
    tipoAlocacao: row.payload?.tipoAlocacao || row.allocation_type,
    data: row.payload?.data || row.allocation_date,
    dataRecebimento: row.payload?.dataRecebimento || row.received_at
  };
}
function uniqueAllocationRows(allocations) {
  const rowsByMessageId = new Map();
  for (const allocation of allocations || []) {
    const row = allocationToRow(allocation);
    rowsByMessageId.set(row.message_id, row);
  }
  return [...rowsByMessageId.values()];
}
function saoPauloDateParts(value) {
  const date = value instanceof Date ? value : parseDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: HUB_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
}
function dateKey(parts) { return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`; }
function nextDateKey(parts) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
function madrugadaEstaVigente(allocation, now = new Date()) {
  const receivedAt = parseDate(allocation?.dataRecebimento);
  const currentDate = now instanceof Date ? now : parseDate(now);
  if (!receivedAt || !currentDate || receivedAt.getTime() > currentDate.getTime()) return false;
  const receivedParts = saoPauloDateParts(receivedAt);
  const currentParts = saoPauloDateParts(currentDate);
  const currentKey = dateKey(currentParts);
  if (currentKey === dateKey(receivedParts)) return true;
  return currentKey === nextDateKey(receivedParts) && (currentParts.hour * 60 + currentParts.minute) < 5 * 60;
}
function selecionarAlocacaoAtual(allocations, now = new Date()) {
  const ordered = [...(allocations || [])].sort((a, b) => (parseDate(b.dataRecebimento)?.getTime() || 0) - (parseDate(a.dataRecebimento)?.getTime() || 0));
  const activeNightAllocation = ordered.find(item => item.tipoAlocacao === 'MADRUGADA' && madrugadaEstaVigente(item, now));
  if (activeNightAllocation) return activeNightAllocation;
  return ordered.find(item => item.tipoAlocacao === 'DIURNO') || null;
}

function limparCache() { cache.clear(); }
const COLUMNS = 'id,message_id,record_id,allocation_type,allocation_date,received_at,payload';

// Explicit administrative export only.
async function carregarDados() {
  const rows = await supabase.selectAll('hub_allocations', { select: COLUMNS, order: 'id.asc' });
  return { alocacoes: rows.map(allocationFromRow), ultimaAtualizacao: new Date().toISOString() };
}
async function obterPagina(filtros = {}) {
  const limit = filtros.limit === undefined ? 100 : Number(filtros.limit);
  if (!Number.isInteger(limit) || limit<1 || limit>500) throw Object.assign(new Error('Limite invalido'),{status:400});
  let before;
  if (filtros.before) {
    try {
      before=JSON.parse(Buffer.from(filtros.before,'base64url').toString());
      if (!/^\d+$/.test(before.id) || (before.at!==null && (!before.at || Number.isNaN(Date.parse(before.at))))) throw new Error();
    } catch { throw Object.assign(new Error('Cursor invalido'),{status:400}); }
  }
  const filters = {};
  if (filtros.tipo) filters.allocation_type = 'eq.'+filtros.tipo;
  if (filtros.data) filters.allocation_date = 'eq.'+toDateOnly(filtros.data);
  if (before && before.at===null) { filters.received_at='is.null'; filters.id='lt.'+before.id; }
  else if (before) {
    const at=new Date(before.at).toISOString();
    filters.or=`(received_at.lt.${at},and(received_at.eq.${at},id.lt.${before.id}),received_at.is.null)`;
  }
  return cache.get('hub:'+JSON.stringify({limit,filters}),async () => {
    const rows = await supabase.select('hub_allocations',{select:COLUMNS,filters,order:'received_at.desc.nullslast,id.desc',limit:limit+1});
    const page=rows.slice(0,limit);
    return { sucesso:true,dados:page.map(allocationFromRow),total:page.length,hasMore:rows.length>limit,
      before:page.length ? Buffer.from(JSON.stringify({id:String(page[page.length-1].id),at:page[page.length-1].received_at || null})).toString('base64url') : null };
  });
}
async function salvarDados(dados) {
  const rows = uniqueAllocationRows(dados.alocacoes);
  if (rows.length) await supabase.upsert('hub_allocations', rows, 'message_id');
  limparCache(); return true;
}
async function adicionarAlocacoesBatch(novasAlocacoes) {
  if (!Array.isArray(novasAlocacoes) || novasAlocacoes.length === 0) return 0;
  const rows = uniqueAllocationRows(novasAlocacoes);
  await supabase.upsert('hub_allocations', rows, 'message_id');
  limparCache(); return rows.length;
}
async function adicionarAlocacao(alocacao) {
  await supabase.upsert('hub_allocations', [allocationToRow(alocacao)], 'message_id');
  limparCache(); return true;
}
async function obterAlocacoes(filtros = {}) { return (await obterPagina(filtros)).dados; }
async function obterUltimaAlocacao(now = new Date()) {
  const rows = await cache.get('hub-current',async () => {
    const [day,night] = await Promise.all([
      supabase.select('hub_allocations',{select:COLUMNS,filters:{allocation_type:'eq.DIURNO'},order:'received_at.desc.nullslast,id.desc',limit:1}),
      supabase.select('hub_allocations',{select:COLUMNS,filters:{allocation_type:'eq.MADRUGADA',received_at:'lte.'+now.toISOString()},order:'received_at.desc.nullslast,id.desc',limit:1})
    ]);
    return { dados:[...day,...night].map(allocationFromRow) };
  });
  const allocation=selecionarAlocacaoAtual(rows.dados,now);
  if (rows.degraded && allocation) return { ...allocation, degraded:true, stale:true };
  return allocation;
}
async function obterEstatisticas() { return cache.get('hub-statistics', () => supabase.rpc('hub_statistics',{}, {readOnly:true})); }
function getBinId() { return supabase.isConfigured() ? 'supabase' : null; }
function setBinId() { console.warn('[StorageHub] BIN_ID ignorado: a persistência agora usa Supabase.'); return false; }
async function criarBin() { if (!supabase.isConfigured()) throw new Error('Supabase não configurado'); return 'supabase'; }
module.exports = {
  obterPagina, setBinId, getBinId, limparCache, criarBin, carregarDados, salvarDados,
  adicionarAlocacao, adicionarAlocacoesBatch, obterUltimaAlocacao, obterAlocacoes, obterEstatisticas,
  _internals: { allocationToRow, uniqueAllocationRows, parseDate, madrugadaEstaVigente, selecionarAlocacaoAtual }
};
