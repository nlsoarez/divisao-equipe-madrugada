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

    // Buscar histórico de mensagens ao iniciar
    console.log('[UserBot] 🔄 Buscando histórico de mensagens...');
    await buscarHistoricoInicial();

  } catch (error) {
    console.error('[UserBot] ❌ Erro:', error.message);
    throw error;
  }
}

/**
 * Busca histórico de mensagens do grupo ao iniciar
 * IMPORTANTE: Busca apenas a ÚLTIMA mensagem "COP REDE INFORMA"
 * Alertas NÃO são carregados do histórico, apenas capturados em tempo real
 */
async function buscarHistoricoInicial() {
  try {
    const limite = 100; // Buscar últimas 100 mensagens
    console.log(`[UserBot] Buscando última mensagem COP REDE INFORMA...`);

    const messages = await client.getMessages(parseInt(USERBOT_CONFIG.GROUP_ID), {
      limit: limite
    });

    console.log(`[UserBot] ${messages.length} mensagens encontradas no histórico`);

    let copRedeEncontrada = null;

    // Buscar do mais recente para o mais antigo
    // Parar assim que encontrar a primeira "COP REDE INFORMA"
    for (const message of messages) {
      if (!message.text) continue;

      const sender = await message.getSender();
      const isBot = sender?.bot === true;
      const username = sender?.username || 'desconhecido';

      // Criar objeto compatível com o parser
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

      if (resultado && resultado.tipo === 'COP_REDE_INFORMA') {
        // Encontrou! Salvar e parar de buscar
        copRedeEncontrada = resultado.dados;
        await adicionarCopRedeInforma(resultado.dados);
        console.log('[UserBot] ✅ Última mensagem COP encontrada:', new Date(resultado.dados.dataMensagem).toLocaleString('pt-BR'));
        break; // Parar após encontrar a primeira (mais recente)
      }
      // IMPORTANTE: Ignorar alertas do histórico!
      // Alertas só serão capturados em tempo real via handleNewMessage
    }

    console.log('[UserBot] ====================================');
    if (copRedeEncontrada) {
      console.log('[UserBot] ✅ HISTÓRICO PROCESSADO!');
      console.log('[UserBot] - COP Rede Informa: 1 mensagem (mais recente)');
      console.log('[UserBot] - Alertas: 0 (apenas em tempo real)');
    } else {
      console.log('[UserBot] ⚠️  Nenhuma mensagem COP REDE INFORMA encontrada');
    }
    console.log('[UserBot] ====================================');

  } catch (error) {
    console.error('[UserBot] ❌ Erro ao buscar histórico:', error.message);
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

/**
 * Obtém status do UserBot
 */
function obterStatus() {
  return {
    conectado: isRunning,
    client: client !== null
  };
}

module.exports = {
  inicializarUserBot,
  pararUserBot,
  estaRodando,
  obterStatus
};

// Se executado diretamente
if (require.main === module) {
  inicializarUserBot().catch(console.error);
}
