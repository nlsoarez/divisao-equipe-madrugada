/**
 * UserBot - Usa conta pessoal do Telegram para monitorar mensagens de bots
 *
 * Este script usa a Telegram Client API (MTProto) ao invés da Bot API,
 * permitindo ler mensagens de outros bots no grupo.
 *
 * IMPORTANTE: Requer autenticação com número de telefone na primeira execução.
 */

const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');
const { USERBOT_CONFIG } = require('./config');
const { processarMensagem } = require('./parser');
const { adicionarCopRedeInforma, adicionarAlerta } = require('./storage');

let client = null;
let isRunning = false;

/**
 * Inicializa o UserBot com autenticação de usuário
 */
async function inicializarUserBot() {
  if (isRunning) {
    console.log('[UserBot] Já está rodando');
    return;
  }

  if (!USERBOT_CONFIG.API_ID || !USERBOT_CONFIG.API_HASH) {
    console.error('[UserBot] ❌ API_ID e API_HASH são obrigatórios!');
    console.log('[UserBot] Obtenha em: https://my.telegram.org/apps');
    console.log('[UserBot] Configure as variáveis de ambiente:');
    console.log('  TELEGRAM_API_ID=seu_api_id');
    console.log('  TELEGRAM_API_HASH=seu_api_hash');
    return;
  }

  console.log('[UserBot] ====================================');
  console.log('[UserBot] 👤 INICIANDO USERBOT');
  console.log('[UserBot] ====================================');

  try {
    const stringSession = new StringSession(USERBOT_CONFIG.SESSION);

    client = new TelegramClient(
      stringSession,
      USERBOT_CONFIG.API_ID,
      USERBOT_CONFIG.API_HASH,
      { connectionRetries: 5 }
    );

    // Se não tem session salva, precisa fazer login
    if (!USERBOT_CONFIG.SESSION) {
      console.log('[UserBot] Primeira execução - fazendo login...');
      await client.start({
        phoneNumber: async () => await input.text('Digite seu número de telefone: '),
        password: async () => await input.text('Digite sua senha 2FA (se tiver): '),
        phoneCode: async () => await input.text('Digite o código recebido no Telegram: '),
        onError: (err) => console.error('[UserBot] Erro:', err),
      });

      // Salvar session para próximas execuções
      const sessionString = client.session.save();
      console.log('[UserBot] ✅ Login realizado!');
      console.log('[UserBot] Salve esta SESSION nas variáveis de ambiente:');
      console.log(`TELEGRAM_SESSION=${sessionString}`);
    } else {
      await client.connect();
      console.log('[UserBot] ✅ Conectado com session existente');
    }

    // Verificar conexão
    const me = await client.getMe();
    console.log('[UserBot] Logado como:', me.username || me.firstName);

    // Configurar handler de mensagens
    client.addEventHandler(handleNewMessage, new NewMessage({
      chats: [parseInt(USERBOT_CONFIG.GROUP_ID)]
    }));

    isRunning = true;
    console.log('[UserBot] ====================================');
    console.log('[UserBot] ✅ MONITORANDO GRUPO!');
    console.log('[UserBot] Grupo ID:', USERBOT_CONFIG.GROUP_ID);
    console.log('[UserBot] ====================================');

  } catch (error) {
    console.error('[UserBot] ❌ Erro:', error.message);
    throw error;
  }
}

/**
 * Handler para novas mensagens
 */
async function handleNewMessage(event) {
  try {
    const message = event.message;
    const sender = await message.getSender();

    const isBot = sender?.bot === true;
    const username = sender?.username || 'desconhecido';

    console.log('[UserBot] =====================================');
    console.log('[UserBot] 📨 MENSAGEM RECEBIDA!');
    console.log('[UserBot] De:', username, isBot ? '(BOT)' : '(USER)');
    console.log('[UserBot] Chat ID:', message.chatId?.toString());

    if (!message.text) {
      console.log('[UserBot] Ignorando - sem texto');
      return;
    }

    console.log('[UserBot] Texto:', message.text.substring(0, 80));

    // Criar objeto compatível com o parser existente
    const msgCompativel = {
      message_id: message.id,
      date: message.date,
      text: message.text,
      from: {
        username: username,
        is_bot: isBot
      },
      chat: {
        id: message.chatId?.toString()
      }
    };

    const resultado = processarMensagem(msgCompativel);

    if (!resultado) {
      console.log('[UserBot] Não reconhecida:', message.text.split('\n')[0]);
      return;
    }

    console.log('[UserBot] ✅ Tipo:', resultado.tipo);

    if (resultado.tipo === 'COP_REDE_INFORMA') {
      await adicionarCopRedeInforma(resultado.dados);
      console.log('[UserBot] 💾 COP REDE INFORMA salvo!');
    } else if (resultado.tipo === 'NOVO_EVENTO') {
      await adicionarAlerta(resultado.dados);
      console.log('[UserBot] 💾 Alerta salvo!');
    }

    console.log('[UserBot] =====================================');

  } catch (error) {
    console.error('[UserBot] Erro ao processar:', error.message);
  }
}

/**
 * Para o UserBot
 */
async function pararUserBot() {
  if (client) {
    await client.disconnect();
    client = null;
  }
  isRunning = false;
  console.log('[UserBot] Desconectado');
}

/**
 * Verifica se está rodando
 */
function estaRodando() {
  return isRunning;
}

module.exports = {
  inicializarUserBot,
  pararUserBot,
  estaRodando
};

// Se executado diretamente
if (require.main === module) {
  inicializarUserBot().catch(console.error);
}
