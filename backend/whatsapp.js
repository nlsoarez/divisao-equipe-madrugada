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

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Evolution API error: ${response.status} - ${errorText}`);
  }

  return response.json();
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
    isConnected = result.instance?.state === 'open';

    console.log('[WhatsApp] Status:', result.instance?.state || 'desconhecido');

    return {
      conectado: isConnected,
      estado: result.instance?.state,
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
 * Alertas (Novo Evento Detectado) são capturados APENAS em tempo real via webhook
 * @param {number} limite - Número de mensagens para buscar
 * @returns {Promise<{copRedeInforma: number}>}
 */
async function buscarHistorico(limite = 100) {
  try {
    console.log('[WhatsApp] ====================================');
    console.log(`[WhatsApp] BUSCANDO HISTÓRICO COP REDE INFORMA (${limite} mensagens)...`);
    console.log('[WhatsApp] Alertas NÃO são carregados do histórico (apenas webhook)');
    console.log('[WhatsApp] ====================================');

    // Verificar conexão primeiro
    const status = await verificarConexao();
    if (!status.conectado) {
      console.log('[WhatsApp] Não conectado - não é possível buscar histórico');
      return { copRedeInforma: 0, erro: 'WhatsApp não conectado' };
    }

    // Se não tem SOURCE_CHAT_ID configurado, tentar buscar chats
    if (!EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
      console.log('[WhatsApp] SOURCE_CHAT_ID não configurado');
      console.log('[WhatsApp] Configure a variável EVOLUTION_SOURCE_CHAT_ID com o ID do grupo/contato');

      // Listar chats para ajudar a identificar
      try {
        const chats = await evolutionRequest(
          `/chat/findChats/${encodeURIComponent(EVOLUTION_CONFIG.INSTANCE_NAME)}`
        );
        console.log('[WhatsApp] Chats disponíveis:');
        if (Array.isArray(chats)) {
          chats.slice(0, 10).forEach(chat => {
            console.log(`  - ${chat.id}: ${chat.name || chat.pushName || 'Sem nome'}`);
          });
        }
      } catch (e) {
        console.log('[WhatsApp] Não foi possível listar chats:', e.message);
      }

      return { copRedeInforma: 0, erro: 'SOURCE_CHAT_ID não configurado' };
    }

    // Buscar mensagens do chat específico
    const messages = await evolutionRequest(
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

    const messageList = Array.isArray(messages) ? messages : (messages.messages || []);
    console.log(`[WhatsApp] ${messageList.length} mensagens encontradas`);

    let contadores = { copRedeInforma: 0, ignorados: 0 };

    for (const msg of messageList) {
      // Extrair texto da mensagem
      const texto = msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.text ||
                    null;

      if (!texto) continue;

      const primeiraLinha = texto.split('\n')[0].substring(0, 50);

      try {
        // Criar objeto compatível com o parser
        const msgCompativel = {
          message_id: msg.key?.id || msg.id,
          date: Math.floor(new Date(msg.messageTimestamp * 1000 || msg.timestamp).getTime() / 1000),
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
            console.log(`[WhatsApp] COP REDE INFORMA salvo`);
          } else if (resultado.tipo === 'NOVO_EVENTO') {
            // IGNORAR alertas do histórico - apenas em tempo real via webhook
            contadores.ignorados++;
            console.log(`[WhatsApp] Alerta ignorado (histórico): ${primeiraLinha}`);
          }
        }
      } catch (msgError) {
        console.warn('[WhatsApp] Erro ao processar mensagem:', msgError.message);
      }
    }

    console.log('[WhatsApp] ====================================');
    console.log('[WhatsApp] HISTÓRICO PROCESSADO!');
    console.log(`[WhatsApp] - COP Rede Informa: ${contadores.copRedeInforma}`);
    console.log(`[WhatsApp] - Alertas ignorados: ${contadores.ignorados}`);
    console.log('[WhatsApp] ====================================');

    return { copRedeInforma: contadores.copRedeInforma };

  } catch (error) {
    console.error('[WhatsApp] Erro ao buscar histórico:', error.message);
    return { copRedeInforma: 0, erro: error.message };
  }
}

/**
 * Processa mensagem recebida via webhook
 * Esta função é chamada quando a Evolution API envia uma mensagem via webhook
 * @param {object} webhookData - Dados do webhook da Evolution API
 */
async function processarWebhook(webhookData) {
  try {
    console.log('[WhatsApp] =====================================');
    console.log('[WhatsApp] MENSAGEM RECEBIDA VIA WEBHOOK');

    // Extrair dados da mensagem (formato Evolution API v2)
    const data = webhookData.data || webhookData;
    const message = data.message || data;

    // Extrair texto
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

    // Verificar se é do chat correto (se configurado)
    if (EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
      const chatId = data.key?.remoteJid;
      if (chatId !== EVOLUTION_CONFIG.SOURCE_CHAT_ID) {
        console.log('[WhatsApp] Ignorando - chat diferente do configurado');
        return null;
      }
    }

    // Criar objeto compatível com o parser
    const msgCompativel = {
      message_id: data.key?.id || Date.now().toString(),
      date: Math.floor(Date.now() / 1000),
      text: texto,
      from: {
        username: remetente,
        is_bot: false
      },
      chat: {
        id: data.key?.remoteJid || 'whatsapp'
      }
    };

    const resultado = processarMensagem(msgCompativel);

    if (!resultado) {
      console.log('[WhatsApp] Não reconhecida:', texto.split('\n')[0]);
      return null;
    }

    console.log('[WhatsApp] Tipo:', resultado.tipo);

    // Salvar no storage
    if (resultado.tipo === 'COP_REDE_INFORMA') {
      await adicionarCopRedeInforma(resultado.dados);
      console.log('[WhatsApp] COP REDE INFORMA salvo!');
    } else if (resultado.tipo === 'NOVO_EVENTO') {
      await adicionarAlerta(resultado.dados);
      console.log('[WhatsApp] Alerta salvo!');
    }

    console.log('[WhatsApp] =====================================');
    return resultado;

  } catch (error) {
    console.error('[WhatsApp] Erro ao processar webhook:', error.message);
    return null;
  }
}

/**
 * Configura o webhook na Evolution API para receber mensagens
 * @param {string} webhookUrl - URL do seu servidor para receber webhooks
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
        events: [
          'MESSAGES_UPSERT'  // Evento de nova mensagem
        ]
      }
    );

    console.log('[WhatsApp] Webhook configurado:', result);
    return result;

  } catch (error) {
    console.error('[WhatsApp] Erro ao configurar webhook:', error.message);
    throw error;
  }
}

/**
 * Lista grupos/chats disponíveis
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
 * Obtém status da conexão
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
