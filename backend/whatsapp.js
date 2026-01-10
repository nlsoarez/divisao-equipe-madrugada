/**
 * Integração com Evolution API (WhatsApp)
 * Substitui a integração com Telegram para receber mensagens COP REDE INFORMA
 */

const { EVOLUTION_CONFIG } = require('./config');
const { processarMensagem } = require('./parser');
const { adicionarCopRedeInforma, adicionarAlerta } = require('./storage');

let isConnected = false;
let instanceInfo = null;

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
 * Processa mensagem recebida via webhook
 */
async function processarWebhook(webhookData) {
  try {
    const data = webhookData.data || webhookData;
    const message = data.message || data;

    const texto = message?.conversation ||
                  message?.extendedTextMessage?.text ||
                  data?.body ||
                  null;

    if (!texto) {
      return null;
    }

    if (EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
      const chatId = data.key?.remoteJid;
      if (chatId !== EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
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
      return null;
    }

    if (resultado.tipo === 'COP_REDE_INFORMA') {
      await adicionarCopRedeInforma(resultado.dados);
      console.log('[WhatsApp] COP REDE INFORMA salvo');
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
    sourceChatId: EVOLUTION_CONFIG.SOURCE_CHAT_ID
  };
}

module.exports = {
  verificarConexao,
  buscarHistorico,
  processarWebhook,
  configurarWebhook,
  listarChats,
  obterStatus
};
