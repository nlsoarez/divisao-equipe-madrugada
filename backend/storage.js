/**
 * Módulo de persistência - JSONBin.io
 * Gerencia o armazenamento de mensagens COP REDE INFORMA e Alertas
 */

const fetch = require('node-fetch');
const { JSONBIN_CONFIG } = require('./config');

// Cache local para reduzir requisições
let cacheLocal = {
  copRedeInforma: [],
  alertas: [],
  ultimaAtualizacao: null
};

// ID do bin para mensagens do Telegram (será criado se não existir)
let telegramBinId = JSONBIN_CONFIG.TELEGRAM_BIN_ID;

/**
 * Headers padrão para requisições ao JSONBin
 */
function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-Master-Key': JSONBIN_CONFIG.MASTER_KEY,
    'X-Access-Key': JSONBIN_CONFIG.ACCESS_KEY
  };
}

/**
 * Cria um novo bin no JSONBin.io
 * @returns {Promise<string>} ID do bin criado
 */
async function criarBin() {
  console.log('[Storage] Criando novo bin para mensagens do Telegram...');

  const dadosIniciais = {
    copRedeInforma: [],
    alertas: [],
    ultimaAtualizacao: new Date().toISOString(),
    versao: '1.0'
  };

  const response = await fetch(JSONBIN_CONFIG.API_URL, {
    method: 'POST',
    headers: {
      ...getHeaders(),
      'X-Bin-Name': 'COP_REDE_INFORMA_Telegram'
    },
    body: JSON.stringify(dadosIniciais)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao criar bin: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  telegramBinId = result.metadata.id;

  console.log('[Storage] Bin criado com ID:', telegramBinId);
  console.log('[Storage] IMPORTANTE: Adicione TELEGRAM_BIN_ID=' + telegramBinId + ' ao seu .env');

  return telegramBinId;
}

/**
 * Obtém o ID do bin, criando um novo se necessário
 * @returns {Promise<string>} ID do bin
 */
async function obterBinId() {
  if (telegramBinId) {
    return telegramBinId;
  }

  // Tentar criar um novo bin
  return await criarBin();
}

/**
 * Carrega todos os dados do JSONBin
 * @param {boolean} forcarAtualizacao - Se deve ignorar o cache
 * @returns {Promise<object>} Dados carregados
 */
async function carregarDados(forcarAtualizacao = false) {
  // Usar cache se disponível e não forçar atualização
  if (!forcarAtualizacao && cacheLocal.ultimaAtualizacao) {
    const idadeCache = Date.now() - new Date(cacheLocal.ultimaAtualizacao).getTime();
    if (idadeCache < 5000) { // Cache válido por 5 segundos (antes era 30s)
      return {
        copRedeInforma: cacheLocal.copRedeInforma,
        alertas: cacheLocal.alertas
      };
    }
  }

  try {
    const binId = await obterBinId();

    console.log('[Storage] Carregando dados do bin:', binId);

    const response = await fetch(`${JSONBIN_CONFIG.API_URL}/${binId}/latest`, {
      headers: getHeaders()
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log('[Storage] Bin não encontrado, criando novo...');
        await criarBin();
        return { copRedeInforma: [], alertas: [] };
      }
      throw new Error(`Erro ao carregar dados: ${response.status}`);
    }

    const result = await response.json();
    const dados = result.record;

    // Atualizar cache
    cacheLocal = {
      copRedeInforma: dados.copRedeInforma || [],
      alertas: dados.alertas || [],
      ultimaAtualizacao: new Date().toISOString()
    };

    console.log('[Storage] Dados carregados:', {
      copRedeInforma: cacheLocal.copRedeInforma.length,
      alertas: cacheLocal.alertas.length
    });

    return {
      copRedeInforma: cacheLocal.copRedeInforma,
      alertas: cacheLocal.alertas
    };

  } catch (error) {
    console.error('[Storage] Erro ao carregar dados:', error);
    // Retornar cache local em caso de erro
    return {
      copRedeInforma: cacheLocal.copRedeInforma || [],
      alertas: cacheLocal.alertas || []
    };
  }
}

/**
 * Salva todos os dados no JSONBin
 * @param {object} dados - Dados a serem salvos
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function salvarDados(dados) {
  try {
    const binId = await obterBinId();

    console.log('[Storage] Salvando dados no bin:', binId);

    const dadosParaSalvar = {
      copRedeInforma: dados.copRedeInforma || cacheLocal.copRedeInforma || [],
      alertas: dados.alertas || cacheLocal.alertas || [],
      ultimaAtualizacao: new Date().toISOString(),
      versao: '1.0'
    };

    const response = await fetch(`${JSONBIN_CONFIG.API_URL}/${binId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(dadosParaSalvar)
    });

    if (!response.ok) {
      throw new Error(`Erro ao salvar dados: ${response.status}`);
    }

    // Atualizar cache local
    cacheLocal = {
      ...dadosParaSalvar,
      ultimaAtualizacao: new Date().toISOString()
    };

    console.log('[Storage] Dados salvos com sucesso');
    return true;

  } catch (error) {
    console.error('[Storage] Erro ao salvar dados:', error);
    return false;
  }
}

/**
 * Adiciona uma mensagem COP REDE INFORMA
 * @param {object} mensagem - Dados da mensagem
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function adicionarCopRedeInforma(mensagem) {
  try {
    const dados = await carregarDados(true);

    // Verificar duplicata pelo messageId
    const duplicata = dados.copRedeInforma.find(m => m.messageId === mensagem.messageId);
    if (duplicata) {
      console.log('[Storage] Mensagem COP REDE INFORMA já existe:', mensagem.messageId);
      return false;
    }

    dados.copRedeInforma.unshift(mensagem); // Adiciona no início

    // Limitar a 1000 registros
    if (dados.copRedeInforma.length > 1000) {
      dados.copRedeInforma = dados.copRedeInforma.slice(0, 1000);
    }

    await salvarDados(dados);
    console.log('[Storage] Mensagem COP REDE INFORMA adicionada:', mensagem.id);
    return true;

  } catch (error) {
    console.error('[Storage] Erro ao adicionar COP REDE INFORMA:', error);
    return false;
  }
}

/**
 * Adiciona um alerta (Novo Evento)
 * @param {object} alerta - Dados do alerta
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function adicionarAlerta(alerta) {
  try {
    const dados = await carregarDados(true);

    // Verificar duplicata pelo messageId
    const duplicata = dados.alertas.find(a => a.messageId === alerta.messageId);
    if (duplicata) {
      console.log('[Storage] Alerta já existe:', alerta.messageId);
      return false;
    }

    dados.alertas.unshift(alerta); // Adiciona no início

    // Limitar a 500 registros
    if (dados.alertas.length > 500) {
      dados.alertas = dados.alertas.slice(0, 500);
    }

    await salvarDados(dados);
    console.log('[Storage] Alerta adicionado:', alerta.id);
    return true;

  } catch (error) {
    console.error('[Storage] Erro ao adicionar alerta:', error);
    return false;
  }
}

/**
 * Atualiza o status de um alerta
 * @param {string} alertaId - ID do alerta
 * @param {string} novoStatus - Novo status
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function atualizarStatusAlerta(alertaId, novoStatus) {
  try {
    const dados = await carregarDados(true);

    const alerta = dados.alertas.find(a => a.id === alertaId);
    if (!alerta) {
      console.log('[Storage] Alerta não encontrado:', alertaId);
      return false;
    }

    alerta.statusAlerta = novoStatus;
    alerta.atualizadoEm = new Date().toISOString();

    await salvarDados(dados);
    console.log('[Storage] Status do alerta atualizado:', alertaId, '->', novoStatus);
    return true;

  } catch (error) {
    console.error('[Storage] Erro ao atualizar status do alerta:', error);
    return false;
  }
}

/**
 * Excluir um alerta
 * @param {string} alertaId - ID do alerta
 * @returns {Promise<boolean>} True se excluído com sucesso
 */
async function excluirAlerta(alertaId) {
  try {
    const dados = await carregarDados(true);

    const index = dados.alertas.findIndex(a => a.id === alertaId);
    if (index === -1) {
      console.log('[Storage] Alerta não encontrado:', alertaId);
      return false;
    }

    dados.alertas.splice(index, 1);

    await salvarDados(dados);
    console.log('[Storage] Alerta excluído:', alertaId);
    return true;

  } catch (error) {
    console.error('[Storage] Erro ao excluir alerta:', error);
    return false;
  }
}

/**
 * Excluir todos os alertas
 * @returns {Promise<boolean>} True se excluídos com sucesso
 */
async function excluirTodosAlertas() {
  try {
    const dados = await carregarDados(true);
    const totalAntes = dados.alertas.length;

    dados.alertas = [];

    await salvarDados(dados);
    console.log('[Storage] Todos os alertas excluídos. Total:', totalAntes);
    return true;

  } catch (error) {
    console.error('[Storage] Erro ao excluir todos os alertas:', error);
    return false;
  }
}

/**
 * Obtém mensagens COP REDE INFORMA com filtros
 * @param {object} filtros - Filtros opcionais
 * @param {boolean} forcarAtualizacao - Forçar atualização do cache
 * @returns {Promise<array>} Lista de mensagens filtradas
 */
async function obterCopRedeInforma(filtros = {}, forcarAtualizacao = false) {
  const dados = await carregarDados(forcarAtualizacao);
  let mensagens = dados.copRedeInforma;

  // Aplicar filtros
  if (filtros.dataInicio) {
    mensagens = mensagens.filter(m => new Date(m.dataMensagem) >= new Date(filtros.dataInicio));
  }

  if (filtros.dataFim) {
    mensagens = mensagens.filter(m => new Date(m.dataMensagem) <= new Date(filtros.dataFim));
  }

  if (filtros.areaPainel) {
    mensagens = mensagens.filter(m => m.areaPainel === filtros.areaPainel);
  }

  if (filtros.grupo) {
    mensagens = mensagens.filter(m =>
      m.grupoOriginal.toLowerCase().includes(filtros.grupo.toLowerCase())
    );
  }

  if (filtros.responsavel) {
    mensagens = mensagens.filter(m =>
      m.responsavel.toLowerCase().includes(filtros.responsavel.toLowerCase())
    );
  }

  if (filtros.tipo) {
    mensagens = mensagens.filter(m =>
      m.tipo.toLowerCase().includes(filtros.tipo.toLowerCase())
    );
  }

  // Ordenar por data decrescente
  mensagens.sort((a, b) => new Date(b.dataMensagem) - new Date(a.dataMensagem));

  return mensagens;
}

/**
 * Obtém alertas com filtros
 * @param {object} filtros - Filtros opcionais
 * @returns {Promise<array>} Lista de alertas filtrados
 */
async function obterAlertas(filtros = {}) {
  const dados = await carregarDados();
  let alertas = dados.alertas;

  // Aplicar filtros
  if (filtros.dataInicio) {
    alertas = alertas.filter(a => new Date(a.dataMensagem) >= new Date(filtros.dataInicio));
  }

  if (filtros.dataFim) {
    alertas = alertas.filter(a => new Date(a.dataMensagem) <= new Date(filtros.dataFim));
  }

  if (filtros.areaPainel) {
    alertas = alertas.filter(a => a.areaPainel === filtros.areaPainel);
  }

  if (filtros.statusAlerta) {
    alertas = alertas.filter(a => a.statusAlerta === filtros.statusAlerta);
  }

  if (filtros.grupo) {
    alertas = alertas.filter(a =>
      a.grupoOriginal.toLowerCase().includes(filtros.grupo.toLowerCase())
    );
  }

  // Ordenar por data decrescente
  alertas.sort((a, b) => new Date(b.dataMensagem) - new Date(a.dataMensagem));

  return alertas;
}

/**
 * Obtém estatísticas consolidadas
 * @returns {Promise<object>} Estatísticas
 */
async function obterEstatisticas() {
  const dados = await carregarDados();

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  // COP REDE INFORMA do dia
  const copHoje = dados.copRedeInforma.filter(m => {
    const dataMensagem = new Date(m.dataMensagem);
    dataMensagem.setHours(0, 0, 0, 0);
    return dataMensagem.getTime() === hoje.getTime();
  });

  // Alertas do dia
  const alertasHoje = dados.alertas.filter(a => {
    const dataMensagem = new Date(a.dataMensagem);
    dataMensagem.setHours(0, 0, 0, 0);
    return dataMensagem.getTime() === hoje.getTime();
  });

  // Volume por área (hoje)
  const volumePorArea = {};
  copHoje.forEach(m => {
    if (!volumePorArea[m.areaPainel]) {
      volumePorArea[m.areaPainel] = 0;
    }
    volumePorArea[m.areaPainel] += m.volume || 1;
  });

  // Alertas por status
  const alertasPorStatus = {
    novo: dados.alertas.filter(a => a.statusAlerta === 'novo').length,
    em_analise: dados.alertas.filter(a => a.statusAlerta === 'em_analise').length,
    tratado: dados.alertas.filter(a => a.statusAlerta === 'tratado').length
  };

  return {
    totalCopRedeInforma: dados.copRedeInforma.length,
    copRedeInformaHoje: copHoje.length,
    totalAlertas: dados.alertas.length,
    alertasHoje: alertasHoje.length,
    alertasNovos: alertasPorStatus.novo,
    alertasEmAnalise: alertasPorStatus.em_analise,
    alertasTratados: alertasPorStatus.tratado,
    volumePorArea,
    ultimaAtualizacao: cacheLocal.ultimaAtualizacao
  };
}

/**
 * Define o ID do bin manualmente
 * @param {string} binId - ID do bin
 */
function setBinId(binId) {
  telegramBinId = binId;
  console.log('[Storage] Bin ID definido:', binId);
}

/**
 * Obtém o ID do bin atual
 * @returns {string|null} ID do bin
 */
function getBinId() {
  return telegramBinId;
}

module.exports = {
  carregarDados,
  salvarDados,
  adicionarCopRedeInforma,
  adicionarAlerta,
  atualizarStatusAlerta,
  excluirAlerta,
  excluirTodosAlertas,
  obterCopRedeInforma,
  obterAlertas,
  obterEstatisticas,
  setBinId,
  getBinId,
  criarBin
};
