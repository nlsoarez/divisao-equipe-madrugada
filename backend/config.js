/**
 * Configurações do sistema COP REDE INFORMA
 * Centralize aqui todas as constantes e mapeamentos
 */

require('dotenv').config();

// Configurações da Evolution API (WhatsApp)
const EVOLUTION_CONFIG = {
  API_URL: process.env.EVOLUTION_API_URL || 'https://evolution-api-production-b976.up.railway.app',
  API_KEY: process.env.EVOLUTION_API_KEY || 'B1E0A9BC4BFF-4586-B06F-42011477C6B5',
  INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME || 'Cop Rede',
  // Número do grupo ou contato de onde vêm as mensagens (formato: 5511999999999@g.us para grupos)
  SOURCE_CHAT_ID: process.env.EVOLUTION_SOURCE_CHAT_ID || null
};

// Configurações do Telegram Bot API (legado - mantido para compatibilidade)
const TELEGRAM_CONFIG = {
  BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8450919829:AAFbu6mgwWSj_SCSryS0e-6FHRGQvkHrVRM',
  GROUP_ID: process.env.TELEGRAM_GROUP_ID || '-1003217044000', // Grupos têm ID negativo
  POLLING_INTERVAL: parseInt(process.env.POLLING_INTERVAL) || 5000
};

// Configurações do UserBot (Client API / MTProto)
// Necessário para ler mensagens de outros bots
const USERBOT_CONFIG = {
  API_ID: parseInt(process.env.TELEGRAM_API_ID) || 35737560,
  API_HASH: process.env.TELEGRAM_API_HASH || 'dedafbc981acacf5a555e8f3af0fae1f',
  SESSION: process.env.TELEGRAM_SESSION || '1AQAOMTQ5LjE1NC4xNzUuNTcBu6gnnXJViPsTwVL92OrGDeLtjjajgOvBbyeeKMrECc+Djy6ZuRG4jPKbPjG8OhTSL0ATN7CeihMUHpAkK2hjxeMJ7SHqsoxtYcjrshb7IyxqDzX+q4ZAw+0w7uAq6FfnkQTYV5xNBKuq3pGslxvixb9L1sOIHfgYuM49MPGEsCCOvBPl7HM2DxjE9/wKZRTI2nQWYk+y2O23r4hXbJVO+V4UEzUW3ttbkowyZNpg3Zg6vhxxtTPy2dASD7L8lXci3Ei/mtcH8ZwM6TFPXKqDLu9H3Ncj8wNOL6GT8Zp+aIMzcHdEIrQkw1752Hl7nSNKjJSvUZBppTDYYXDbtIosq88=',
  GROUP_ID: TELEGRAM_CONFIG.GROUP_ID
};

// Configurações do JSONBin.io (mesmas do projeto principal)
const JSONBIN_CONFIG = {
  API_URL: 'https://api.jsonbin.io/v3/b',
  MASTER_KEY: process.env.JSONBIN_MASTER_KEY || '$2a$10$dQyAV006kSDh2CvPh8cBCu2yspqnkCb4Dpm.A7wby6q.tZAKQHNce',
  ACCESS_KEY: process.env.JSONBIN_ACCESS_KEY || '$2a$10$oo.QiJ4MvOeVCqfzC19p7OcJgzUVEU7eWINJO1EZefPScNpfBIRKC',
  // Bin específico para mensagens do Telegram (SEPARADO do bin da escala!)
  // Este bin armazena apenas: COP REDE INFORMA e Alertas
  // O bin da escala (693a8a43ae596e708f923822) armazena os calendários de trabalho
  // Se null, um novo bin será criado automaticamente com as chaves atuais
  TELEGRAM_BIN_ID: process.env.TELEGRAM_BIN_ID || null
};

// Títulos de mensagens que serão processadas
const MESSAGE_TITLES = {
  COP_REDE_INFORMA: 'COP REDE INFORMA',
  NOVO_EVENTO: '🚨 Novo Evento Detectado!',
  NOVO_EVENTO_ALT: 'Novo Evento Detectado'
};

// Mapeamento de GRUPO do Telegram para Área do Painel
// Chaves normalizadas (lowercase, sem acentos)
// ÁREAS: CO/NO/NE, MG/ES/BA, RIO
const GRUPO_PARA_AREA = {
  // RIO - Rio de Janeiro (inclui cluster "Rio / Espírito Santo")
  'rio capital': 'RIO',
  'grande rio': 'RIO',
  'rio / espirito santo': 'RIO',
  'rio/espirito santo': 'RIO',
  'rio / espírito santo': 'RIO',
  'rio/espírito santo': 'RIO',
  'rio de janeiro / espirito santo': 'RIO',
  'rio de janeiro/espirito santo': 'RIO',
  'rio de janeiro': 'RIO',
  'rio': 'RIO',
  'rj': 'RIO',

  // MG/ES/BA - Minas Gerais, Espírito Santo, Bahia/Sergipe
  'vitoria': 'MG/ES/BA',
  'vitória': 'MG/ES/BA',
  'minas gerais': 'MG/ES/BA',
  'minas': 'MG/ES/BA',
  'mg': 'MG/ES/BA',
  'espirito santo': 'MG/ES/BA',
  'espírito santo': 'MG/ES/BA',
  'es': 'MG/ES/BA',
  'bahia / sergipe': 'MG/ES/BA',
  'bahia/sergipe': 'MG/ES/BA',
  'bahia': 'MG/ES/BA',
  'sergipe': 'MG/ES/BA',
  'ba': 'MG/ES/BA',
  'se': 'MG/ES/BA',

  // CO/NO/NE - Centro-Oeste, Norte, Nordeste
  'centro oeste': 'CO/NO/NE',
  'centro-oeste': 'CO/NO/NE',
  'centrooeste': 'CO/NO/NE',
  'co': 'CO/NO/NE',
  'norte': 'CO/NO/NE',
  'no': 'CO/NO/NE',
  'nordeste': 'CO/NO/NE',
  'ne': 'CO/NO/NE',
  'goias': 'CO/NO/NE',
  'go': 'CO/NO/NE',
  'mato grosso': 'CO/NO/NE',
  'mt': 'CO/NO/NE',
  'mato grosso do sul': 'CO/NO/NE',
  'ms': 'CO/NO/NE',
  'distrito federal': 'CO/NO/NE',
  'df': 'CO/NO/NE',
  'tocantins': 'CO/NO/NE',
  'to': 'CO/NO/NE',
  'amazonas': 'CO/NO/NE',
  'am': 'CO/NO/NE',
  'para': 'CO/NO/NE',
  'pa': 'CO/NO/NE',
  'acre': 'CO/NO/NE',
  'ac': 'CO/NO/NE',
  'rondonia': 'CO/NO/NE',
  'ro': 'CO/NO/NE',
  'roraima': 'CO/NO/NE',
  'rr': 'CO/NO/NE',
  'amapa': 'CO/NO/NE',
  'ap': 'CO/NO/NE',
  'pernambuco': 'CO/NO/NE',
  'pe': 'CO/NO/NE',
  'alagoas': 'CO/NO/NE',
  'al': 'CO/NO/NE',
  'paraiba': 'CO/NO/NE',
  'pb': 'CO/NO/NE',
  'rio grande do norte': 'CO/NO/NE',
  'rn': 'CO/NO/NE',
  'ceara': 'CO/NO/NE',
  'ce': 'CO/NO/NE',
  'piaui': 'CO/NO/NE',
  'pi': 'CO/NO/NE',
  'maranhao': 'CO/NO/NE',
  'ma': 'CO/NO/NE'
};

// Campos esperados nas mensagens
const CAMPOS_MENSAGEM = {
  COP_REDE_INFORMA: ['TIPO', 'GRUPO', 'DIA', 'RESPONSAVEL', 'VOLUME'],
  NOVO_EVENTO: ['GRUPO', 'DIA', 'RESPONSAVEL', 'DETALHES', 'VOLUME']
};

// Status possíveis para alertas
const STATUS_ALERTA = {
  NOVO: 'novo',
  EM_ANALISE: 'em_analise',
  TRATADO: 'tratado'
};

// Status de processamento
const STATUS_PROCESSAMENTO = {
  SUCESSO: 'sucesso',
  GRUPO_DESCONHECIDO: 'grupo_desconhecido',
  ERRO_PARSING: 'erro_parsing'
};

// Configurações do servidor
const SERVER_CONFIG = {
  PORT: process.env.PORT || 3001,
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};

module.exports = {
  EVOLUTION_CONFIG,
  TELEGRAM_CONFIG,
  USERBOT_CONFIG,
  JSONBIN_CONFIG,
  MESSAGE_TITLES,
  GRUPO_PARA_AREA,
  CAMPOS_MENSAGEM,
  STATUS_ALERTA,
  STATUS_PROCESSAMENTO,
  SERVER_CONFIG
};
