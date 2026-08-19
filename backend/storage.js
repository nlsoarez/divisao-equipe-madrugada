/**
 * Persistência operacional no Supabase.
 * Cada mensagem/alerta ocupa uma linha; o payload JSON preserva o contrato
 * legado do frontend sem voltar ao modelo de um documento único.
 */

const crypto = require('crypto');
const { client: supabase } = require('./supabase');

const CACHE_TTL_MS = 5000;
let cacheLocal = {
  copRedeInforma: [],
  copRedeEmpresarial: [],
  alertas: [],
  ultimaAtualizacao: null
};

function parsearData(dataStr) {
  if (!dataStr) return new Date(0);

  const matchBR = String(dataStr).match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (matchBR) {
    return new Date(
      Number(matchBR[3]),
      Number(matchBR[2]) - 1,
      Number(matchBR[1]),
      Number(matchBR[4] || 0),
      Number(matchBR[5] || 0),
      Number(matchBR[6] || 0)
    );
  }

  const parsed = new Date(dataStr);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const parsed = parsearData(value);
  return parsed.getTime() === 0 ? null : parsed.toISOString();
}

function toNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function stableId(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24)}`;
}

function messageId(message, channel) {
  return String(message.messageId || message.id || stableId(channel, message));
}

function alertId(alert) {
  return String(alert.id || alert.messageId || stableId('alert', alert));
}

function messageToRow(message, channel) {
  const now = new Date().toISOString();
  return {
    channel,
    message_id: messageId(message, channel),
    record_id: message.id ? String(message.id) : null,
    event_at: toIsoOrNull(message.dataGeracao || message.dataMensagem || message.dataRecebimento),
    received_at: toIsoOrNull(message.dataRecebimento),
    area_panel: message.areaPainel || null,
    original_group: message.grupoOriginal || null,
    responsible: message.responsavel || null,
    message_type: message.tipo || null,
    volume: toNonNegativeInteger(message.volume),
    payload: message,
    updated_at: now
  };
}

function alertToRow(alert) {
  const now = new Date().toISOString();
  return {
    alert_id: alertId(alert),
    message_id: alert.messageId ? String(alert.messageId) : null,
    event_at: toIsoOrNull(alert.dataMensagem || alert.dataRecebimento),
    received_at: toIsoOrNull(alert.dataRecebimento),
    area_panel: alert.areaPainel || null,
    original_group: alert.grupoOriginal || null,
    status: ['novo', 'em_analise', 'tratado'].includes(alert.statusAlerta)
      ? alert.statusAlerta
      : 'novo',
    payload: alert,
    updated_at: now
  };
}

function messageFromRow(row) {
  return {
    ...(row.payload || {}),
    id: row.payload?.id || row.record_id || row.message_id,
    messageId: row.payload?.messageId || row.message_id
  };
}

function alertFromRow(row) {
  return {
    ...(row.payload || {}),
    id: row.payload?.id || row.alert_id,
    messageId: row.payload?.messageId || row.message_id,
    statusAlerta: row.status,
    atualizadoEm: row.updated_at
  };
}

function sortByOperationalDate(items, dateFields) {
  return items.sort((a, b) => {
    const dateA = parsearData(dateFields.map(field => a[field]).find(Boolean));
    const dateB = parsearData(dateFields.map(field => b[field]).find(Boolean));
    if (dateB.getTime() !== dateA.getTime()) return dateB - dateA;

    const idA = String(a.messageId || a.id || '');
    const idB = String(b.messageId || b.id || '');
    return idB.localeCompare(idA);
  });
}

function cacheDisponivel() {
  return Boolean(
    cacheLocal.ultimaAtualizacao &&
    (cacheLocal.copRedeInforma.length || cacheLocal.copRedeEmpresarial.length || cacheLocal.alertas.length)
  );
}

async function carregarDados(forcarAtualizacao = false) {
  if (!forcarAtualizacao && cacheLocal.ultimaAtualizacao) {
    const idade = Date.now() - new Date(cacheLocal.ultimaAtualizacao).getTime();
    if (idade < CACHE_TTL_MS) return { ...cacheLocal };
  }

  try {
    const [messageRows, alertRows] = await Promise.all([
      supabase.selectAll('operational_messages', {
        select: '*',
        order: 'event_at.desc.nullslast,created_at.desc'
      }),
      supabase.selectAll('operational_alerts', {
        select: '*',
        order: 'event_at.desc.nullslast,created_at.desc'
      })
    ]);

    cacheLocal = {
      copRedeInforma: messageRows
        .filter(row => row.channel === 'cop_rede_informa')
        .map(messageFromRow),
      copRedeEmpresarial: messageRows
        .filter(row => row.channel === 'cop_rede_empresarial')
        .map(messageFromRow),
      alertas: alertRows.map(alertFromRow),
      ultimaAtualizacao: new Date().toISOString()
    };

    return { ...cacheLocal };
  } catch (error) {
    if (cacheDisponivel()) {
      console.error('[Storage] Supabase indisponível; usando cache de leitura:', error.message);
      return { ...cacheLocal };
    }
    throw error;
  }
}

async function salvarDados(dados) {
  const messages = [
    ...(dados.copRedeInforma || []).map(item => messageToRow(item, 'cop_rede_informa')),
    ...(dados.copRedeEmpresarial || []).map(item => messageToRow(item, 'cop_rede_empresarial'))
  ];
  const alerts = (dados.alertas || []).map(alertToRow);

  if (messages.length) {
    await supabase.upsert('operational_messages', messages, 'channel,message_id');
  }
  if (alerts.length) {
    await supabase.upsert('operational_alerts', alerts, 'alert_id');
  }

  limparCache();
  return true;
}

async function adicionarMensagem(message, channel) {
  await supabase.upsert(
    'operational_messages',
    [messageToRow(message, channel)],
    'channel,message_id'
  );
  limparCache();
  return true;
}

async function adicionarCopRedeInforma(message) {
  return adicionarMensagem(message, 'cop_rede_informa');
}

async function adicionarCopRedeEmpresarial(message) {
  return adicionarMensagem(message, 'cop_rede_empresarial');
}

async function adicionarAlerta(alert) {
  await supabase.upsert('operational_alerts', [alertToRow(alert)], 'alert_id');
  limparCache();
  return true;
}

async function atualizarStatusAlerta(id, status) {
  const result = await supabase.request('operational_alerts', {
    method: 'PATCH',
    query: { alert_id: `eq.${id}` },
    headers: { Prefer: 'return=representation' },
    body: { status, updated_at: new Date().toISOString() }
  });
  limparCache();
  return Array.isArray(result.data) && result.data.length > 0;
}

async function excluirAlerta(id) {
  const result = await supabase.request('operational_alerts', {
    method: 'DELETE',
    query: { alert_id: `eq.${id}` },
    headers: { Prefer: 'return=representation' }
  });
  limparCache();
  return Array.isArray(result.data) && result.data.length > 0;
}

async function excluirTodosAlertas() {
  await supabase.request('operational_alerts', {
    method: 'DELETE',
    query: { id: 'not.is.null' },
    headers: { Prefer: 'return=minimal' }
  });
  limparCache();
  return true;
}

function aplicarFiltroData(items, filtros, dateFields) {
  let filtered = items;
  if (filtros.dataInicio) {
    const inicio = parsearData(filtros.dataInicio);
    filtered = filtered.filter(item => {
      const value = dateFields.map(field => item[field]).find(Boolean);
      return parsearData(value) >= inicio;
    });
  }
  if (filtros.dataFim) {
    const fim = parsearData(filtros.dataFim);
    filtered = filtered.filter(item => {
      const value = dateFields.map(field => item[field]).find(Boolean);
      return parsearData(value) <= fim;
    });
  }
  return filtered;
}

async function obterCopRedeInforma(filtros = {}, forcarAtualizacao = false) {
  const dados = await carregarDados(forcarAtualizacao);
  let messages = aplicarFiltroData(
    [...dados.copRedeInforma],
    filtros,
    ['dataGeracao', 'dataRecebimento', 'dataMensagem']
  );

  if (filtros.areaPainel) messages = messages.filter(item => item.areaPainel === filtros.areaPainel);
  if (filtros.grupo) messages = messages.filter(item => item.grupoOriginal?.toLowerCase().includes(filtros.grupo.toLowerCase()));
  if (filtros.responsavel) messages = messages.filter(item => item.responsavel?.toLowerCase().includes(filtros.responsavel.toLowerCase()));
  if (filtros.tipo) messages = messages.filter(item => item.tipo?.toLowerCase().includes(filtros.tipo.toLowerCase()));

  return sortByOperationalDate(messages, ['dataGeracao', 'dataRecebimento', 'dataMensagem']);
}

async function obterCopRedeEmpresarial(filtros = {}, forcarAtualizacao = false) {
  const dados = await carregarDados(forcarAtualizacao);
  const messages = aplicarFiltroData(
    [...dados.copRedeEmpresarial],
    filtros,
    ['dataGeracao', 'dataRecebimento', 'dataMensagem']
  );
  return sortByOperationalDate(messages, ['dataGeracao', 'dataRecebimento', 'dataMensagem']);
}

async function obterAlertas(filtros = {}) {
  const dados = await carregarDados();
  let alerts = aplicarFiltroData(
    [...dados.alertas],
    filtros,
    ['dataRecebimento', 'dataMensagem']
  );

  if (filtros.areaPainel) alerts = alerts.filter(item => item.areaPainel === filtros.areaPainel);
  if (filtros.statusAlerta) alerts = alerts.filter(item => item.statusAlerta === filtros.statusAlerta);
  if (filtros.grupo) alerts = alerts.filter(item => item.grupoOriginal?.toLowerCase().includes(filtros.grupo.toLowerCase()));

  return sortByOperationalDate(alerts, ['dataRecebimento', 'dataMensagem']);
}

async function obterEstatisticas() {
  const dados = await carregarDados();
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const copHoje = dados.copRedeInforma.filter(message => {
    const date = parsearData(message.dataGeracao || message.dataRecebimento || message.dataMensagem);
    date.setHours(0, 0, 0, 0);
    return date.getTime() === hoje.getTime();
  });
  const alertsHoje = dados.alertas.filter(alert => {
    const date = parsearData(alert.dataRecebimento || alert.dataMensagem);
    date.setHours(0, 0, 0, 0);
    return date.getTime() === hoje.getTime();
  });

  const volumePorArea = {};
  for (const message of copHoje) {
    if (!message.areaPainel) continue;
    volumePorArea[message.areaPainel] = (volumePorArea[message.areaPainel] || 0) + (message.volume || 1);
  }

  return {
    totalCopRedeInforma: dados.copRedeInforma.length,
    copRedeInformaHoje: copHoje.length,
    totalAlertas: dados.alertas.length,
    alertasHoje: alertsHoje.length,
    alertasNovos: dados.alertas.filter(item => item.statusAlerta === 'novo').length,
    alertasEmAnalise: dados.alertas.filter(item => item.statusAlerta === 'em_analise').length,
    alertasTratados: dados.alertas.filter(item => item.statusAlerta === 'tratado').length,
    volumePorArea,
    ultimaAtualizacao: cacheLocal.ultimaAtualizacao
  };
}

function limparCache() {
  cacheLocal = {
    copRedeInforma: [],
    copRedeEmpresarial: [],
    alertas: [],
    ultimaAtualizacao: null
  };
}

function getBinId() {
  return supabase.isConfigured() ? 'supabase' : null;
}

function setBinId() {
  console.warn('[Storage] BIN_ID ignorado: a persistência agora usa Supabase.');
  return false;
}

async function criarBin() {
  if (!supabase.isConfigured()) {
    throw new Error('Supabase não configurado');
  }
  return 'supabase';
}

async function obterUltimoTimestamp() {
  const messages = await obterCopRedeInforma({}, true);
  let maxTimestamp = 0;
  for (const message of messages) {
    const value = message.dataMensagem || message.dataGeracao || message.dataRecebimento;
    const timestamp = Math.floor(parsearData(value).getTime() / 1000);
    if (timestamp > maxTimestamp) maxTimestamp = timestamp;
  }
  return maxTimestamp;
}

module.exports = {
  carregarDados,
  salvarDados,
  adicionarCopRedeInforma,
  adicionarCopRedeEmpresarial,
  obterCopRedeEmpresarial,
  adicionarAlerta,
  atualizarStatusAlerta,
  excluirAlerta,
  excluirTodosAlertas,
  obterCopRedeInforma,
  obterAlertas,
  obterEstatisticas,
  setBinId,
  getBinId,
  criarBin,
  limparCache,
  obterUltimoTimestamp,
  _internals: {
    parsearData,
    messageToRow,
    alertToRow
  }
};
