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
    // 2 pessoas: CO/NO/NE/BA/MG + RIO/ES
    2: {
      RIO_DUPLO: false,
      areas: {
        'CO/NO/NE/BA/MG': ['CRISTIANE', 'MARISTELLA', 'LEONARDO', 'RAISSA', 'THIAGO', 'ALAN'],
        'RIO/ES': ['ALAN', 'THIAGO', 'RAISSA', 'MARISTELLA', 'LEONARDO', 'CRISTIANE']
      }
    },
    // 3 pessoas: CO/NO/NE + MG/ES/BA + RIO
    3: {
      RIO_DUPLO: false,
      areas: {
        'CO/NO/NE': ['CRISTIANE', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG/ES/BA': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARISTELLA'],
        'RIO': ['ALAN', 'THIAGO', 'RAISSA', 'CRISTIANE', 'MARISTELLA', 'LEONARDO']
      }
    },
    // 4 pessoas: CO/NO + NE/BA + MG/ES + RIO
    4: {
      RIO_DUPLO: false,
      areas: {
        'CO/NO': ['CRISTIANE', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG/ES': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARISTELLA'],
        'RIO': ['ALAN', 'THIAGO', 'RAISSA', 'CRISTIANE', 'MARISTELLA', 'LEONARDO']
      }
    },
    // 5 pessoas: CO/NO + NE/BA + MG + RIO (2 pessoas)
    5: {
      RIO_DUPLO: true,
      areas: {
        'CO/NO': ['CRISTIANE', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARISTELLA'],
        'RIO': ['ALAN', 'THIAGO', 'RAISSA', 'CRISTIANE', 'MARISTELLA', 'LEONARDO'],
        '_RIO_2': ['THIAGO', 'ALAN', 'RAISSA', 'CRISTIANE', 'MARISTELLA', 'LEONARDO']
      }
    },
    // 6 pessoas: Atribuição fixa - CO/NO: Cristiane, NE/BA: Maristela, MG: Leonardo, RIO: Alan+Thiago, SIR: Raíssa
    6: {
      RIO_DUPLO: true,
      areas: {
        'CO/NO': ['CRISTIANE', 'MARISTELLA', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['MARISTELLA', 'RAISSA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARISTELLA'],
        'RIO': ['ALAN', 'THIAGO', 'RAISSA', 'CRISTIANE', 'MARISTELLA', 'LEONARDO'],
        '_RIO_2': ['THIAGO', 'ALAN', 'RAISSA', 'CRISTIANE', 'MARISTELLA', 'LEONARDO'],
        'SIR/APOIO': ['RAISSA', 'CRISTIANE', 'LEONARDO', 'MARISTELLA', 'THIAGO', 'ALAN']
      }
    }
  },

  // ============================================
  // REGRAS DE DIVISÃO - LESTE (Residencial)
  // ============================================
  //
  // Prioridade:
  // Fernanda, Igor e Sandro prioritários para MG/NO
  // Gabriela, Magno e Aldenes prioritários para CO/NE/BA
  //
  PRIORIDADES_LESTE: {
    3: {
      areas: {
        'NE/NO': ['FERNANDA', 'IGOR', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'MG/NO': ['FERNANDA', 'IGOR', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'CO/BA': ['GABRIELA', 'MAGNO', 'ALDENES', 'FERNANDA', 'IGOR', 'SANDRO']
      }
    },
    4: {
      areas: {
        'MG/NO': ['FERNANDA', 'IGOR', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'NO/MG': ['FERNANDA', 'IGOR', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'NE/BA': ['GABRIELA', 'MAGNO', 'ALDENES', 'FERNANDA', 'IGOR', 'SANDRO'],
        'CO/BA': ['GABRIELA', 'MAGNO', 'ALDENES', 'FERNANDA', 'IGOR', 'SANDRO']
      }
    },
    5: {
      areas: {
        'MG/NO': ['FERNANDA', 'IGOR', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'NO/MG': ['FERNANDA', 'IGOR', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'NE/CO': ['GABRIELA', 'MAGNO', 'ALDENES', 'FERNANDA', 'IGOR', 'SANDRO'],
        'CO/NE': ['GABRIELA', 'MAGNO', 'ALDENES', 'FERNANDA', 'IGOR', 'SANDRO'],
        'APOIO SIR/BA': ['GABRIELA', 'MAGNO', 'ALDENES', 'FERNANDA', 'IGOR', 'SANDRO']
      }
    }
  },

  FUNCIONARIOS_LESTE: {
    'FERNANDA': 'FERNANDA',
    'IGOR': 'IGOR',
    'SANDRO': 'SANDRO',
    'GABRIELA': 'GABRIELA',
    'MAGNO': 'MAGNO',
    'ALDENES': 'ALDENES'
  },

  // ============================================
  // REGRAS DE DIVISÃO - RIO/ES (Residencial)
  // ============================================
  //
  // Áreas: ES, NO2, NO3, NO1, MTP, BX1, OE1, CZS, SU2, SEF, SUF, NOF, LGS
  //
  PRIORIDADES_RIO_ES: {
    2: {
      areas: {
        'ES/NO3/NO1/CZS/SU2/SEF': [],
        'NO2/MTP/BX1/OE1/SUF/NOF/LGS': []
      }
    },
    3: {
      areas: {
        'ES/OE1/SUF/LGS': [],
        'NO2/BX1/NO1': [],
        'MTP/NO3/CZS/SU2/SEF/NOF': []
      }
    },
    4: {
      areas: {
        'ES/SU2/SEF': [],
        'NO2/BX1/OE1/SUF': [],
        'MTP/NO1/NOF': [],
        'NO3/CZS/LGS': []
      }
    },
    5: {
      areas: {
        'ES': [],
        'NO2/BX1/OE1/SUF': [],
        'MTP/NO1/NOF/SU2': [],
        'NO3/CZS/LGS/SEF': []
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
