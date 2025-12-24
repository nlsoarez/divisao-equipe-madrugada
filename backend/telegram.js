/**
 * Módulo de integração com Telegram Bot API
 * VERSÃO ULTRA SIMPLIFICADA - Uma única instância, sem conflitos
 */

const TelegramBot = require('node-telegram-bot-api');
const { TELEGRAM_CONFIG } = require('./config');
const { processarMensagem } = require('./parser');
const { adicionarCopRedeInforma, adicionarAlerta } = require('./storage');

let bot = null;
let isRunning = false;

let estatisticas = {
  mensagensRecebidas: 0,
  mensagensProcessadas: 0,
  erros: 0,
  iniciadoEm: null
};

/**
 * Inicializa o bot - ÚNICA função que cria instância
 */
async function inicializar(polling = true) {
  if (isRunning) {
    console.log('[Telegram] Bot já está rodando');
    return bot;
  }

  console.log('[Telegram] ====================================');
  console.log('[Telegram] 🤖 INICIALIZANDO BOT');
  console.log('[Telegram] ====================================');

  try {
    // Passo 1: Limpar webhook via API direta (sem criar instância)
    console.log('[Telegram] Limpando webhook...');
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}/deleteWebhook`);
    const result = await response.json();
    console.log('[Telegram] Webhook limpo:', result.ok);

    // Aguardar um pouco
    await new Promise(r => setTimeout(r, 1000));

    // Passo 2: Criar bot COM polling
    console.log('[Telegram] Criando bot com polling...');
    console.log('[Telegram] Token (últimos 10):', TELEGRAM_CONFIG.BOT_TOKEN.slice(-10));
    console.log('[Telegram] Group ID:', TELEGRAM_CONFIG.GROUP_ID);

    bot = new TelegramBot(TELEGRAM_CONFIG.BOT_TOKEN, {
      polling: polling ? {
        interval: 3000,
        autoStart: true,
        params: {
          timeout: 30,
          // Aceitar TODOS os tipos de updates para debug
          allowed_updates: ['message', 'channel_post', 'edited_message', 'edited_channel_post']
        }
      } : false
    });

    // Verificar conexão
    const me = await bot.getMe();
    console.log('[Telegram] ✅ Conectado:', me.username);
    console.log('[Telegram] Bot ID:', me.id);
    console.log('[Telegram] can_read_all_group_messages:', me.can_read_all_group_messages);

    // Configurar handlers
    configurarHandlers();

    isRunning = true;
    estatisticas.iniciadoEm = new Date().toISOString();

    console.log('[Telegram] ====================================');
    console.log('[Telegram] ✅ BOT ATIVO! Aguardando mensagens...');
    console.log('[Telegram] ====================================');

    return bot;

  } catch (error) {
    console.error('[Telegram] ❌ Erro:', error.message);
    throw error;
  }
}

/**
 * Handlers de mensagens
 */
function configurarHandlers() {
  console.log('[Telegram] Configurando handlers de mensagens...');

  bot.on('message', async (msg) => {
    estatisticas.mensagensRecebidas++;

    try {
      const remetente = msg.from || {};
      const isBot = remetente.is_bot === true;
      const username = remetente.username || 'desconhecido';

      console.log('[Telegram] =====================================');
      console.log('[Telegram] 📨 MENSAGEM RECEBIDA!');
      console.log('[Telegram] De:', username, isBot ? '(BOT)' : '(USER)');
      console.log('[Telegram] Chat ID:', msg.chat.id);
      console.log('[Telegram] Message ID:', msg.message_id);

      // Verificar grupo
      const chatId = String(msg.chat.id);
      const groupId = TELEGRAM_CONFIG.GROUP_ID;

      if (chatId !== groupId &&
          chatId !== groupId.replace('-100', '-') &&
          `-100${chatId.replace('-', '')}` !== groupId) {
        console.log('[Telegram] Ignorando - outro chat');
        return;
      }

      if (!msg.text) {
        console.log('[Telegram] Ignorando - sem texto');
        return;
      }

      console.log('[Telegram] Texto:', msg.text.substring(0, 80));

      const resultado = processarMensagem(msg);

      if (!resultado) {
        console.log('[Telegram] Não reconhecida:', msg.text.split('\n')[0]);
        return;
      }

      console.log('[Telegram] ✅ Tipo:', resultado.tipo);

      if (resultado.tipo === 'COP_REDE_INFORMA') {
        await adicionarCopRedeInforma(resultado.dados);
        estatisticas.mensagensProcessadas++;
        console.log('[Telegram] 💾 Salvo!');
      } else if (resultado.tipo === 'NOVO_EVENTO') {
        await adicionarAlerta(resultado.dados);
        estatisticas.mensagensProcessadas++;
        console.log('[Telegram] 💾 Salvo!');
      }

    } catch (error) {
      estatisticas.erros++;
      console.error('[Telegram] Erro:', error.message);
    }
  });

  // Handler para mensagens de CANAL (channel_post)
  bot.on('channel_post', async (msg) => {
    console.log('[Telegram] =====================================');
    console.log('[Telegram] 📢 CHANNEL_POST RECEBIDO!');
    console.log('[Telegram] Chat:', msg.chat.title || msg.chat.id);
    console.log('[Telegram] Texto:', msg.text?.substring(0, 80) || '(sem texto)');
    console.log('[Telegram] =====================================');

    // Processar como mensagem normal
    if (msg.text) {
      const resultado = processarMensagem(msg);
      if (resultado) {
        console.log('[Telegram] ✅ Tipo:', resultado.tipo);
        if (resultado.tipo === 'COP_REDE_INFORMA') {
          await adicionarCopRedeInforma(resultado.dados);
          console.log('[Telegram] 💾 Salvo de channel_post!');
        } else if (resultado.tipo === 'NOVO_EVENTO') {
          await adicionarAlerta(resultado.dados);
          console.log('[Telegram] 💾 Salvo de channel_post!');
        }
      }
    }
  });

  bot.on('polling_error', (error) => {
    // Ignorar erros 409 - são esperados durante startup
    if (!error.message.includes('409')) {
      estatisticas.erros++;
      console.error('[Telegram] Erro polling:', error.message);
    }
  });
}

/**
 * Para o bot
 */
async function parar() {
  if (bot) {
    await bot.stopPolling();
    bot = null;
  }
  isRunning = false;
  console.log('[Telegram] Bot parado');
}

/**
 * Estatísticas
 */
function obterEstatisticas() {
  return { ...estatisticas, isRunning };
}

/**
 * Testa conexão
 */
async function testarConexao() {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}/getMe`);
    const data = await response.json();
    if (data.ok) {
      return { sucesso: true, bot: data.result };
    }
    return { sucesso: false, erro: 'Falha na conexão' };
  } catch (error) {
    return { sucesso: false, erro: error.message };
  }
}

/**
 * Diagnóstico
 */
async function diagnosticar() {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}/getMe`);
    const data = await response.json();

    if (!data.ok) {
      return { sucesso: false, erro: 'Falha na conexão' };
    }

    const me = data.result;

    // Verificar admin
    let isAdmin = false;
    try {
      const memberResponse = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}/getChatMember?chat_id=${TELEGRAM_CONFIG.GROUP_ID}&user_id=${me.id}`
      );
      const memberData = await memberResponse.json();
      if (memberData.ok) {
        isAdmin = ['administrator', 'creator'].includes(memberData.result.status);
      }
    } catch (e) {}

    return {
      sucesso: true,
      bot: {
        id: me.id,
        username: me.username,
        first_name: me.first_name,
        can_read_all_group_messages: me.can_read_all_group_messages
      },
      grupo: {
        id: TELEGRAM_CONFIG.GROUP_ID,
        botIsAdmin: isAdmin
      },
      recomendacoes: []
    };
  } catch (error) {
    return { sucesso: false, erro: error.message };
  }
}

/**
 * Busca mensagens recentes usando getUpdates
 * Isso busca atualizações pendentes que o bot não recebeu enquanto estava offline
 */
async function buscarMensagensRecentes(limite = 100) {
  console.log('[Telegram] Buscando mensagens recentes...');

  try {
    // Usar getUpdates para buscar atualizações pendentes
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}/getUpdates?limit=${limite}&timeout=5`
    );
    const data = await response.json();

    if (!data.ok) {
      console.log('[Telegram] Erro ao buscar updates:', data.description);
      return [];
    }

    const updates = data.result || [];
    console.log(`[Telegram] ${updates.length} updates recebidos`);

    const mensagensProcessadas = [];

    for (const update of updates) {
      const msg = update.message || update.channel_post;
      if (!msg || !msg.text) continue;

      // Verificar se é do grupo configurado
      const chatId = String(msg.chat.id);
      const groupId = TELEGRAM_CONFIG.GROUP_ID;

      if (chatId !== groupId &&
          chatId !== groupId.replace('-100', '-') &&
          `-100${chatId.replace('-', '')}` !== groupId) {
        continue;
      }

      console.log('[Telegram] Processando msg:', msg.text.substring(0, 50));

      const resultado = processarMensagem(msg);

      if (resultado) {
        console.log('[Telegram] ✅ Tipo:', resultado.tipo);

        if (resultado.tipo === 'COP_REDE_INFORMA') {
          await adicionarCopRedeInforma(resultado.dados);
          mensagensProcessadas.push(resultado.dados);
          console.log('[Telegram] 💾 COP salvo via sync!');
        } else if (resultado.tipo === 'NOVO_EVENTO') {
          await adicionarAlerta(resultado.dados);
          mensagensProcessadas.push(resultado.dados);
          console.log('[Telegram] 💾 Alerta salvo via sync!');
        }
      }
    }

    // Marcar updates como lidos (offset = último ID + 1)
    if (updates.length > 0) {
      const lastUpdateId = updates[updates.length - 1].update_id;
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&limit=1`
      );
      console.log('[Telegram] Updates marcados como lidos');
    }

    console.log(`[Telegram] ${mensagensProcessadas.length} mensagens processadas via sync`);
    return mensagensProcessadas;

  } catch (error) {
    console.error('[Telegram] Erro ao buscar mensagens:', error.message);
    return [];
  }
}

/**
 * Envia mensagem de teste
 */
async function enviarMensagemTeste(texto = '🤖 Bot ativo!') {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_CONFIG.BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CONFIG.GROUP_ID,
          text: texto
        })
      }
    );
    const data = await response.json();
    return { sucesso: data.ok, messageId: data.result?.message_id };
  } catch (error) {
    return { sucesso: false, erro: error.message };
  }
}

module.exports = {
  inicializar,
  parar,
  buscarMensagensRecentes,
  obterEstatisticas,
  testarConexao,
  diagnosticar,
  enviarMensagemTeste
};
