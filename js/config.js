/**
 * CONFIGURAÇÕES DO SISTEMA - ESCALA EQUIPE MADRUGADA
 *
 * Este arquivo contém as configurações públicas do frontend.
 * Credenciais de persistência pertencem somente ao backend OCI.
 */

const CONFIG = {
  STORAGE_PROVIDER: 'supabase',

  // ============================================
  // NOMES DOS FUNCIONÁRIOS (para normalização)
  // ============================================

  FUNCIONARIOS: {
    'CRISTIANE': 'CRISTIANE HERMOGENES DA SILVA',
    'MARCELO': 'MARCELO ALMEIDA',
    'MARCELO ALMEIDA': 'MARCELO ALMEIDA',
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
        'CO/NO/NE/BA/MG': ['CRISTIANE', 'MARCELO', 'LEONARDO', 'RAISSA', 'THIAGO', 'ALAN'],
        'RIO/ES': ['ALAN', 'THIAGO', 'RAISSA', 'MARCELO', 'LEONARDO', 'CRISTIANE']
      }
    },
    // 3 pessoas: CO/NO/NE + MG/ES/BA + RIO
    3: {
      RIO_DUPLO: false,
      areas: {
        'CO/NO/NE': ['CRISTIANE', 'MARCELO', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG/ES/BA': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARCELO'],
        'RIO': ['ALAN', 'THIAGO', 'RAISSA', 'CRISTIANE', 'MARCELO', 'LEONARDO']
      }
    },
    // 4 pessoas: CO/NO + NE/BA + MG/ES + RIO
    4: {
      RIO_DUPLO: false,
      areas: {
        'CO/NO': ['CRISTIANE', 'MARCELO', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['MARCELO', 'RAISSA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG/ES': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARCELO'],
        'RIO': ['ALAN', 'THIAGO', 'RAISSA', 'CRISTIANE', 'MARCELO', 'LEONARDO']
      }
    },
    // 5 pessoas: CO/NO + NE/BA + MG/ES + RIO (2 pessoas)
    5: {
      RIO_DUPLO: true,
      areas: {
        'CO/NO': ['CRISTIANE', 'MARCELO', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['MARCELO', 'RAISSA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG/ES': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARCELO'],
        'RIO': ['ALAN', 'THIAGO', 'RAISSA', 'CRISTIANE', 'MARCELO', 'LEONARDO'],
        '_RIO_2': ['THIAGO', 'ALAN', 'RAISSA', 'CRISTIANE', 'MARCELO', 'LEONARDO']
      }
    },
    // 6 pessoas: Atribuição fixa - CO/NO: Cristiane, NE/BA: Marcelo, MG/ES: Leonardo, RIO: Alan+Thiago, SIR: Raíssa
    6: {
      RIO_DUPLO: true,
      areas: {
        'CO/NO': ['CRISTIANE', 'MARCELO', 'RAISSA', 'LEONARDO', 'THIAGO', 'ALAN'],
        'NE/BA': ['MARCELO', 'RAISSA', 'CRISTIANE', 'LEONARDO', 'THIAGO', 'ALAN'],
        'MG/ES': ['LEONARDO', 'RAISSA', 'CRISTIANE', 'ALAN', 'THIAGO', 'MARCELO'],
        'RIO': ['ALAN', 'THIAGO', 'RAISSA', 'CRISTIANE', 'MARCELO', 'LEONARDO'],
        '_RIO_2': ['THIAGO', 'ALAN', 'RAISSA', 'CRISTIANE', 'MARCELO', 'LEONARDO'],
        'SIR/APOIO': ['RAISSA', 'CRISTIANE', 'LEONARDO', 'MARCELO', 'THIAGO', 'ALAN']
      }
    }
  },

  // ============================================
  // REGRAS DE DIVISÃO - LESTE (Residencial)
  // ============================================
  //
  // Prioridade:
  // IGOR tem prioridade TOTAL para áreas com MG
  // Fernanda e Sandro prioritários para MG/NO
  // Gabriela, Magno e Aldenes prioritários para CO/NE/BA
  //
    PRIORIDADES_LESTE: {
    2: {
      areas: {
        'NO/MG': ['IGOR', 'FERNANDA', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'NE/CO/BA': ['GABRIELA', 'MAGNO', 'ALDENES', 'SANDRO', 'FERNANDA', 'IGOR']
      }
    },
    3: {
      areas: {
        'NE/BA': [ 'MAGNO', 'ALDENES','GABRIELA','FERNANDA', 'SANDRO', 'IGOR'],
        'MG/NO': ['IGOR', 'FERNANDA', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'CO': ['GABRIELA', 'MAGNO', 'ALDENES', 'FERNANDA', 'IGOR', 'SANDRO']
      }
    },
    4: {
      areas: {
        'CO': ['GABRIELA', 'MAGNO', 'ALDENES', 'IGOR', 'FERNANDA', 'SANDRO'],
        'BA/NE': ['MAGNO', 'ALDENES', 'GABRIELA', 'FERNANDA', 'IGOR', 'SANDRO'],
        'NO': ['FERNANDA', 'IGOR', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'MG': ['IGOR', 'SANDRO', 'FERNANDA', 'GABRIELA', 'MAGNO', 'ALDENES']
      }
    },
    5: {
      areas: {
        'CO': ['GABRIELA', 'SANDRO', 'MAGNO', 'ALDENES', 'IGOR', 'FERNANDA'],
        'NO': ['FERNANDA', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES', 'IGOR'],
        'NE': ['MAGNO', 'ALDENES', 'GABRIELA', 'IGOR', 'FERNANDA', 'SANDRO'],
        'MG': ['IGOR', 'SANDRO', 'GABRIELA', 'FERNANDA', 'MAGNO', 'ALDENES'],
        'BA/CO/NE': ['ALDENES', 'SANDRO','IGOR','GABRIELA','FERNANDA','MAGNO']
      }
    },
    6: {
      areas: {
        'CO': ['GABRIELA', 'SANDRO', 'MAGNO', 'ALDENES', 'IGOR', 'FERNANDA'],
        'NE': ['FERNANDA', 'SANDRO', 'GABRIELA', 'MAGNO', 'ALDENES', 'IGOR'],
        'NO': ['MAGNO', 'ALDENES', 'GABRIELA', 'IGOR', 'FERNANDA', 'SANDRO'],
        'MG': ['IGOR', 'SANDRO', 'GABRIELA', 'FERNANDA', 'MAGNO', 'ALDENES'],
        'BA/CO/NE': ['SANDRO', 'IGOR', 'FERNANDA', 'GABRIELA', 'MAGNO', 'ALDENES'],
        'APOIO SIR': ['ALDENES', 'MAGNO', 'GABRIELA', 'FERNANDA', 'IGOR', 'SANDRO']
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
  // REGRAS DE DIVISÃO - RIO/ES (Empresarial)
  // ============================================
  //
  // Analistas: Roberto, Rodrigo, Jefferson, Monica, Suellen
  //
  // OBS: o caminho Rio/ES agora usa rodízio justo (ver
  // calcularDivisaoRodizioRioEs em index.html). Apenas as CHAVES de área
  // (ex.: 'ES/NO3/NO1/CZS/SU2/SEF') são lidas — os arrays de prioridade
  // abaixo ficam como legado / fallback e NÃO são mais consultados quando
  // tipoConfig === 'rio_es'. Mexer só nas chaves quando a divisão de áreas
  // mudar.
  //
  PRIORIDADES_RIO_ES: {
    2: {
      areas: {
        'ES/NO3/NO1/CZS/SU2/SEF': ['SUELLEN', 'MONICA', 'ROBERTO', 'RODRIGO', 'JEFFERSON'],
        'NO2/MTP/BX1/OE1/SUF/NOF/LGS': ['RODRIGO', 'ROBERTO', 'JEFFERSON', 'MONICA', 'SUELLEN']
      }
    },
    3: {
      areas: {
        'NO2/BX1/OE1/SUF/CZS': ['ROBERTO', 'ROBERTO', 'JEFFERSON', 'MONICA', 'SUELLEN'],
        'MTP/NO1/NOF/NO3': ['RODRIGO', 'JEFFERSON', 'MONICA', 'RODRIGO', 'SUELLEN'],
        'ES/SU2/SEF/LGS': ['SUELLEN', 'ROBERTO', 'MONICA', 'RODRIGO', 'JEFFERSON']
      }
    },
    4: {
      areas: {
        'ES/SU2/SEF': ['SUELLEN', 'MONICA', 'ROBERTO', 'RODRIGO', 'JEFFERSON'],
        'NO2/BX1/OE1/SUF': ['ROBERTO', 'RODRIGO', 'JEFFERSON', 'MONICA', 'SUELLEN'],
        'MTP/NO1/NOF': ['RODRIGO', 'JEFFERSON', 'MONICA', 'ROBERTO', 'SUELLEN'],
        'NO3/CZS/LGS': ['JEFFERSON', 'RODRIGO', 'ROBERTO', 'MONICA', 'SUELLEN']
      }
    },
    5: {
      areas: {
        'ES/SEF': ['SUELLEN', 'MONICA', 'ROBERTO', 'RODRIGO', 'JEFFERSON'],
        'NO2/BX1/OE1': ['ROBERTO', 'RODRIGO', 'JEFFERSON', 'MONICA', 'SUELLEN'],
        'NO1/NOF/SUF': ['RODRIGO', 'ROBERTO', 'MONICA', 'RODRIGO', 'SUELLEN'],
        'NO3/CZS': ['JEFFERSON', 'RODRIGO', 'ROBERTO', 'MONICA', 'SUELLEN'],
        'MTP/SU2/LGS': ['MONICA', 'RODRIGO', 'ROBERTO', 'JEFFERSON', 'SUELLEN']
      }
    }
  },

  FUNCIONARIOS_RIO_ES: {
    'ROBERTO': 'ROBERTO',
    'RODRIGO': 'RODRIGO',
    'JEFFERSON': 'JEFFERSON',
    'MONICA': 'MONICA',
    'SUELLEN': 'SUELLEN'
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
