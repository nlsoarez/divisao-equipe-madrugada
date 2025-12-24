/**
 * CONFIGURAÇÕES DO SISTEMA - ESCALA EQUIPE MADRUGADA
 *
 * Este arquivo contém as configurações principais do sistema.
 * Para atualizar o BIN_ID, edite apenas este arquivo e faça commit.
 */

const CONFIG = {
  // ============================================
  // JSONBIN.IO - ARMAZENAMENTO NA NUVEM
  // ============================================

  /**
   * BIN_ID - Identificador do bin onde os dados são armazenados
   *
   * INSTRUÇÕES:
   * 1. Se este valor for null, o admin criará um novo bin automaticamente
   * 2. Após criar, o sistema exibirá o novo ID
   * 3. Atualize este valor e faça commit para que todos acessem
   *
   * Exemplo: BIN_ID: "67acf6e1ad19ca34f89c1234"
   */
  BIN_ID: "693a8a43ae596e708f923822",

  /**
   * Credenciais JSONBin.io
   * ATENÇÃO: Estas chaves são públicas no código. Use apenas para dados não-sensíveis.
   */
  JSONBIN: {
    API_URL: 'https://api.jsonbin.io/v3/b',
    MASTER_KEY: '$2a$10$dQyAV006kSDh2CvPh8cBCu2yspqnkCb4Dpm.A7wby6q.tZAKQHNce',
    ACCESS_KEY: '$2a$10$oo.QiJ4MvOeVCqfzC19p7OcJgzUVEU7eWINJO1EZefPScNpfBIRKC'
  },

  // ============================================
  // AUTENTICAÇÃO
  // ============================================

  /**
   * PIN de administrador
   * Usado para acessar funcionalidades de upload e gerenciamento
   */
  ADMIN_PIN: 'home.2025',

  /**
   * Duração da sessão em horas
   */
  SESSION_DURATION_HOURS: 24,

  // ============================================
  // NOMES DOS FUNCIONÁRIOS (para normalização)
  // ============================================

  FUNCIONARIOS: {
    'CRISTIANE': 'CRISTIANE HERMOGENES DA SILVA',
    'MARISTELLA': 'MARISTELLA MARCIA DOS SANTOS',
    'MARISTELA': 'MARISTELLA MARCIA DOS SANTOS',
    'LEONARDO': 'LEONARDO FERREIRA LIMA DE ALMEIDA',
    'RAISSA': 'RAISSA LIMA DE OLIVEIRA',
    'RAÍSSA': 'RAISSA LIMA DE OLIVEIRA',
    'THIAGO': 'THIAGO PEREIRA DA SILVA',
    'ALAN': 'ALAN MARINHO DIAS'
  },

  // ============================================
  // REGRAS DE PRIORIDADE POR NÚMERO DE PESSOAS
  // ============================================
  //
  // Estrutura:
  // - Cada número de pessoas tem suas áreas
  // - Cada área tem uma lista de prioridade de funcionários
  // - RIO_DUPLO indica que o RIO deve ter 2 pessoas (usa RIO e _RIO_2)
  //
  PRIORIDADES: {
    2: {
      RIO_DUPLO: false,
      areas: {
        'CO/NO': ['CRISTIANE', 'MARISTELLA', 'LEONARDO', 'RAISSA', 'THIAGO', 'ALAN'],
        'RIO': ['ALAN', 'THIAGO', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'CRISTIANE']
      }
    },
    3: {
      RIO_DUPLO: false,
      areas: {
        'CO/NO/NE': ['CRISTIANE', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG/ES/BA': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARISTELLA'],
        'RIO': ['ALAN', 'THIAGO', 'MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO']
      }
    },
    4: {
      RIO_DUPLO: false,
      areas: {
        'CO/NO': ['CRISTIANE', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['RAISSA', 'MARISTELLA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARISTELLA'],
        'RIO': ['ALAN', 'THIAGO', 'MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO']
      }
    },
    5: {
      RIO_DUPLO: true, // RIO recebe 2 pessoas
      areas: {
        'CO/NO': ['CRISTIANE', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['RAISSA', 'MARISTELLA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARISTELLA'],
        'RIO': ['ALAN', 'THIAGO', 'MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO'],
        '_RIO_2': ['THIAGO', 'ALAN', 'MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO']
      }
    },
    6: {
      RIO_DUPLO: true, // RIO recebe 2 pessoas
      areas: {
        'CO/NO': ['CRISTIANE', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARISTELLA'],
        'RIO': ['ALAN', 'THIAGO', 'MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO'],
        '_RIO_2': ['THIAGO', 'ALAN', 'MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO'],
        'SIR/APOIO': ['RAISSA', 'MARISTELLA', 'CRISTIANE', 'THIAGO', 'LEONARDO', 'ALAN']
      }
    }
  },

  // ============================================
  // CONSTANTES DO SISTEMA
  // ============================================

  DIAS_SEMANA: ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'],

  MESES: [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ],

  // ============================================
  // CHAVES DE LOCALSTORAGE
  // ============================================

  STORAGE_KEYS: {
    BIN_ID: 'escala_bin_id',
    AUTH: 'escala_auth',
    AUTH_EXPIRY: 'escala_auth_expiry',
    BACKUP: 'escala_backup',
    LAST_SAVE: 'escala_ultimo_salvamento'
  }
};

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}
