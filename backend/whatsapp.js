/**
 * Integração com Evolution API (WhatsApp)
 * Substitui a integração com Telegram para receber mensagens COP REDE INFORMA
 */

const { EVOLUTION_CONFIG, ALOCACAO_HUB_CONFIG } = require('./config');
const { processarMensagem } = require('./parser');
const { processarMensagemHub } = require('./parserHub');
const { adicionarCopRedeInforma, adicionarAlerta, obterUltimoTimestamp } = require('./storage');
const storageHub = require('./storageHub');

let isConnected = false;
let instanceInfo = null;
let pollingInterval = null;
let lastMessageTimestamp = 0;
let lastHubMessageTimestamp = 0;

// Intervalo de polling em ms (30 segundos por padrão)
const POLLING_INTERVAL_MS = parseInt(process.env.WHATSAPP_POLLING_INTERVAL || '30000', 10);

/**
 * Faz requisição para a Evolution API
 */
async function evolutionRequest(endpoint, method = 'GET', body = null) {
  const url = `${EVOLUTION_CONFIG.API_URL}${endpoint}`;

  const options = {
    method,
    headers: {
      'apikey': EVOLUTION_CONFIG.API_KEY,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`Evolution API error: ${response.status}`);
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

/**
 * Verifica o status da conexão com a instância
 */
async function verificarConexao() {
  try {
    const result = await evolutionRequest(
      `/instance/connectionState/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`
    );

    instanceInfo = result;
    const state = result?.instance?.state || result?.state || result;
    isConnected = state === 'open' || state === 'connected';

    return {
      conectado: isConnected,
      estado: state,
      dados: result
    };

  } catch (error) {
    console.error('[WhatsApp] Erro conexão:', error.message);
    isConnected = false;
    return {
      conectado: false,
      erro: error.message
    };
  }
}

/**
 * Busca histórico de mensagens do chat
 * IMPORTANTE: Apenas COP REDE INFORMA é carregado do histórico
 * @param {number} limite - Número de mensagens para buscar
 * @returns {Promise<{copRedeInforma: number}>}
 */
async function buscarHistorico(limite = 100) {
  try {
    // Verificar conexão primeiro
    const status = await verificarConexao();
    if (!status.conectado) {
      return { copRedeInforma: 0, erro: 'WhatsApp não conectado' };
    }

    if (!EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
      return { copRedeInforma: 0, erro: 'SOURCE_CHAT_ID não configurado' };
    }

    let messages = [];

    // Função auxiliar para extrair mensagens do resultado
    const extractMessages = (result) => {
      if (Array.isArray(result)) return result;
      if (result.messages?.records) return result.messages.records;
      if (result.messages && Array.isArray(result.messages)) return result.messages;
      if (result.data?.records) return result.data.records;
      if (result.data && Array.isArray(result.data)) return result.data;
      if (result.records) return result.records;
      return [];
    };

    // Método 1: chat/findMessages com where clause
    try {
      const result = await evolutionRequest(
        `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
        'POST',
        {
          where: {
            key: {
              remoteJid: EVOLUTION_CONFIG.SOURCE_CHAT_ID
            }
          },
          limit: limite
        }
      );

      if (!result.instance) {
        messages = extractMessages(result);
      }
    } catch (e1) {
      // Silently try next method
    }

    // Método 2: chat/findMessages com number
    if (messages.length === 0) {
      try {
        const result = await evolutionRequest(
          `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
          'POST',
          {
            number: EVOLUTION_CONFIG.SOURCE_CHAT_ID,
            limit: limite
          }
        );

        if (!result.instance) {
          messages = extractMessages(result);
        }
      } catch (e) {
        // Silently try next method
      }
    }

    // Método 3: Listar todas e filtrar
    if (messages.length === 0) {
      try {
        const result = await evolutionRequest(
          `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
          'POST',
          { limit: 300 }
        );
        if (!result.instance) {
          const allMessages = extractMessages(result);
          messages = allMessages.filter(m =>
            m.key?.remoteJid === EVOLUTION_CONFIG.SOURCE_CHAT_ID ||
            m.remoteJid === EVOLUTION_CONFIG.SOURCE_CHAT_ID
          );
        }
      } catch (e) {
        // Silently continue
      }
    }

    // Filtrar pelo grupo correto
    if (EVOLUTION_CONFIG.SOURCE_CHAT_ID && messages.length > 0) {
      messages = messages.filter(m => {
        const remoteJid = m.key?.remoteJid || m.remoteJid;
        return remoteJid === EVOLUTION_CONFIG.SOURCE_CHAT_ID;
      });
    }

    if (messages.length === 0) {
      return { copRedeInforma: 0, erro: 'Nenhuma mensagem do grupo' };
    }

    let contadores = { copRedeInforma: 0, ignorados: 0 };

    for (const msg of messages) {
      const texto = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.text ||
                    msg.body ||
                    msg.text ||
                    msg.content ||
                    null;

      if (!texto) continue;

      try {
        const msgCompativel = {
          message_id: msg.key?.id || msg.id || Date.now().toString(),
          date: Math.floor((msg.messageTimestamp || msg.timestamp || Date.now() / 1000)),
          text: texto,
          from: {
            username: msg.pushName || msg.key?.participant || 'WhatsApp',
            is_bot: false
          },
          chat: {
            id: msg.key?.remoteJid || EVOLUTION_CONFIG.SOURCE_CHAT_ID
          }
        };

        const resultado = processarMensagem(msgCompativel);

        if (resultado) {
          if (resultado.tipo === 'COP_REDE_INFORMA') {
            await adicionarCopRedeInforma(resultado.dados);
            contadores.copRedeInforma++;
          } else if (resultado.tipo === 'NOVO_EVENTO') {
            // Alertas NÃO são salvos do histórico - apenas em tempo real via webhook
            contadores.ignorados++;
          }
        }
      } catch (msgError) {
        // Skip message on error
      }
    }

    // Log apenas o resumo final
    console.log(`[WhatsApp] Histórico: ${contadores.copRedeInforma} COP REDE INFORMA, ${contadores.ignorados} alertas ignorados`);

    return { copRedeInforma: contadores.copRedeInforma };

  } catch (error) {
    console.error('[WhatsApp] Erro histórico:', error.message);
    return { copRedeInforma: 0, erro: error.message };
  }
}

/**
 * Extrai texto de uma mensagem da Evolution API
 * Suporta múltiplos formatos de mensagem
 */
function extrairTextoMensagem(webhookData) {
  const data = webhookData.data || webhookData;
  const message = data.message || data;

  // Tentar extrair texto de múltiplos campos possíveis
  const texto = message?.conversation ||
                message?.extendedTextMessage?.text ||
                message?.text ||
                message?.body ||
                data?.body ||
                data?.text ||
                webhookData?.body ||
                webhookData?.text ||
                null;

  return { texto, data, message };
}

/**
 * Processa mensagem recebida via webhook
 */
async function processarWebhook(webhookData) {
  try {
    const { texto, data, message } = extrairTextoMensagem(webhookData);

    // Log detalhado para debug
    if (!texto) {
      console.log('[WhatsApp Webhook] Texto não encontrado na mensagem');
      console.log('[WhatsApp Webhook] Estrutura recebida:', JSON.stringify({
        hasData: !!webhookData.data,
        hasMessage: !!(webhookData.data?.message || webhookData.message),
        keys: Object.keys(webhookData.data || webhookData || {}).slice(0, 10)
      }));
      return null;
    }

    // Log do texto recebido (primeiros 100 chars)
    console.log('[WhatsApp Webhook] Texto extraído:', texto.substring(0, 100).replace(/\n/g, '\\n'));

    const chatId = data.key?.remoteJid;

    if (EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
      if (chatId !== EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
        console.log(`[WhatsApp Webhook] Chat ignorado: ${chatId} (esperado: ${EVOLUTION_CONFIG.SOURCE_CHAT_ID})`);
        return null;
      }
    }

    const remetente = data.pushName || data.key?.participant || 'WhatsApp';

    const msgCompativel = {
      message_id: data.key?.id || Date.now().toString(),
      date: Math.floor(Date.now() / 1000),
      text: texto,
      from: { username: remetente, is_bot: false },
      chat: { id: data.key?.remoteJid || 'whatsapp' }
    };

    const resultado = processarMensagem(msgCompativel);

    if (!resultado) {
      // Log para debug quando mensagem não é reconhecida
      const primeiraLinha = texto.split('\n')[0].substring(0, 80);
      console.log(`[WhatsApp Webhook] Mensagem não reconhecida. Primeira linha: "${primeiraLinha}"`);
      return null;
    }

    console.log(`[WhatsApp Webhook] Mensagem reconhecida como: ${resultado.tipo}`);

    if (resultado.tipo === 'COP_REDE_INFORMA') {
      await adicionarCopRedeInforma(resultado.dados);
      console.log('[WhatsApp] COP REDE INFORMA salvo');
      // Log dos clusters extraídos
      if (resultado.dados.resumo?.grupo) {
        console.log('[WhatsApp] Clusters:', JSON.stringify(resultado.dados.resumo.grupo));
      }
    } else if (resultado.tipo === 'NOVO_EVENTO') {
      await adicionarAlerta(resultado.dados);
      console.log('[WhatsApp] Alerta salvo');
    }

    return resultado;

  } catch (error) {
    console.error('[WhatsApp] Erro webhook:', error.message);
    return null;
  }
}

/**
 * Configura webhook na Evolution API
 */
async function configurarWebhook(webhookUrl) {
  try {
    const result = await evolutionRequest(
      `/webhook/set/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
      'POST',
      {
        url: webhookUrl,
        webhook_by_events: false,
        webhook_base64: false,
        events: ['MESSAGES_UPSERT']
      }
    );

    console.log('[WhatsApp] Webhook configurado');
    return result;

  } catch (error) {
    console.error('[WhatsApp] Erro webhook config:', error.message);
    throw error;
  }
}

/**
 * Lista chats disponíveis
 */
async function listarChats() {
  try {
    const chats = await evolutionRequest(
      `/chat/findChats/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`
    );
    return chats;
  } catch (error) {
    console.error('[WhatsApp] Erro listar chats:', error.message);
    return [];
  }
}

/**
 * Obtém status
 */
function obterStatus() {
  return {
    conectado: isConnected,
    instancia: EVOLUTION_CONFIG.INSTANCE_NAME,
    apiUrl: EVOLUTION_CONFIG.API_URL,
    sourceChatId: EVOLUTION_CONFIG.SOURCE_CHAT_ID,
    pollingAtivo: pollingInterval !== null,
    pollingIntervalo: POLLING_INTERVAL_MS,
    lastMessageTimestamp,
    lastMessageDate: lastMessageTimestamp > 0 ? new Date(lastMessageTimestamp * 1000).toISOString() : null
  };
}

/**
 * Busca novas mensagens desde o último polling
 * Usado pelo polling automático para evitar reprocessar mensagens antigas
 */
async function buscarNovasMensagens() {
  try {
    const status = await verificarConexao();
    if (!status.conectado) {
      return { novas: 0, erro: 'WhatsApp não conectado' };
    }

    if (!EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
      return { novas: 0, erro: 'SOURCE_CHAT_ID não configurado' };
    }

    // Buscar últimas 200 mensagens (aumentado de 50 para capturar mais mensagens)
    let messages = [];

    console.log(`[WhatsApp Polling] Buscando mensagens após ${new Date(lastMessageTimestamp * 1000).toISOString()} (ts=${lastMessageTimestamp})`);

    try {
      const result = await evolutionRequest(
        `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
        'POST',
        {
          where: {
            key: {
              remoteJid: EVOLUTION_CONFIG.SOURCE_CHAT_ID
            }
          },
          limit: 200
        }
      );

      if (Array.isArray(result)) {
        messages = result;
      } else if (result.messages?.records) {
        messages = result.messages.records;
      } else if (result.messages && Array.isArray(result.messages)) {
        messages = result.messages;
      }
    } catch (e) {
      console.warn('[WhatsApp Polling] Erro ao buscar mensagens:', e.message);
    }

    console.log(`[WhatsApp Polling] Recebidas ${messages.length} mensagens da Evolution API`);

    // Filtrar pelo grupo correto
    if (EVOLUTION_CONFIG.SOURCE_CHAT_ID && messages.length > 0) {
      messages = messages.filter(m => {
        const remoteJid = m.key?.remoteJid || m.remoteJid;
        return remoteJid === EVOLUTION_CONFIG.SOURCE_CHAT_ID;
      });
      console.log(`[WhatsApp Polling] ${messages.length} mensagens do grupo correto`);
    }

    if (messages.length === 0) {
      console.log('[WhatsApp Polling] Nenhuma mensagem encontrada no grupo');
      return { novas: 0 };
    }

    // Filtrar apenas mensagens novas (após o último timestamp)
    const novasMensagens = messages.filter(m => {
      const timestamp = m.messageTimestamp || m.timestamp || 0;
      return timestamp > lastMessageTimestamp;
    });

    console.log(`[WhatsApp Polling] ${novasMensagens.length} mensagens novas (após filtro de timestamp)`);

    if (novasMensagens.length === 0) {
      return { novas: 0 };
    }

    // Atualizar o timestamp mais recente
    const maxTimestamp = Math.max(...novasMensagens.map(m => m.messageTimestamp || m.timestamp || 0));
    if (maxTimestamp > lastMessageTimestamp) {
      lastMessageTimestamp = maxTimestamp;
    }

    let contadores = { copRedeInforma: 0, alertas: 0 };

    for (const msg of novasMensagens) {
      const texto = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.text ||
                    msg.body ||
                    msg.text ||
                    msg.content ||
                    null;

      if (!texto) continue;

      try {
        const msgCompativel = {
          message_id: msg.key?.id || msg.id || Date.now().toString(),
          date: Math.floor((msg.messageTimestamp || msg.timestamp || Date.now() / 1000)),
          text: texto,
          from: {
            username: msg.pushName || msg.key?.participant || 'WhatsApp',
            is_bot: false
          },
          chat: {
            id: msg.key?.remoteJid || EVOLUTION_CONFIG.SOURCE_CHAT_ID
          }
        };

        const primeiraLinha = texto.split('\n')[0].substring(0, 60);
        const resultado = processarMensagem(msgCompativel);

        if (resultado) {
          if (resultado.tipo === 'COP_REDE_INFORMA') {
            const temCluster = resultado.dados.resumo?.grupo && Object.keys(resultado.dados.resumo.grupo).length > 0;
            console.log(`[WhatsApp Polling] COP REDE salvo | cluster=${temCluster} | "${primeiraLinha}"`);
            await adicionarCopRedeInforma(resultado.dados);
            contadores.copRedeInforma++;
          } else if (resultado.tipo === 'NOVO_EVENTO') {
            await adicionarAlerta(resultado.dados);
            contadores.alertas++;
          }
        } else {
          console.log(`[WhatsApp Polling] Ignorada (formato desconhecido): "${primeiraLinha}"`);
        }
      } catch (msgError) {
        console.error('[WhatsApp Polling] Erro ao processar mensagem:', msgError.message);
      }
    }

    console.log(`[WhatsApp Polling] Resultado: ${contadores.copRedeInforma} COP REDE, ${contadores.alertas} alertas`);

    return { novas: contadores.copRedeInforma + contadores.alertas, ...contadores };

  } catch (error) {
    console.error('[WhatsApp Polling] Erro:', error.message);
    return { novas: 0, erro: error.message };
  }
}

/**
 * Inicia polling automático de mensagens
 * Usado como fallback quando webhook não está configurado
 * Inclui polling para COP REDE INFORMA e Alocação de HUB
 */
async function iniciarPolling() {
  if (pollingInterval) {
    console.log('[WhatsApp] Polling já está ativo');
    return;
  }

  // Obter timestamp da última mensagem armazenada para não perder mensagens após restart
  try {
    const ultimoTimestamp = await obterUltimoTimestamp();
    if (ultimoTimestamp > 0) {
      // Subtrair 1 hora para garantir que não perdemos mensagens em caso de diferença de timezone
      lastMessageTimestamp = ultimoTimestamp - 3600;
      console.log(`[WhatsApp] Usando timestamp da última mensagem: ${new Date(lastMessageTimestamp * 1000).toISOString()}`);
    } else {
      // Fallback: buscar mensagens dos últimos 7 dias
      lastMessageTimestamp = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
      console.log(`[WhatsApp] Nenhuma mensagem anterior, buscando últimos 7 dias`);
    }
  } catch (error) {
    console.error('[WhatsApp] Erro ao obter último timestamp, usando fallback de 7 dias:', error.message);
    lastMessageTimestamp = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
  }

  // Para Hub, usar timestamp atual (não tem persistência de timestamp ainda)
  lastHubMessageTimestamp = Math.floor(Date.now() / 1000);

  console.log(`[WhatsApp] Iniciando polling automático a cada ${POLLING_INTERVAL_MS / 1000}s`);
  console.log(`[WhatsApp] Grupos monitorados: COP REDE INFORMA + Alocação de HUB`);

  // Fazer primeira busca imediatamente para ambos os grupos
  buscarNovasMensagens();
  buscarNovasMensagensHub();

  pollingInterval = setInterval(async () => {
    await buscarNovasMensagens();
    await buscarNovasMensagensHub();
  }, POLLING_INTERVAL_MS);
}

/**
 * Para o polling automático
 */
function pararPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log('[WhatsApp] Polling automático parado');
  }
}

// ============================================
// FUNÇÕES PARA ALOCAÇÃO DE HUB
// ============================================

/**
 * Busca histórico de mensagens do grupo Alocação de HUB
 * @param {number} limite - Número de mensagens para buscar
 */
async function buscarHistoricoHub(limite = 50) {
  try {
    console.log(`[WhatsApp HUB] Iniciando busca de histórico (limite: ${limite})`);
    console.log(`[WhatsApp HUB] CHAT_ID configurado: ${ALOCACAO_HUB_CONFIG.CHAT_ID}`);

    const status = await verificarConexao();
    if (!status.conectado) {
      console.log('[WhatsApp HUB] WhatsApp não conectado');
      return { alocacoes: 0, erro: 'WhatsApp não conectado' };
    }

    if (!ALOCACAO_HUB_CONFIG.CHAT_ID) {
      console.log('[WhatsApp HUB] CHAT_ID não configurado!');
      return { alocacoes: 0, erro: 'ALOCACAO_HUB_CHAT_ID não configurado' };
    }

    let messages = [];

    // Função auxiliar para extrair mensagens do resultado
    const extractMessages = (result) => {
      if (Array.isArray(result)) return result;
      if (result.messages?.records) return result.messages.records;
      if (result.messages && Array.isArray(result.messages)) return result.messages;
      if (result.data?.records) return result.data.records;
      if (result.data && Array.isArray(result.data)) return result.data;
      if (result.records) return result.records;
      return [];
    };

    // Método 1: chat/findMessages com where clause
    try {
      console.log('[WhatsApp HUB] Tentando método 1: findMessages com where clause');
      const result = await evolutionRequest(
        `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
        'POST',
        {
          where: {
            key: {
              remoteJid: ALOCACAO_HUB_CONFIG.CHAT_ID
            }
          },
          limit: limite
        }
      );

      if (!result.instance) {
        messages = extractMessages(result);
        console.log(`[WhatsApp HUB] Método 1: ${messages.length} mensagens encontradas`);
      }
    } catch (e) {
      console.log(`[WhatsApp HUB] Método 1 falhou: ${e.message}`);
      // Silently try next method
    }

    // Método 2: chat/findMessages com number
    if (messages.length === 0) {
      try {
        console.log('[WhatsApp HUB] Tentando método 2: findMessages com number');
        const result = await evolutionRequest(
          `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
          'POST',
          {
            number: ALOCACAO_HUB_CONFIG.CHAT_ID,
            limit: limite
          }
        );

        if (!result.instance) {
          messages = extractMessages(result);
          console.log(`[WhatsApp HUB] Método 2: ${messages.length} mensagens encontradas`);
        }
      } catch (e) {
        console.log(`[WhatsApp HUB] Método 2 falhou: ${e.message}`);
        // Silently continue
      }
    }

    // Método 3: Listar todas e filtrar
    if (messages.length === 0) {
      try {
        console.log('[WhatsApp HUB] Tentando método 3: listar todas e filtrar');
        const result = await evolutionRequest(
          `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
          'POST',
          { limit: 300 }
        );
        if (!result.instance) {
          const allMessages = extractMessages(result);
          console.log(`[WhatsApp HUB] Método 3: ${allMessages.length} mensagens totais encontradas`);
          messages = allMessages.filter(m =>
            m.key?.remoteJid === ALOCACAO_HUB_CONFIG.CHAT_ID ||
            m.remoteJid === ALOCACAO_HUB_CONFIG.CHAT_ID
          );
          console.log(`[WhatsApp HUB] Método 3: ${messages.length} mensagens do grupo HUB após filtro`);

          // Log dos grupos únicos encontrados para debug
          const gruposUnicos = [...new Set(allMessages.map(m => m.key?.remoteJid || m.remoteJid).filter(Boolean))];
          console.log(`[WhatsApp HUB] Grupos disponíveis: ${gruposUnicos.slice(0, 5).join(', ')}${gruposUnicos.length > 5 ? '...' : ''}`);
        }
      } catch (e) {
        console.log(`[WhatsApp HUB] Método 3 falhou: ${e.message}`);
        // Silently continue
      }
    }

    // Filtrar pelo grupo correto
    if (ALOCACAO_HUB_CONFIG.CHAT_ID && messages.length > 0) {
      messages = messages.filter(m => {
        const remoteJid = m.key?.remoteJid || m.remoteJid;
        return remoteJid === ALOCACAO_HUB_CONFIG.CHAT_ID;
      });
    }

    if (messages.length === 0) {
      console.log(`[WhatsApp HUB] Nenhuma mensagem encontrada para o grupo: ${ALOCACAO_HUB_CONFIG.CHAT_ID}`);
      console.log('[WhatsApp HUB] Verifique se o ALOCACAO_HUB_CHAT_ID está correto');
      return { alocacoes: 0, erro: 'Nenhuma mensagem do grupo HUB encontrada. Verifique o CHAT_ID.' };
    }

    console.log(`[WhatsApp HUB] Total de ${messages.length} mensagens para processar`);

    let contadores = { alocacoes: 0, ignorados: 0 };

    for (const msg of messages) {
      const texto = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.text ||
                    msg.body ||
                    msg.text ||
                    msg.content ||
                    null;

      if (!texto) continue;

      try {
        const msgCompativel = {
          message_id: msg.key?.id || msg.id || Date.now().toString(),
          date: Math.floor((msg.messageTimestamp || msg.timestamp || Date.now() / 1000)),
          text: texto,
          from: {
            username: msg.pushName || msg.key?.participant || 'WhatsApp',
            is_bot: false
          },
          chat: {
            id: msg.key?.remoteJid || ALOCACAO_HUB_CONFIG.CHAT_ID
          }
        };

        const resultado = processarMensagemHub(msgCompativel);

        if (resultado && resultado.tipo === 'ALOCACAO_HUB') {
          await storageHub.adicionarAlocacao(resultado.dados);
          contadores.alocacoes++;
        } else {
          contadores.ignorados++;
        }
      } catch (msgError) {
        // Skip message on error
      }
    }

    console.log(`[WhatsApp HUB] Histórico: ${contadores.alocacoes} alocações salvas, ${contadores.ignorados} ignoradas`);

    return { alocacoes: contadores.alocacoes };

  } catch (error) {
    console.error('[WhatsApp HUB] Erro histórico:', error.message);
    return { alocacoes: 0, erro: error.message };
  }
}

/**
 * Busca novas mensagens do grupo Alocação de HUB desde o último polling
 */
async function buscarNovasMensagensHub() {
  try {
    if (!ALOCACAO_HUB_CONFIG.CHAT_ID) {
      return { novas: 0 };
    }

    // Buscar últimas 20 mensagens do grupo HUB
    let messages = [];

    try {
      const result = await evolutionRequest(
        `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
        'POST',
        {
          where: {
            key: {
              remoteJid: ALOCACAO_HUB_CONFIG.CHAT_ID
            }
          },
          limit: 20
        }
      );

      if (Array.isArray(result)) {
        messages = result;
      } else if (result.messages?.records) {
        messages = result.messages.records;
      } else if (result.messages && Array.isArray(result.messages)) {
        messages = result.messages;
      }
    } catch (e) {
      // Silently continue
    }

    // Filtrar pelo grupo correto
    if (ALOCACAO_HUB_CONFIG.CHAT_ID && messages.length > 0) {
      messages = messages.filter(m => {
        const remoteJid = m.key?.remoteJid || m.remoteJid;
        return remoteJid === ALOCACAO_HUB_CONFIG.CHAT_ID;
      });
    }

    if (messages.length === 0) {
      return { novas: 0 };
    }

    // Filtrar apenas mensagens novas (após o último timestamp)
    const novasMensagens = messages.filter(m => {
      const timestamp = m.messageTimestamp || m.timestamp || 0;
      return timestamp > lastHubMessageTimestamp;
    });

    if (novasMensagens.length === 0) {
      return { novas: 0 };
    }

    // Atualizar o timestamp mais recente
    const maxTimestamp = Math.max(...novasMensagens.map(m => m.messageTimestamp || m.timestamp || 0));
    if (maxTimestamp > lastHubMessageTimestamp) {
      lastHubMessageTimestamp = maxTimestamp;
    }

    let contadores = { alocacoes: 0 };

    for (const msg of novasMensagens) {
      const texto = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.text ||
                    msg.body ||
                    msg.text ||
                    msg.content ||
                    null;

      if (!texto) continue;

      try {
        const msgCompativel = {
          message_id: msg.key?.id || msg.id || Date.now().toString(),
          date: Math.floor((msg.messageTimestamp || msg.timestamp || Date.now() / 1000)),
          text: texto,
          from: {
            username: msg.pushName || msg.key?.participant || 'WhatsApp',
            is_bot: false
          },
          chat: {
            id: msg.key?.remoteJid || ALOCACAO_HUB_CONFIG.CHAT_ID
          }
        };

        const resultado = processarMensagemHub(msgCompativel);

        if (resultado && resultado.tipo === 'ALOCACAO_HUB') {
          await storageHub.adicionarAlocacao(resultado.dados);
          contadores.alocacoes++;
        }
      } catch (msgError) {
        // Skip message on error
      }
    }

    if (contadores.alocacoes > 0) {
      console.log(`[WhatsApp Polling HUB] Novas alocações: ${contadores.alocacoes}`);
    }

    return { novas: contadores.alocacoes, ...contadores };

  } catch (error) {
    // Silently fail - HUB polling is secondary
    return { novas: 0, erro: error.message };
  }
}

module.exports = {
  verificarConexao,
  buscarHistorico,
  buscarNovasMensagens,
  buscarHistoricoHub,
  buscarNovasMensagensHub,
  processarWebhook,
  configurarWebhook,
  listarChats,
  obterStatus,
  iniciarPolling,
  pararPolling
};
