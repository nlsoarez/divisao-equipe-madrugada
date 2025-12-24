/**
 * Configurações do sistema COP REDE INFORMA
 * Centralize aqui todas as constantes e mapeamentos
 */

require('dotenv').config();

// Configurações do Telegram Bot API
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
  // Bin específico para mensagens do Telegram (será criado automaticamente se não existir)
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
// IMPORTANTE: Inclui todas as variações possíveis dos clusters
const GRUPO_PARA_AREA = {
  // RIO - Cluster Rio de Janeiro / Espírito Santo
  'rio / espirito santo': 'RIO',
  'rio/espirito santo': 'RIO',
  'rio / espírito santo': 'RIO',
  'rio/espírito santo': 'RIO',
  'rio de janeiro / espirito santo': 'RIO',
  'rio de janeiro/espirito santo': 'RIO',
  'rio de janeiro': 'RIO',
  'espirito santo': 'RIO',
  'espírito santo': 'RIO',
  'rio': 'RIO',
  'rj': 'RIO',
  'es': 'RIO',

  // NE/BA - Cluster Bahia / Sergipe / Nordeste
  'bahia / sergipe': 'NE/BA',
  'bahia/sergipe': 'NE/BA',
  'bahia': 'NE/BA',
  'sergipe': 'NE/BA',
  'nordeste': 'NE/BA',
  'ne': 'NE/BA',
  'ba': 'NE/BA',
  'se': 'NE/BA',
  'pernambuco': 'NE/BA',
  'pe': 'NE/BA',
  'alagoas': 'NE/BA',
  'al': 'NE/BA',
  'paraiba': 'NE/BA',
  'pb': 'NE/BA',
  'rio grande do norte': 'NE/BA',
  'rn': 'NE/BA',
  'ceara': 'NE/BA',
  'ce': 'NE/BA',
  'piaui': 'NE/BA',
  'pi': 'NE/BA',
  'maranhao': 'NE/BA',
  'ma': 'NE/BA',

  // CO/NO - Cluster Centro-Oeste / Norte
  'centro oeste': 'CO/NO',
  'centro-oeste': 'CO/NO',
  'centrooeste': 'CO/NO',
  'norte': 'CO/NO',
  'co': 'CO/NO',
  'no': 'CO/NO',
  'goias': 'CO/NO',
  'go': 'CO/NO',
  'mato grosso': 'CO/NO',
  'mt': 'CO/NO',
  'mato grosso do sul': 'CO/NO',
  'ms': 'CO/NO',
  'distrito federal': 'CO/NO',
  'df': 'CO/NO',
  'tocantins': 'CO/NO',
  'to': 'CO/NO',
  'amazonas': 'CO/NO',
  'am': 'CO/NO',
  'para': 'CO/NO',
  'pa': 'CO/NO',
  'acre': 'CO/NO',
  'ac': 'CO/NO',
  'rondonia': 'CO/NO',
  'ro': 'CO/NO',
  'roraima': 'CO/NO',
  'rr': 'CO/NO',
  'amapa': 'CO/NO',
  'ap': 'CO/NO',

  // MG - Cluster Minas Gerais
  'minas gerais': 'MG',
  'minas': 'MG',
  'mg': 'MG'
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
