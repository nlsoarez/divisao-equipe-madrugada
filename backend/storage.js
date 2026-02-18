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

// ID do bin para mensagens do WhatsApp (será criado se não existir)
let whatsappBinId = JSONBIN_CONFIG.WHATSAPP_BIN_ID;

/**
 * Parseia uma string de data que pode estar em diferentes formatos
 * Suporta: ISO, brasileiro "dd/mm/yyyy HH:mm" e outros
 * @param {string} dataStr - String da data
 * @returns {Date} Objeto Date parseado
 */
function parsearData(dataStr) {
  if (!dataStr) return new Date(0); // Data mínima para ordenação

  // Se já é um Date válido em formato ISO ou compatível
  const dataISO = new Date(dataStr);
  if (!isNaN(dataISO.getTime())) {
    return dataISO;
  }

  // Tentar formato brasileiro "dd/mm/yyyy HH:mm" ou "dd/mm/yyyy"
  const matchBR = dataStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (matchBR) {
    const dia = parseInt(matchBR[1], 10);
    const mes = parseInt(matchBR[2], 10) - 1; // Mês é 0-indexed
    const ano = parseInt(matchBR[3], 10);
    const hora = matchBR[4] ? parseInt(matchBR[4], 10) : 0;
    const minuto = matchBR[5] ? parseInt(matchBR[5], 10) : 0;
    const segundo = matchBR[6] ? parseInt(matchBR[6], 10) : 0;
    return new Date(ano, mes, dia, hora, minuto, segundo);
  }

  // Fallback: retornar data mínima
  return new Date(0);
}

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
  console.log('[Storage] Criando novo bin para mensagens do WhatsApp...');

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
      'X-Bin-Name': 'COP_REDE_INFORMA_WhatsApp'
    },
    body: JSON.stringify(dadosIniciais)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao criar bin: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  whatsappBinId = result.metadata.id;

  console.log('[Storage] Bin criado com ID:', whatsappBinId);
  console.log('[Storage] IMPORTANTE: Adicione WHATSAPP_BIN_ID=' + whatsappBinId + ' ao seu .env');

  return whatsappBinId;
}

/**
 * Obtém o ID do bin, criando um novo se necessário
 * @returns {Promise<string>} ID do bin
 */
async function obterBinId() {
  if (whatsappBinId) {
    return whatsappBinId;
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

    // IMPORTANTE: Fazer MERGE dos dados do JSONBin com o cache local
    // Isso preserva mensagens que foram adicionadas mas não salvas (ex: erro 403)

    // Remover mensagemOriginal de dados já existentes no JSONBin para reduzir tamanho
    // (dados antigos podem ter mensagemOriginal que pesam ~1KB por mensagem)
    const limparMensagemOriginal = (msgs) => msgs.map(m => {
      if (m.mensagemOriginal) {
        const { mensagemOriginal, ...resto } = m;
        return resto;
      }
      return m;
    });

    const dadosDoJSONBin = {
      copRedeInforma: limparMensagemOriginal(dados.copRedeInforma || []),
      alertas: dados.alertas || []
    };

    // Criar mapa de IDs existentes no JSONBin para merge rápido
    const idsJSONBinCop = new Set(dadosDoJSONBin.copRedeInforma.map(m => m.id || m.messageId));
    const idsJSONBinAlertas = new Set(dadosDoJSONBin.alertas.map(a => a.id || a.messageId));

    // Adicionar mensagens do cache local que não existem no JSONBin
    // (são mensagens que foram adicionadas mas não persistidas)
    const mensagensPendentes = (cacheLocal.copRedeInforma || []).filter(
      m => !idsJSONBinCop.has(m.id) && !idsJSONBinCop.has(m.messageId)
    );
    const alertasPendentes = (cacheLocal.alertas || []).filter(
      a => !idsJSONBinAlertas.has(a.id) && !idsJSONBinAlertas.has(a.messageId)
    );

    if (mensagensPendentes.length > 0) {
      console.log(`[Storage] Preservando ${mensagensPendentes.length} mensagens COP não salvas no cache`);
    }
    if (alertasPendentes.length > 0) {
      console.log(`[Storage] Preservando ${alertasPendentes.length} alertas não salvos no cache`);
    }

    // Merge: dados do JSONBin + mensagens pendentes do cache
    cacheLocal = {
      copRedeInforma: [...dadosDoJSONBin.copRedeInforma, ...mensagensPendentes],
      alertas: [...dadosDoJSONBin.alertas, ...alertasPendentes],
      ultimaAtualizacao: new Date().toISOString()
    };

    console.log('[Storage] Dados carregados (merge):', {
      copRedeInforma: cacheLocal.copRedeInforma.length,
      alertas: cacheLocal.alertas.length,
      mensagensPendentes: mensagensPendentes.length,
      alertasPendentes: alertasPendentes.length
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
 * @param {number} tentativa - Número da tentativa atual (para retry)
 * @returns {Promise<boolean>} Sucesso da operação
 */
async function salvarDados(dados, tentativa = 1) {
  const MAX_TENTATIVAS = 3;

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
      // Retry para erros 403 (Forbidden) e 429 (Rate Limit)
      if ((response.status === 403 || response.status === 429) && tentativa < MAX_TENTATIVAS) {
        const tempoEspera = tentativa * 2000; // 2s, 4s, 6s
        console.warn(`[Storage] Erro ${response.status}, aguardando ${tempoEspera/1000}s para retry ${tentativa}/${MAX_TENTATIVAS}...`);
        await new Promise(resolve => setTimeout(resolve, tempoEspera));
        return salvarDados(dados, tentativa + 1);
      }

      // Se erro 403 persistir após retries, tentar criar um novo bin
      if (response.status === 403 && tentativa >= MAX_TENTATIVAS) {
        console.warn('[Storage] Erro 403 persistente. Tentando criar novo bin...');
        try {
          const novoBinId = await criarNovoBinParaMensagens(dadosParaSalvar);
          if (novoBinId) {
            console.log('[Storage] Novo bin criado:', novoBinId);
            console.log('[Storage] IMPORTANTE: Atualize WHATSAPP_BIN_ID=' + novoBinId + ' no Railway');
            return true;
          }
        } catch (criarError) {
          console.error('[Storage] Falha ao criar novo bin:', criarError.message);
        }
      }

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
 * Cria um novo bin quando o atual está inacessível
 * Transfere os dados existentes para o novo bin
 */
async function criarNovoBinParaMensagens(dados) {
  console.log('[Storage] Criando novo bin para substituir o inacessível...');

  // Limitar dados para caber no limite de 100KB do plano gratuito
  const dadosLimitados = {
    copRedeInforma: (dados.copRedeInforma || []).slice(0, 50), // Só últimas 50 mensagens
    alertas: (dados.alertas || []).slice(0, 20), // Só últimos 20 alertas
    ultimaAtualizacao: new Date().toISOString(),
    versao: '1.0'
  };

  console.log(`[Storage] Dados limitados: ${dadosLimitados.copRedeInforma.length} mensagens, ${dadosLimitados.alertas.length} alertas`);

  const response = await fetch(JSONBIN_CONFIG.API_URL, {
    method: 'POST',
    headers: {
      ...getHeaders(),
      'X-Bin-Name': 'COP_REDE_INFORMA_WhatsApp_' + Date.now()
    },
    body: JSON.stringify(dadosLimitados)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro ao criar bin: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const novoBinId = result.metadata.id;

  // Atualizar o ID em memória
  whatsappBinId = novoBinId;

  // Atualizar cache com dados limitados
  cacheLocal = {
    ...dadosLimitados
  };

  console.log('========================================');
  console.log('[Storage] NOVO BIN CRIADO COM SUCESSO!');
  console.log('[Storage] Novo ID:', novoBinId);
  console.log('[Storage] Configure no Railway: WHATSAPP_BIN_ID=' + novoBinId);
  console.log('========================================');

  return novoBinId;
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

    // Remover mensagemOriginal antes de salvar para reduzir tamanho no JSONBin
    // (causa do erro 403: 100 msgs × ~1KB de texto original = 100KB, bate no limite)
    const mensagemParaSalvar = { ...mensagem };
    delete mensagemParaSalvar.mensagemOriginal;

    dados.copRedeInforma.unshift(mensagemParaSalvar); // Adiciona no início

    // Limitar a 150 registros (sem mensagemOriginal, cada msg ocupa ~600 bytes → 90KB)
    if (dados.copRedeInforma.length > 150) {
      dados.copRedeInforma = dados.copRedeInforma.slice(0, 150);
    }

    // IMPORTANTE: Atualizar cache local ANTES de tentar salvar
    // Isso garante que a mensagem fica disponível mesmo se o salvamento falhar
    cacheLocal.copRedeInforma = dados.copRedeInforma;
    cacheLocal.ultimaAtualizacao = new Date().toISOString();

    // Tentar salvar (pode falhar com 403, mas mensagem já está no cache)
    const salvou = await salvarDados(dados);
    if (!salvou) {
      console.log('[Storage] AVISO: Mensagem adicionada ao cache mas NÃO persistida no JSONBin');
    }

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

    // Limitar a 50 registros (plano gratuito JSONBin = máx 100KB)
    if (dados.alertas.length > 50) {
      dados.alertas = dados.alertas.slice(0, 50);
    }

    // IMPORTANTE: Atualizar cache local ANTES de tentar salvar
    // Isso garante que o alerta fica disponível mesmo se o salvamento falhar
    cacheLocal.alertas = dados.alertas;
    cacheLocal.ultimaAtualizacao = new Date().toISOString();

    // Tentar salvar (pode falhar com 403, mas alerta já está no cache)
    const salvou = await salvarDados(dados);
    if (!salvou) {
      console.log('[Storage] AVISO: Alerta adicionado ao cache mas NÃO persistido no JSONBin');
    }

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
    const dataInicioRef = parsearData(filtros.dataInicio);
    mensagens = mensagens.filter(m => {
      const data = m.dataGeracao || m.dataRecebimento || m.dataMensagem;
      return parsearData(data) >= dataInicioRef;
    });
  }

  if (filtros.dataFim) {
    const dataFimRef = parsearData(filtros.dataFim);
    mensagens = mensagens.filter(m => {
      const data = m.dataGeracao || m.dataRecebimento || m.dataMensagem;
      return parsearData(data) <= dataFimRef;
    });
  }

  if (filtros.areaPainel) {
    mensagens = mensagens.filter(m => m.areaPainel === filtros.areaPainel);
  }

  if (filtros.grupo) {
    mensagens = mensagens.filter(m =>
      m.grupoOriginal?.toLowerCase().includes(filtros.grupo.toLowerCase())
    );
  }

  if (filtros.responsavel) {
    mensagens = mensagens.filter(m =>
      m.responsavel?.toLowerCase().includes(filtros.responsavel.toLowerCase())
    );
  }

  if (filtros.tipo) {
    mensagens = mensagens.filter(m =>
      m.tipo?.toLowerCase().includes(filtros.tipo.toLowerCase())
    );
  }

  // Ordenar por data decrescente (mais recente primeiro)
  // IMPORTANTE: Usar dataGeracao (quando a mensagem foi criada no COP) como prioridade,
  // depois dataRecebimento, e messageId como desempate para consistência
  mensagens.sort((a, b) => {
    // Usar dataGeracao como prioridade (é a data real da mensagem COP)
    const dataStrA = a.dataGeracao || a.dataRecebimento || a.dataMensagem;
    const dataStrB = b.dataGeracao || b.dataRecebimento || b.dataMensagem;

    // Usar parsearData para lidar com formato brasileiro "dd/mm/yyyy HH:mm:ss"
    const dateA = parsearData(dataStrA);
    const dateB = parsearData(dataStrB);

    // Se as datas são diferentes, ordenar por data
    if (dateB.getTime() !== dateA.getTime()) {
      return dateB - dateA;
    }

    // Desempate melhorado: tenta parseInt primeiro, senão compara como string
    // Isso garante ordenação estável mesmo com messageIds não numéricos (ex: WhatsApp)
    const msgIdA = parseInt(a.messageId);
    const msgIdB = parseInt(b.messageId);

    // Se ambos são números válidos, comparar numericamente
    if (!isNaN(msgIdA) && !isNaN(msgIdB)) {
      return msgIdB - msgIdA;
    }

    // Fallback: comparar como string (ordem decrescente)
    const strA = String(a.messageId || '');
    const strB = String(b.messageId || '');
    return strB.localeCompare(strA);
  });

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
    const dataInicioRef = parsearData(filtros.dataInicio);
    alertas = alertas.filter(a => {
      const data = a.dataRecebimento || a.dataMensagem;
      return parsearData(data) >= dataInicioRef;
    });
  }

  if (filtros.dataFim) {
    const dataFimRef = parsearData(filtros.dataFim);
    alertas = alertas.filter(a => {
      const data = a.dataRecebimento || a.dataMensagem;
      return parsearData(data) <= dataFimRef;
    });
  }

  if (filtros.areaPainel) {
    alertas = alertas.filter(a => a.areaPainel === filtros.areaPainel);
  }

  if (filtros.statusAlerta) {
    alertas = alertas.filter(a => a.statusAlerta === filtros.statusAlerta);
  }

  if (filtros.grupo) {
    alertas = alertas.filter(a =>
      a.grupoOriginal?.toLowerCase().includes(filtros.grupo.toLowerCase())
    );
  }

  // Ordenar por data decrescente (mais recente primeiro)
  alertas.sort((a, b) => {
    const dataStrA = a.dataRecebimento || a.dataMensagem;
    const dataStrB = b.dataRecebimento || b.dataMensagem;

    const dateA = parsearData(dataStrA);
    const dateB = parsearData(dataStrB);

    if (dateB.getTime() !== dateA.getTime()) {
      return dateB - dateA;
    }

    // Desempate melhorado: tenta parseInt primeiro, senão compara como string
    const msgIdA = parseInt(a.messageId);
    const msgIdB = parseInt(b.messageId);

    if (!isNaN(msgIdA) && !isNaN(msgIdB)) {
      return msgIdB - msgIdA;
    }

    // Fallback: comparar como string (ordem decrescente)
    const strA = String(a.messageId || '');
    const strB = String(b.messageId || '');
    return strB.localeCompare(strA);
  });

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
    const data = m.dataGeracao || m.dataRecebimento || m.dataMensagem;
    if (!data) return false;
    const dataMensagem = parsearData(data);
    dataMensagem.setHours(0, 0, 0, 0);
    return dataMensagem.getTime() === hoje.getTime();
  });

  // Alertas do dia
  const alertasHoje = dados.alertas.filter(a => {
    const data = a.dataRecebimento || a.dataMensagem;
    if (!data) return false;
    const dataMensagem = parsearData(data);
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
  whatsappBinId = binId;
  console.log('[Storage] Bin ID definido:', binId);
}

/**
 * Obtém o ID do bin atual
 * @returns {string|null} ID do bin
 */
function getBinId() {
  return whatsappBinId;
}

/**
 * Limpa completamente o cache local
 * Força busca fresca do JSONBin na próxima requisição
 */
function limparCache() {
  console.log('[Storage] Limpando cache local...');
  cacheLocal = {
    copRedeInforma: [],
    alertas: [],
    ultimaAtualizacao: null
  };
  console.log('[Storage] Cache limpo com sucesso');
}

/**
 * Obtém o timestamp Unix da última mensagem armazenada
 * Usado pelo polling para não reprocessar mensagens já salvas
 * @returns {Promise<number>} Timestamp Unix em segundos (ou 0 se não houver mensagens)
 */
async function obterUltimoTimestamp() {
  try {
    const dados = await carregarDados(true); // Forçar atualização do cache
    const mensagens = dados.copRedeInforma || [];

    if (mensagens.length === 0) {
      console.log('[Storage] Nenhuma mensagem encontrada, retornando timestamp 0');
      return 0;
    }

    // Encontrar a mensagem mais recente baseada em dataRecebimento
    let maxTimestamp = 0;

    for (const msg of mensagens) {
      const dataStr = msg.dataRecebimento || msg.dataGeracao || msg.dataMensagem;
      if (dataStr) {
        const date = parsearData(dataStr);
        const timestamp = Math.floor(date.getTime() / 1000);
        if (timestamp > maxTimestamp) {
          maxTimestamp = timestamp;
        }
      }
    }

    console.log(`[Storage] Último timestamp encontrado: ${maxTimestamp} (${new Date(maxTimestamp * 1000).toISOString()})`);
    return maxTimestamp;
  } catch (error) {
    console.error('[Storage] Erro ao obter último timestamp:', error.message);
    return 0;
  }
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
  criarBin,
  limparCache,
  obterUltimoTimestamp
};
