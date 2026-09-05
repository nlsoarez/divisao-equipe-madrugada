/**
 * Persistência operacional no Supabase.
 * Cada mensagem/alerta ocupa uma linha; o payload JSON preserva o contrato
 * legado do frontend sem voltar ao modelo de um documento único.
 */

const crypto = require('crypto');
const { client: supabase } = require('./supabase');

const { createReadCache } = require('./readCache');
const messagesCache = createReadCache();
const alertsCache = createReadCache();
const statsCache = createReadCache({ ttl: 30000 });
const DEFAULT_OPERATIONAL_MESSAGE_LIMIT = Math.min(500, Math.max(1, Number(process.env.DEFAULT_OPERATIONAL_MESSAGE_LIMIT) || 200));
const DEFAULT_ALERT_LIMIT = Math.min(500, Math.max(1, Number(process.env.DEFAULT_ALERT_LIMIT) || 100));
const livePages = new Map();

function liveQuery(stream, filters = {}) {
  const allowed = ['since','before','dataInicio','dataFim','areaPainel','grupo','responsavel','tipo','statusAlerta','areaMapeada','data','busca'];
  return !allowed.some(key => filters[key]) && (filters.limit === undefined || Number(filters.limit) === (stream === 'alertas' ? DEFAULT_ALERT_LIMIT : DEFAULT_OPERATIONAL_MESSAGE_LIMIT));
}
function liveKey(item) { return String(item?._syncKey || item?.messageId || item?.id || ''); }
function liveSortAt(item, stream) {
  const value = stream === 'alertas' ? (item?.dataRecebimento || item?.dataMensagem || item?.atualizadoEm) : (item?.dataGeracao || item?.dataRecebimento || item?.dataMensagem);
  return parsearData(value).getTime();
}
function updateLivePage(stream, item) {
  const page = livePages.get(stream);
  if (!page || !item) return;
  const key = liveKey(item);
  const rows = page.dados.filter(row => liveKey(row) !== key);
  rows.push(item);
  rows.sort((a,b) => liveSortAt(b,stream)-liveSortAt(a,stream) || liveKey(b).localeCompare(liveKey(a)));
  const limit = stream === 'alertas' ? DEFAULT_ALERT_LIMIT : DEFAULT_OPERATIONAL_MESSAGE_LIMIT;
  page.dados = rows.slice(0,limit);
  page.total = page.dados.length;
  livePages.set(stream,page);
}
function removeLivePage(stream, id) {
  const page = livePages.get(stream);
  if (!page) return;
  const target=String(id);
  page.dados = page.dados.filter(row => ![row?._syncKey,row?.messageId,row?.id].some(value => String(value ?? '') === target));
  page.total = page.dados.length;
}

function parsearData(dataStr) {
  if (!dataStr) return new Date(0);
  const matchBR = String(dataStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (matchBR) {
    return new Date(Number(matchBR[3]), Number(matchBR[2]) - 1, Number(matchBR[1]), Number(matchBR[4] || 0), Number(matchBR[5] || 0), Number(matchBR[6] || 0));
  }
  const parsed = new Date(dataStr);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}
function toIsoOrNull(value) { if (!value) return null; const parsed = parsearData(value); return parsed.getTime() === 0 ? null : parsed.toISOString(); }
function toNonNegativeInteger(value) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null; }
function stableId(prefix, value) { return `${prefix}-${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`; }
function messageId(message, channel) { return String(message.messageId || message.id || stableId(channel, message)); }
function alertId(alert) { return String(alert.id || alert.messageId || stableId('alert', alert)); }

function messageToRow(message, channel) {
  const now = new Date().toISOString();
  return {
    channel, message_id: messageId(message, channel), record_id: message.id ? String(message.id) : null,
    event_at: toIsoOrNull(message.dataGeracao || message.dataMensagem || message.dataRecebimento),
    received_at: toIsoOrNull(message.dataRecebimento), area_panel: message.areaPainel || null,
    original_group: message.grupoOriginal || null, responsible: message.responsavel || null,
    message_type: message.tipo || null, volume: toNonNegativeInteger(message.volume), payload: message, updated_at: now
  };
}
function alertToRow(alert) {
  const now = new Date().toISOString();
  return {
    alert_id: alertId(alert), message_id: alert.messageId ? String(alert.messageId) : null,
    event_at: toIsoOrNull(alert.dataMensagem || alert.dataRecebimento), received_at: toIsoOrNull(alert.dataRecebimento),
    area_panel: alert.areaPainel || null, original_group: alert.grupoOriginal || null,
    status: ['novo', 'em_analise', 'tratado'].includes(alert.statusAlerta) ? alert.statusAlerta : 'novo', payload: alert, updated_at: now
  };
}
function messageFromRow(row) { return { ...(row.payload || {}), id: row.payload?.id || row.record_id || row.message_id, messageId: row.payload?.messageId || row.message_id }; }
function alertFromRow(row) {
  return { ...(row.payload || {}), id: row.payload?.id || row.alert_id, messageId: row.payload?.messageId || row.message_id,
    statusAlerta: row.status, status: ({novo:'novo',em_analise:'em_andamento',tratado:'resolvido'})[row.status] || row.status, atualizadoEm: row.updated_at };
}
function sortByOperationalDate(items, dateFields) {
  return items.sort((a, b) => {
    const dateA = parsearData(dateFields.map(field => a[field]).find(Boolean));
    const dateB = parsearData(dateFields.map(field => b[field]).find(Boolean));
    if (dateB.getTime() !== dateA.getTime()) return dateB - dateA;
    return String(b.messageId || b.id || '').localeCompare(String(a.messageId || a.id || ''));
  });
}

// Explicit administrative export only; normal reads never call this function.
async function carregarDados() {
  const [messages, alerts] = await Promise.all([
    supabase.selectAll('operational_messages', { select: 'channel,message_id,record_id,payload', order: 'id.asc' }),
    supabase.selectAll('operational_alerts', { select: 'alert_id,message_id,status,updated_at,payload', order: 'id.asc' })
  ]);
  return { copRedeInforma: messages.filter(r => r.channel === 'cop_rede_informa').map(messageFromRow),
    copRedeEmpresarial: messages.filter(r => r.channel === 'cop_rede_empresarial').map(messageFromRow),
    alertas: alerts.map(alertFromRow), ultimaAtualizacao: new Date().toISOString() };
}

function pageOptions(stream, filters = {}) {
  const limit = filters.limit === undefined ? (stream === 'alertas' ? DEFAULT_ALERT_LIMIT : DEFAULT_OPERATIONAL_MESSAGE_LIMIT) : Number(filters.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw Object.assign(new Error('limit deve estar entre 1 e 500'), { status: 400 });
  let before = null;
  if (filters.before) {
    try {
      before = JSON.parse(Buffer.from(filters.before, 'base64url').toString());
      if (!/^\d+$/.test(before.id) || !before.at || Number.isNaN(Date.parse(before.at))) throw new Error();
    } catch { throw Object.assign(new Error('Cursor before invalido'), { status: 400 }); }
  }
  if (filters.since !== undefined && !/^\d+$/.test(String(filters.since))) throw Object.assign(new Error('Cursor since invalido'), { status: 400 });
  if (before && filters.since !== undefined) throw Object.assign(new Error('Use before ou since'), { status: 400 });
  const allowed = ['dataInicio','dataFim','areaPainel','grupo','responsavel','tipo','statusAlerta','areaMapeada','data','busca'];
  const selected = {};
  for (const key of allowed) if (filters[key]) {
    if (typeof filters[key] !== 'string' || filters[key].length > 300) throw Object.assign(new Error('Filtro invalido'), { status: 400 });
    selected[key] = filters[key];
  }
  for (const key of ['dataInicio','dataFim']) if (selected[key]) {
    const parsed = parsearData(selected[key]);
    if (!parsed.getTime()) throw Object.assign(new Error('Data invalida'), { status: 400 });
    selected[key] = parsed.toISOString();
  }
  if (selected.data && !/^\d{4}-\d{2}-\d{2}$/.test(selected.data)) throw Object.assign(new Error('Data invalida'), { status: 400 });
  return { p_stream: stream, p_limit: limit, p_since: filters.since === undefined ? null : String(filters.since), p_before: before, p_filters: selected };
}

async function obterPagina(stream, filters = {}) {
  if (!['cop_rede_informa','cop_rede_empresarial','alertas'].includes(stream)) throw Object.assign(new Error('Canal invalido'), { status: 400 });
  if (liveQuery(stream, filters) && livePages.has(stream)) return { sucesso:true, ...livePages.get(stream) };
  const options = pageOptions(stream, filters);
  const cache = stream === 'alertas' ? alertsCache : messagesCache;
  const result = await cache.get(stream + ':' + JSON.stringify(options), async () => {
    const started = Date.now();
    const page = await supabase.rpc('operational_page', options, { readOnly: true });
    console.log('[Supabase] ' + stream + ' query: ' + page.dados.length + ' rows durationMs=' + (Date.now()-started));
    return { ...page, before: page.before ? Buffer.from(JSON.stringify(page.before)).toString('base64url') : null };
  });
  const response = { ...result, total: result.dados.length };
  if (liveQuery(stream, filters)) livePages.set(stream, response);
  return { sucesso: true, ...response };
}

async function salvarDados(dados) {
  const messages = [ ...(dados.copRedeInforma || []).map(item => messageToRow(item, 'cop_rede_informa')), ...(dados.copRedeEmpresarial || []).map(item => messageToRow(item, 'cop_rede_empresarial')) ];
  const alerts = (dados.alertas || []).map(alertToRow);
  if (messages.length) await supabase.upsert('operational_messages', messages, 'channel,message_id');
  if (alerts.length) await supabase.upsert('operational_alerts', alerts, 'alert_id');
  limparCache(); return true;
}
async function adicionarMensagem(message, channel) {
  await supabase.upsert('operational_messages', [messageToRow(message, channel)], 'channel,message_id');
  updateLivePage(channel, message); messagesCache.clear(); statsCache.clear(); return true;
}
async function adicionarCopRedeInforma(message) { return adicionarMensagem(message, 'cop_rede_informa'); }
async function adicionarCopRedeEmpresarial(message) { return adicionarMensagem(message, 'cop_rede_empresarial'); }
async function adicionarAlerta(alert) {
  await supabase.upsert('operational_alerts', [alertToRow(alert)], 'alert_id');
  updateLivePage('alertas', alert); alertsCache.clear(); statsCache.clear(); return true;
}
async function atualizarStatusAlerta(id, status) {
  const result = await supabase.request('operational_alerts', {
    method: 'PATCH', query: { alert_id: `eq.${id}`, select: 'alert_id' }, headers: { Prefer: 'return=representation' },
    body: { status, updated_at: new Date().toISOString() }
  });
  const found = Array.isArray(result.data) && result.data.length > 0;
  if (found) {
    const page=livePages.get('alertas');
    const item=page?.dados.find(row => [row?._syncKey,row?.messageId,row?.id].some(value => String(value ?? '')===String(id)));
    if (item) updateLivePage('alertas',{...item,statusAlerta:status,status:({novo:'novo',em_analise:'em_andamento',tratado:'resolvido'})[status]||status,atualizadoEm:new Date().toISOString()});
  }
  alertsCache.clear(); statsCache.clear(); return found;
}
async function excluirAlerta(id) {
  const result = await supabase.request('operational_alerts', { method: 'DELETE', query: { alert_id: `eq.${id}`, select: 'alert_id' }, headers: { Prefer: 'return=representation' } });
  const found = Array.isArray(result.data) && result.data.length > 0;
  if (found) removeLivePage('alertas', id);
  alertsCache.clear(); statsCache.clear(); return found;
}
async function excluirTodosAlertas() {
  await supabase.request('operational_alerts', { method: 'DELETE', query: { id: 'not.is.null' }, headers: { Prefer: 'return=minimal' } });
  livePages.set('alertas',{dados:[],removed:[],cursor:null,hasMore:false,before:null,total:0});
  alertsCache.clear(); statsCache.clear(); return true;
}
async function obterCopRedeInforma(filtros = {}) { return (await obterPagina('cop_rede_informa', filtros)).dados; }
async function obterCopRedeEmpresarial(filtros = {}) { return (await obterPagina('cop_rede_empresarial', filtros)).dados; }
async function obterAlertas(filtros = {}) { return (await obterPagina('alertas', filtros)).dados; }

async function obterPorId(stream, id) {
  const isAlert = stream === 'alertas';
  const column = isAlert ? 'alert_id' : 'record_id';
  const literal = '"' + String(id).replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"';
  const rows = await supabase.select(isAlert ? 'operational_alerts' : 'operational_messages', {
    select: isAlert ? 'alert_id,message_id,status,updated_at,payload' : 'record_id,message_id,payload',
    filters: { ...(isAlert ? {} : { channel: 'eq.'+stream }), or: '(payload->>id.eq.'+literal+','+column+'.eq.'+literal+','+(isAlert ? 'alert_id' : 'message_id')+'.eq.'+literal+')' }, limit: 1
  });
  return rows.length ? (isAlert ? alertFromRow(rows[0]) : messageFromRow(rows[0])) : null;
}
async function obterEstatisticas() {
  const start = new Date(); start.setHours(0,0,0,0); const end = new Date(start); end.setDate(end.getDate()+1);
  return statsCache.get('statistics:'+start.toISOString(), () => supabase.rpc('operational_statistics', { p_start:start.toISOString(), p_end:end.toISOString() }, { readOnly:true }));
}
async function obterResumoAreas(filters = {}) {
  const dates = pageOptions('cop_rede_informa',filters).p_filters;
  return statsCache.get('areas:'+JSON.stringify(dates), () => supabase.rpc('operational_area_summary', { p_start:dates.dataInicio || null, p_end:dates.dataFim || null }, { readOnly:true }));
}
async function obterContadoresDiagnostico() { return statsCache.get('diagnostic-counts',()=>supabase.rpc('operational_diagnostic_counts',{}, {readOnly:true})); }
function limparCache() { livePages.clear(); messagesCache.clear(); alertsCache.clear(); statsCache.clear(); }
function getBinId() { return supabase.isConfigured() ? 'supabase' : null; }
function setBinId() { console.warn('[Storage] BIN_ID ignorado: a persistência agora usa Supabase.'); return false; }
async function criarBin() { if (!supabase.isConfigured()) throw new Error('Supabase não configurado'); return 'supabase'; }
async function obterUltimoTimestamp() {
  const rows = await supabase.select('operational_messages', { select: 'event_at', filters: { channel: 'eq.cop_rede_informa', event_at: 'not.is.null' }, order: 'event_at.desc', limit: 1 });
  return rows.length ? Math.floor(parsearData(rows[0].event_at).getTime()/1000) : 0;
}

module.exports = {
  obterPagina, obterPorId, obterResumoAreas, obterContadoresDiagnostico, carregarDados, salvarDados,
  adicionarCopRedeInforma, adicionarCopRedeEmpresarial, obterCopRedeEmpresarial, adicionarAlerta,
  atualizarStatusAlerta, excluirAlerta, excluirTodosAlertas, obterCopRedeInforma, obterAlertas,
  obterEstatisticas, setBinId, getBinId, criarBin, limparCache, obterUltimoTimestamp,
  _internals: { parsearData, messageToRow, alertToRow }
};
