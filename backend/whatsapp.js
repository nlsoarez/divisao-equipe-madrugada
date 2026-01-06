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

  console.log(`[WhatsApp] Request: ${method} ${url}`);

  const options = {
    method,
    headers: {
      'apikey': EVOLUTION_CONFIG.API_KEY,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
    console.log(`[WhatsApp] Body:`, JSON.stringify(body).substring(0, 200));
  }

  const response = await fetch(url, options);
  const responseText = await response.text();

  console.log(`[WhatsApp] Response status: ${response.status}`);
  console.log(`[WhatsApp] Response:`, responseText.substring(0, 300));

  if (!response.ok) {
    throw new Error(`Evolution API error: ${response.status} - ${responseText}`);
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
    console.log('[WhatsApp] Verificando conexão com Evolution API...');
    console.log('[WhatsApp] URL:', EVOLUTION_CONFIG.API_URL);
    console.log('[WhatsApp] Instância:', EVOLUTION_CONFIG.INSTANCE_NAME);

    const result = await evolutionRequest(
      `/instance/connectionState/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`
    );

    instanceInfo = result;
    const state = result?.instance?.state || result?.state || result;
    isConnected = state === 'open' || state === 'connected';

    console.log('[WhatsApp] Estado:', state);
    console.log('[WhatsApp] Conectado:', isConnected);

    return {
      conectado: isConnected,
      estado: state,
      dados: result
    };

  } catch (error) {
    console.error('[WhatsApp] Erro ao verificar conexão:', error.message);
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
    console.log('[WhatsApp] ====================================');
    console.log(`[WhatsApp] BUSCANDO HISTÓRICO (${limite} mensagens)...`);
    console.log('[WhatsApp] SOURCE_CHAT_ID:', EVOLUTION_CONFIG.SOURCE_CHAT_ID);
    console.log('[WhatsApp] ====================================');

    // Verificar conexão primeiro
    const status = await verificarConexao();
    if (!status.conectado) {
      console.log('[WhatsApp] Não conectado - não é possível buscar histórico');
      return { copRedeInforma: 0, erro: 'WhatsApp não conectado' };
    }

    // Se não tem SOURCE_CHAT_ID configurado
    if (!EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
      console.log('[WhatsApp] SOURCE_CHAT_ID não configurado');
      return { copRedeInforma: 0, erro: 'SOURCE_CHAT_ID não configurado' };
    }

    // Evolution API v2 - tentar diferentes endpoints
    let messages = [];

    // Função auxiliar para extrair mensagens do resultado
    const extractMessages = (result) => {
      if (Array.isArray(result)) return result;
      if (result.messages?.records) return result.messages.records; // Evolution API v2 format
      if (result.messages && Array.isArray(result.messages)) return result.messages;
      if (result.data?.records) return result.data.records;
      if (result.data && Array.isArray(result.data)) return result.data;
      if (result.records) return result.records;
      return [];
    };

    // Método 1: chat/findMessages
    try {
      console.log('[WhatsApp] Tentando endpoint chat/findMessages...');
      const result = await evolutionRequest(
        `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
        'POST',
        {
          number: EVOLUTION_CONFIG.SOURCE_CHAT_ID,
          limit: limite
        }
      );

      // Verificar se retornou mensagens ou status da instância
      if (result.instance) {
        console.log('[WhatsApp] Endpoint retornou status da instância, tentando outro formato...');
      } else {
        messages = extractMessages(result);
        console.log(`[WhatsApp] Extraídas ${messages.length} mensagens do resultado`);
      }
    } catch (e1) {
      console.log('[WhatsApp] chat/findMessages falhou:', e1.message);
    }

    // Método 2: message/findMessages
    if (messages.length === 0) {
      try {
        console.log('[WhatsApp] Tentando endpoint message/findMessages...');
        const result = await evolutionRequest(
          `/message/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
          'POST',
          {
            number: EVOLUTION_CONFIG.SOURCE_CHAT_ID,
            limit: limite
          }
        );
        if (!result.instance) {
          messages = extractMessages(result);
          console.log(`[WhatsApp] Extraídas ${messages.length} mensagens do resultado`);
        }
      } catch (e2) {
        console.log('[WhatsApp] message/findMessages falhou:', e2.message);
      }
    }

    // Método 3: chat/findMessages com remoteJid no body
    if (messages.length === 0) {
      try {
        console.log('[WhatsApp] Tentando com remoteJid...');
        const result = await evolutionRequest(
          `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
          'POST',
          {
            remoteJid: EVOLUTION_CONFIG.SOURCE_CHAT_ID,
            limit: limite
          }
        );
        if (!result.instance) {
          messages = extractMessages(result);
          console.log(`[WhatsApp] Extraídas ${messages.length} mensagens do resultado`);
        }
      } catch (e3) {
        console.log('[WhatsApp] remoteJid falhou:', e3.message);
      }
    }

    // Método 4: Listar todas mensagens e filtrar
    if (messages.length === 0) {
      try {
        console.log('[WhatsApp] Tentando listar todas mensagens...');
        const result = await evolutionRequest(
          `/chat/findMessages/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`,
          'POST',
          {
            limit: limite
          }
        );
        if (!result.instance) {
          const allMessages = extractMessages(result);
          // Filtrar pelo chat ID
          messages = allMessages.filter(m =>
            m.key?.remoteJid === EVOLUTION_CONFIG.SOURCE_CHAT_ID ||
            m.remoteJid === EVOLUTION_CONFIG.SOURCE_CHAT_ID
          );
          console.log(`[WhatsApp] Filtradas ${messages.length} de ${allMessages.length} mensagens`);
        }
      } catch (e4) {
        console.log('[WhatsApp] Listar todas falhou:', e4.message);
      }
    }

    console.log(`[WhatsApp] ${messages.length} mensagens encontradas`);

    if (messages.length === 0) {
      console.log('[WhatsApp] Nenhuma mensagem encontrada');
      return { copRedeInforma: 0, erro: 'Nenhuma mensagem encontrada' };
    }

    let contadores = { copRedeInforma: 0, ignorados: 0 };

    for (const msg of messages) {
      // Extrair texto - diferentes formatos
      const texto = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.text ||
                    msg.body ||
                    msg.text ||
                    msg.content ||
                    null;

      if (!texto) continue;

      const primeiraLinha = texto.split('\n')[0].substring(0, 50);
      console.log(`[WhatsApp] Processando: ${primeiraLinha}...`);

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
            console.log(`[WhatsApp] ✅ COP REDE INFORMA salvo`);
          } else if (resultado.tipo === 'NOVO_EVENTO') {
            contadores.ignorados++;
            console.log(`[WhatsApp] ⏭️ Alerta ignorado (histórico)`);
          }
        }
      } catch (msgError) {
        console.warn('[WhatsApp] Erro ao processar mensagem:', msgError.message);
      }
    }

    console.log('[WhatsApp] ====================================');
    console.log('[WhatsApp] ✅ HISTÓRICO PROCESSADO!');
    console.log(`[WhatsApp] - COP Rede Informa: ${contadores.copRedeInforma}`);
    console.log(`[WhatsApp] - Alertas ignorados: ${contadores.ignorados}`);
    console.log('[WhatsApp] ====================================');

    return { copRedeInforma: contadores.copRedeInforma };

  } catch (error) {
    console.error('[WhatsApp] ❌ Erro ao buscar histórico:', error.message);
    return { copRedeInforma: 0, erro: error.message };
  }
}

/**
 * Processa mensagem recebida via webhook
 */
async function processarWebhook(webhookData) {
  try {
    console.log('[WhatsApp] =====================================');
    console.log('[WhatsApp] MENSAGEM RECEBIDA VIA WEBHOOK');

    const data = webhookData.data || webhookData;
    const message = data.message || data;

    const texto = message?.conversation ||
                  message?.extendedTextMessage?.text ||
                  data?.body ||
                  null;

    if (!texto) {
      console.log('[WhatsApp] Ignorando - sem texto');
      return null;
    }

    const remetente = data.pushName || data.key?.participant || 'WhatsApp';
    console.log('[WhatsApp] De:', remetente);
    console.log('[WhatsApp] Texto:', texto.substring(0, 80));

    if (EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
      const chatId = data.key?.remoteJid;
      if (chatId !== EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
        console.log('[WhatsApp] Ignorando - chat diferente');
        return null;
      }
    }

    const msgCompativel = {
      message_id: data.key?.id || Date.now().toString(),
      date: Math.floor(Date.now() / 1000),
      text: texto,
      from: { username: remetente, is_bot: false },
      chat: { id: data.key?.remoteJid || 'whatsapp' }
    };

    const resultado = processarMensagem(msgCompativel);

    if (!resultado) {
      console.log('[WhatsApp] Não reconhecida:', texto.split('\n')[0]);
      return null;
    }

    console.log('[WhatsApp] Tipo:', resultado.tipo);

    if (resultado.tipo === 'COP_REDE_INFORMA') {
      await adicionarCopRedeInforma(resultado.dados);
      console.log('[WhatsApp] ✅ COP REDE INFORMA salvo!');
    } else if (resultado.tipo === 'NOVO_EVENTO') {
      await adicionarAlerta(resultado.dados);
      console.log('[WhatsApp] ✅ Alerta salvo!');
    }

    console.log('[WhatsApp] =====================================');
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
    console.log('[WhatsApp] Configurando webhook:', webhookUrl);

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
    console.error('[WhatsApp] Erro ao configurar webhook:', error.message);
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
    console.error('[WhatsApp] Erro ao listar chats:', error.message);
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
