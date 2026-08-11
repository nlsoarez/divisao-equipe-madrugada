/** Persistência das alocações de HUB no Supabase. */

const crypto = require('crypto');
const { client: supabase } = require('./supabase');

const CACHE_TTL_MS = 5000;
let cachedData = null;
let cacheTimestamp = 0;

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

function toIsoOrNull(value) {
  const parsed = parseDate(value);
  return parsed ? parsed.toISOString() : null;
}

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
    allocation_type: ['DIURNO', 'MADRUGADA'].includes(allocation.tipoAlocacao)
      ? allocation.tipoAlocacao
      : null,
    allocation_date: toDateOnly(allocation.data),
    received_at: toIsoOrNull(allocation.dataRecebimento),
    payload: allocation,
    updated_at: new Date().toISOString()
  };
}

function allocationFromRow(row) {
  return {
    ...(row.payload || {}),
    id: row.payload?.id || row.record_id || row.message_id,
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
    // A Evolution pode devolver o mesmo evento mais de uma vez. O Postgres
    // rejeita duas linhas com a mesma chave no mesmo comando de upsert.
    rowsByMessageId.set(row.message_id, row);
  }
  return [...rowsByMessageId.values()];
}

function limparCache() {
  cachedData = null;
  cacheTimestamp = 0;
}

async function carregarDados(forcarAtualizacao = false) {
  const idade = Date.now() - cacheTimestamp;
  if (!forcarAtualizacao && cachedData && idade < CACHE_TTL_MS) return cachedData;

  try {
    const rows = await supabase.selectAll('hub_allocations', {
      select: '*',
      order: 'received_at.desc.nullslast,created_at.desc'
    });
    cachedData = {
      alocacoes: rows.map(allocationFromRow),
      ultimaAtualizacao: new Date().toISOString()
    };
    cacheTimestamp = Date.now();
    return cachedData;
  } catch (error) {
    if (cachedData) {
      console.error('[StorageHub] Supabase indisponível; usando cache de leitura:', error.message);
      return cachedData;
    }
    throw error;
  }
}

async function salvarDados(dados) {
  const rows = uniqueAllocationRows(dados.alocacoes);
  if (rows.length) {
    await supabase.upsert('hub_allocations', rows, 'message_id');
  }
  limparCache();
  return true;
}

async function adicionarAlocacoesBatch(novasAlocacoes) {
  if (!Array.isArray(novasAlocacoes) || novasAlocacoes.length === 0) return 0;
  const rows = uniqueAllocationRows(novasAlocacoes);
  await supabase.upsert(
    'hub_allocations',
    rows,
    'message_id'
  );
  limparCache();
  return rows.length;
}

async function adicionarAlocacao(alocacao) {
  await supabase.upsert('hub_allocations', [allocationToRow(alocacao)], 'message_id');
  limparCache();
  return true;
}

async function obterAlocacoes(filtros = {}) {
  const dados = await carregarDados();
  let alocacoes = [...dados.alocacoes];
  if (filtros.tipo) alocacoes = alocacoes.filter(item => item.tipoAlocacao === filtros.tipo);
  if (filtros.data) alocacoes = alocacoes.filter(item => item.data === filtros.data);
  return alocacoes.sort((a, b) => (parseDate(b.dataRecebimento) || 0) - (parseDate(a.dataRecebimento) || 0));
}

async function obterUltimaAlocacao() {
  const ordenadas = await obterAlocacoes();
  if (!ordenadas.length) return null;

  const ultimaMadrugada = ordenadas.find(item => item.tipoAlocacao === 'MADRUGADA') || null;
  const ultimoDiurno = ordenadas.find(item => item.tipoAlocacao === 'DIURNO') || null;
  const horaBrasilia = (new Date().getUTCHours() - 3 + 24) % 24;

  if (horaBrasilia < 5) return ultimaMadrugada || ultimoDiurno || ordenadas[0];
  if (ultimaMadrugada && ultimoDiurno) {
    const madrugadaTime = parseDate(ultimaMadrugada.dataRecebimento)?.getTime() || 0;
    const diurnoTime = parseDate(ultimoDiurno.dataRecebimento)?.getTime() || 0;
    return madrugadaTime > diurnoTime ? ultimaMadrugada : ultimoDiurno;
  }
  return ultimoDiurno || ultimaMadrugada || ordenadas[0];
}

async function obterEstatisticas() {
  const dados = await carregarDados();
  return {
    total: dados.alocacoes.length,
    diurno: dados.alocacoes.filter(item => item.tipoAlocacao === 'DIURNO').length,
    madrugada: dados.alocacoes.filter(item => item.tipoAlocacao === 'MADRUGADA').length,
    ultimaAtualizacao: dados.ultimaAtualizacao
  };
}

function getBinId() {
  return supabase.isConfigured() ? 'supabase' : null;
}

function setBinId() {
  console.warn('[StorageHub] BIN_ID ignorado: a persistência agora usa Supabase.');
  return false;
}

async function criarBin() {
  if (!supabase.isConfigured()) throw new Error('Supabase não configurado');
  return 'supabase';
}

module.exports = {
  setBinId,
  getBinId,
  limparCache,
  criarBin,
  carregarDados,
  salvarDados,
  adicionarAlocacao,
  adicionarAlocacoesBatch,
  obterUltimaAlocacao,
  obterAlocacoes,
  obterEstatisticas,
  _internals: { allocationToRow, uniqueAllocationRows, parseDate }
};
