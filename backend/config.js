/**
 * Configurações do sistema COP REDE INFORMA
 * Centralize aqui todas as constantes e mapeamentos
 */

require('dotenv').config();

// Configurações da Evolution API (WhatsApp) - ÚNICA FONTE DE DADOS
const EVOLUTION_CONFIG = {
  API_URL: process.env.EVOLUTION_API_URL || 'https://evolution-api-production-b976.up.railway.app',
  API_KEY: process.env.EVOLUTION_API_KEY,
  INSTANCE_NAME: process.env.EVOLUTION_INSTANCE_NAME || 'Cop Rede',
  // Número do grupo ou contato de onde vêm as mensagens (formato: 5511999999999@g.us para grupos)
  SOURCE_CHAT_ID: process.env.EVOLUTION_SOURCE_CHAT_ID || null
};

// Configurações do grupo COP REDE EMPRESARIAL (Rio/ES e Leste)
// Grupo separado do COP REDE INFORMA residencial
const COP_REDE_EMPRESARIAL_CONFIG = {
  CHAT_ID: process.env.COP_REDE_EMPRESARIAL_CHAT_ID || '120363423786613991@g.us'
};

// Configurações do grupo Alocação de HUB
// IMPORTANTE: As credenciais do HUB são separadas das credenciais principais
// para evitar problemas de limite de requisições
const ALOCACAO_HUB_CONFIG = {
  // Chat ID do grupo de Alocação de HUB
  CHAT_ID: process.env.ALOCACAO_HUB_CHAT_ID || '120363420668199320@g.us',
  // Bin separado para dados de Alocação de HUB
  // Se não configurado, será criado automaticamente na inicialização
  // Para configurar manualmente, defina a variável ALOCACAO_HUB_BIN_ID
  BIN_ID: process.env.ALOCACAO_HUB_BIN_ID || null,
  // Credenciais exclusivas para o HUB (conta separada do JSONBin)
  MASTER_KEY: process.env.ALOCACAO_HUB_MASTER_KEY,
  ACCESS_KEY: process.env.ALOCACAO_HUB_ACCESS_KEY
};

// Configurações do JSONBin.io (mesmas do projeto principal)
const JSONBIN_CONFIG = {
  API_URL: 'https://api.jsonbin.io/v3/b',
  MASTER_KEY: process.env.JSONBIN_MASTER_KEY,
  ACCESS_KEY: process.env.JSONBIN_ACCESS_KEY,
  // Bin específico para mensagens do WhatsApp (SEPARADO do bin da escala!)
  // Este bin armazena apenas: COP REDE INFORMA e Alertas
  // O bin da escala (697531c843b1c97be9474ae9) armazena os calendários de trabalho
  // IMPORTANTE: Este ID deve ser mantido fixo para persistir os dados entre restarts
  WHATSAPP_BIN_ID: process.env.WHATSAPP_BIN_ID || process.env.TELEGRAM_BIN_ID || '697778b3ae596e708ff7760f'
};

// Títulos de mensagens que serão processadas
const MESSAGE_TITLES = {
  COP_REDE_INFORMA: 'COP REDE INFORMA',
  NOVO_EVENTO: '🚨 Novo Evento Detectado!',
  NOVO_EVENTO_ALT: 'Novo Evento Detectado',
  // Alocação de HUB
  ALOCACAO_DIURNO: 'ALOCAÇÃO TÉCNICA HUBS/RJO DIURNO',
  ALOCACAO_MADRUGADA: 'ALOCAÇÃO TÉCNICA HUBS/RJO MADRUGADA'
};

// Mapeamento de Cluster/Região para Área do Painel
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
  'bh capital': 'MG/ES/BA',
  'bh': 'MG/ES/BA',
  'belo horizonte': 'MG/ES/BA',
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

// Avisar sobre variáveis de ambiente críticas ausentes
[
  'JSONBIN_MASTER_KEY',
  'JSONBIN_ACCESS_KEY',
  'EVOLUTION_API_KEY',
  'ALOCACAO_HUB_MASTER_KEY',
  'ALOCACAO_HUB_ACCESS_KEY',
  'SUPABASE_ANON_KEY',
  'ADMIN_DIAG_TOKEN'
].forEach(k => {
  if (!process.env[k]) {
    console.warn(`[Config] ⚠️  Variável de ambiente ausente: ${k}`);
  }
});

module.exports = {
  EVOLUTION_CONFIG,
  COP_REDE_EMPRESARIAL_CONFIG,
  ALOCACAO_HUB_CONFIG,
  JSONBIN_CONFIG,
  MESSAGE_TITLES,
  GRUPO_PARA_AREA,
  CAMPOS_MENSAGEM,
  STATUS_ALERTA,
  STATUS_PROCESSAMENTO,
  SERVER_CONFIG
};
