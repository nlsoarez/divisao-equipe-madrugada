/**
 * Storage para Alocação de HUB
 * Armazena dados em bin separado no JSONBin.io
 */

const { ALOCACAO_HUB_CONFIG } = require('./config');

// Cache local
let cachedData = null;
let cacheTimestamp = 0;
let binId = ALOCACAO_HUB_CONFIG.BIN_ID;

/**
 * Define o Bin ID para persistência
 */
function setBinId(id) {
  binId = id;
  cachedData = null;
  cacheTimestamp = 0;
  console.log(`[StorageHub] Bin ID configurado: ${id}`);
}

/**
 * Obtém o Bin ID atual
 */
function getBinId() {
  return binId;
}

/**
 * Limpa o cache
 */
function limparCache() {
  cachedData = null;
  cacheTimestamp = 0;
  console.log('[StorageHub] Cache limpo');
}

/**
 * Faz requisição ao JSONBin.io
 */
async function jsonBinRequest(method, data = null) {
  if (!binId) {
    throw new Error('Bin ID não configurado para Alocação de HUB');
  }

  const url = `https://api.jsonbin.io/v3/b/${binId}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Master-Key': ALOCACAO_HUB_CONFIG.MASTER_KEY
  };

  if (ALOCACAO_HUB_CONFIG.ACCESS_KEY) {
    headers['X-Access-Key'] = ALOCACAO_HUB_CONFIG.ACCESS_KEY;
  }

  const options = {
    method,
    headers
  };

  if (data && method !== 'GET') {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`JSONBin error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Cria um novo bin para Alocação de HUB
 */
async function criarBin() {
  const url = 'https://api.jsonbin.io/v3/b';

  const dadosIniciais = {
    alocacoes: [],
    ultimaAtualizacao: new Date().toISOString()
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Master-Key': ALOCACAO_HUB_CONFIG.MASTER_KEY,
    'X-Bin-Name': 'alocacao-hub'
  };

  if (ALOCACAO_HUB_CONFIG.ACCESS_KEY) {
    headers['X-Access-Key'] = ALOCACAO_HUB_CONFIG.ACCESS_KEY;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(dadosIniciais)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao criar bin: ${errorText}`);
  }

  const result = await response.json();
  const novoBinId = result.metadata.id;

  setBinId(novoBinId);
  console.log(`[StorageHub] Novo bin criado: ${novoBinId}`);

  return novoBinId;
}

/**
 * Carrega dados do JSONBin
 */
async function carregarDados(forcarAtualizacao = false) {
  const agora = Date.now();
  const idadeCache = agora - cacheTimestamp;

  // Cache válido por 5 segundos
  if (!forcarAtualizacao && cachedData && idadeCache < 5000) {
    return cachedData;
  }

  if (!binId) {
    console.log('[StorageHub] Bin ID não configurado, retornando dados vazios');
    return { alocacoes: [], ultimaAtualizacao: null };
  }

  try {
    const result = await jsonBinRequest('GET');
    cachedData = result.record || { alocacoes: [], ultimaAtualizacao: null };
    cacheTimestamp = agora;
    return cachedData;
  } catch (error) {
    console.error('[StorageHub] Erro ao carregar dados:', error.message);
    if (cachedData) {
      return cachedData;
    }
    return { alocacoes: [], ultimaAtualizacao: null };
  }
}

/**
 * Salva dados no JSONBin
 */
async function salvarDados(dados) {
  if (!binId) {
    throw new Error('Bin ID não configurado para Alocação de HUB');
  }

  dados.ultimaAtualizacao = new Date().toISOString();

  await jsonBinRequest('PUT', dados);
  cachedData = dados;
  cacheTimestamp = Date.now();

  return true;
}

/**
 * Adiciona uma nova alocação de HUB
 * Mantém apenas as últimas 50 alocações
 */
async function adicionarAlocacao(alocacao) {
  const dados = await carregarDados(true);

  // Verifica duplicata por messageId
  const existente = dados.alocacoes.find(a => a.messageId === alocacao.messageId);
  if (existente) {
    console.log(`[StorageHub] Alocação já existe: ${alocacao.messageId}`);
    return false;
  }

  // Adiciona nova alocação no início
  dados.alocacoes.unshift(alocacao);

  // Mantém apenas as últimas 50
  if (dados.alocacoes.length > 50) {
    dados.alocacoes = dados.alocacoes.slice(0, 50);
  }

  await salvarDados(dados);
  console.log(`[StorageHub] Alocação ${alocacao.tipoAlocacao} salva: ${alocacao.id}`);

  return true;
}

/**
 * Obtém a alocação adequada para o momento atual, aplicando lógica de horário:
 * - Antes das 05h (horário de Brasília): exibe MADRUGADA (turno noturno ativo)
 * - Após as 05h: exibe DIURNO, exceto se uma nova MADRUGADA chegou depois do último DIURNO
 *   (nesse caso, a nova atualização de MADRUGADA é exibida imediatamente)
 */
async function obterUltimaAlocacao() {
  const dados = await carregarDados();

  if (!dados.alocacoes || dados.alocacoes.length === 0) {
    return null;
  }

  // Ordena por data de recebimento (mais recente primeiro)
  const ordenadas = [...dados.alocacoes].sort((a, b) => {
    return new Date(b.dataRecebimento) - new Date(a.dataRecebimento);
  });

  const ultimaMadrugada = ordenadas.find(a => a.tipoAlocacao === 'MADRUGADA') || null;
  const ultimoDiurno = ordenadas.find(a => a.tipoAlocacao === 'DIURNO') || null;

  // Hora atual em horário de Brasília (UTC-3, sem DST desde 2019)
  const agora = new Date();
  const horaBrasilia = (agora.getUTCHours() - 3 + 24) % 24;

  if (horaBrasilia < 5) {
    // Antes das 05h: turno noturno ativo, exibir MADRUGADA
    return ultimaMadrugada || ultimoDiurno || ordenadas[0];
  }

  // Após as 05h: preferir DIURNO
  if (ultimaMadrugada && ultimoDiurno) {
    const tsMadrugada = new Date(ultimaMadrugada.dataRecebimento).getTime();
    const tsDiurno = new Date(ultimoDiurno.dataRecebimento).getTime();
    // Se nova MADRUGADA chegou depois do último DIURNO, atualizar na hora
    if (tsMadrugada > tsDiurno) {
      return ultimaMadrugada;
    }
    return ultimoDiurno;
  }

  return ultimoDiurno || ultimaMadrugada || ordenadas[0];
}

/**
 * Obtém todas as alocações
 */
async function obterAlocacoes(filtros = {}) {
  const dados = await carregarDados();

  let alocacoes = dados.alocacoes || [];

  // Filtro por tipo (DIURNO/MADRUGADA)
  if (filtros.tipo) {
    alocacoes = alocacoes.filter(a => a.tipoAlocacao === filtros.tipo);
  }

  // Filtro por data
  if (filtros.data) {
    alocacoes = alocacoes.filter(a => a.data === filtros.data);
  }

  // Ordena por data de recebimento (mais recente primeiro)
  alocacoes.sort((a, b) => {
    return new Date(b.dataRecebimento) - new Date(a.dataRecebimento);
  });

  return alocacoes;
}

/**
 * Obtém estatísticas
 */
async function obterEstatisticas() {
  const dados = await carregarDados();
  const alocacoes = dados.alocacoes || [];

  return {
    total: alocacoes.length,
    diurno: alocacoes.filter(a => a.tipoAlocacao === 'DIURNO').length,
    madrugada: alocacoes.filter(a => a.tipoAlocacao === 'MADRUGADA').length,
    ultimaAtualizacao: dados.ultimaAtualizacao
  };
}

module.exports = {
  setBinId,
  getBinId,
  limparCache,
  criarBin,
  carregarDados,
  salvarDados,
  adicionarAlocacao,
  obterUltimaAlocacao,
  obterAlocacoes,
  obterEstatisticas
};
