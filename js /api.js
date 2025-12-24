/**
 * API MODULE - Integração com JSONBin.io
 *
 * Este módulo gerencia todas as operações de leitura/escrita na nuvem.
 * Funções exportadas via objeto global 'API'
 */

const API = {
  // ============================================
  // GERENCIAMENTO DE BIN_ID
  // ============================================

  /**
   * Obtém o BIN_ID atual
   * Prioridade: 1) config.js (compartilhado por todos), 2) localStorage (fallback)
   */
  getBinId() {
    // Prioridade 1: ID no arquivo de configuração (compartilhado por todos)
    if (CONFIG.BIN_ID && CONFIG.BIN_ID !== 'null' && CONFIG.BIN_ID.length > 10) {
      console.log('[API] Usando BIN_ID do config.js:', CONFIG.BIN_ID);
      return CONFIG.BIN_ID;
    }
    // Prioridade 2: ID salvo localmente (fallback)
    const localId = localStorage.getItem(CONFIG.STORAGE_KEYS.BIN_ID);
    if (localId) {
      console.log('[API] Usando BIN_ID do localStorage:', localId);
    }
    return localId;
  },

  /**
   * Salva o BIN_ID localmente
   */
  saveBinId(binId) {
    localStorage.setItem(CONFIG.STORAGE_KEYS.BIN_ID, binId);
    console.log('[API] BIN_ID salvo localmente:', binId);
  },

  /**
   * Limpa o BIN_ID local
   */
  clearBinId() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.BIN_ID);
  },

  // ============================================
  // OPERAÇÕES COM JSONBIN
  // ============================================

  /**
   * Cria um novo bin no JSONBin.io
   * @param {Object} dadosIniciais - Dados para inicializar o bin
   * @returns {Promise<{success: boolean, binId: string, result: Object}>}
   */
  async criarBin(dadosIniciais) {
    console.log('[API] Criando novo bin...');

    try {
      const response = await fetch(CONFIG.JSONBIN.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': CONFIG.JSONBIN.MASTER_KEY,
          'X-Access-Key': CONFIG.JSONBIN.ACCESS_KEY,
          'X-Bin-Name': `Escala Equipe Madrugada - ${new Date().toISOString().split('T')[0]}`,
          'X-Bin-Private': 'false'
        },
        body: JSON.stringify(dadosIniciais)
      });

      console.log('[API] Status da criação:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[API] Erro ao criar bin:', response.status, errorText);
        throw new Error(`Erro ao criar bin: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      const novoBinId = result.metadata.id;

      console.log('[API] Bin criado com sucesso! ID:', novoBinId);

      // Salvar localmente
      this.saveBinId(novoBinId);

      return { success: true, binId: novoBinId, result };
    } catch (error) {
      console.error('[API] Falha ao criar bin:', error);
      throw error;
    }
  },

  /**
   * Carrega dados do bin
   * @param {string} binId - ID do bin (opcional, usa getBinId() se não fornecido)
   * @param {number} timeout - Timeout em ms (padrão: 15000)
   * @returns {Promise<Object|null>}
   */
  async carregarDados(binId = null, timeout = 15000) {
    const id = binId || this.getBinId();

    if (!id) {
      console.warn('[API] Nenhum BIN_ID disponível para carregar');
      return null;
    }

    console.log('[API] Carregando dados do bin:', id);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${CONFIG.JSONBIN.API_URL}/${id}/latest`, {
        method: 'GET',
        headers: {
          'X-Master-Key': CONFIG.JSONBIN.MASTER_KEY,
          'X-Access-Key': CONFIG.JSONBIN.ACCESS_KEY
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      console.log('[API] Status do carregamento:', response.status);

      if (response.status === 404) {
        console.warn('[API] Bin não encontrado (404). ID pode estar incorreto ou foi deletado.');
        // Limpar ID local se estava usando um ID local que não existe mais
        if (!CONFIG.BIN_ID) {
          this.clearBinId();
        }
        return { error: 'NOT_FOUND', status: 404 };
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[API] Erro ao carregar:', response.status, errorText);
        return { error: errorText, status: response.status };
      }

      const result = await response.json();
      console.log('[API] Dados carregados com sucesso');

      return result.record;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('[API] Timeout ao carregar dados');
        return { error: 'TIMEOUT', status: 0 };
      }
      console.error('[API] Erro ao carregar:', error);
      return { error: error.message, status: 0 };
    }
  },

  /**
   * Salva dados no bin
   * @param {Object} dados - Dados para salvar
   * @param {string} binId - ID do bin (opcional)
   * @returns {Promise<{success: boolean, result?: Object, error?: string}>}
   */
  async salvarDados(dados, binId = null) {
    const id = binId || this.getBinId();

    if (!id) {
      console.warn('[API] Nenhum BIN_ID para salvar. Precisa criar um novo bin.');
      return { success: false, error: 'NO_BIN_ID' };
    }

    console.log('[API] Salvando dados no bin:', id);

    try {
      const response = await fetch(`${CONFIG.JSONBIN.API_URL}/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': CONFIG.JSONBIN.MASTER_KEY,
          'X-Access-Key': CONFIG.JSONBIN.ACCESS_KEY,
          'X-Bin-Name': `Escala ${dados.mes !== undefined ? CONFIG.MESES[dados.mes] : ''} ${dados.ano || ''}`
        },
        body: JSON.stringify(dados)
      });

      console.log('[API] Status do salvamento:', response.status);

      // Se bin não existe, retornar erro específico para que chamador possa criar novo
      if (response.status === 404) {
        console.warn('[API] Bin não encontrado (404) ao salvar.');
        return { success: false, error: 'NOT_FOUND', status: 404 };
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[API] Erro ao salvar:', response.status, errorText);
        return { success: false, error: errorText, status: response.status };
      }

      const result = await response.json();
      console.log('[API] Dados salvos com sucesso');

      return { success: true, result };
    } catch (error) {
      console.error('[API] Erro ao salvar:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Limpa os dados do bin (não deleta o bin, apenas esvazia)
   * @param {string} binId - ID do bin (opcional)
   * @returns {Promise<{success: boolean}>}
   */
  async limparDados(binId = null) {
    const id = binId || this.getBinId();

    if (!id) {
      return { success: false, error: 'NO_BIN_ID' };
    }

    console.log('[API] Limpando dados do bin:', id);

    const dadosVazios = {
      escala_id: 'portal_escala_v2',
      mes: null,
      ano: null,
      ultima_atualizacao: new Date().toISOString(),
      dadosOriginais: {},
      trocas: [],
      dadosPlanilha: [],
      metadata: {
        deletado_em: new Date().toISOString(),
        versao: '2.0'
      }
    };

    return await this.salvarDados(dadosVazios, id);
  },

  /**
   * Verifica se um bin existe e está acessível
   * @param {string} binId - ID do bin
   * @returns {Promise<boolean>}
   */
  async verificarBin(binId) {
    if (!binId) return false;

    try {
      const response = await fetch(`${CONFIG.JSONBIN.API_URL}/${binId}/latest`, {
        method: 'GET',
        headers: {
          'X-Master-Key': CONFIG.JSONBIN.MASTER_KEY,
          'X-Access-Key': CONFIG.JSONBIN.ACCESS_KEY
        }
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  },

  // ============================================
  // BACKUP LOCAL
  // ============================================

  /**
   * Salva backup local dos dados
   */
  salvarBackupLocal(dados) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.BACKUP, JSON.stringify(dados));
      localStorage.setItem(CONFIG.STORAGE_KEYS.LAST_SAVE, new Date().toISOString());
      console.log('[API] Backup local salvo');
    } catch (error) {
      console.error('[API] Erro ao salvar backup local:', error);
    }
  },

  /**
   * Carrega backup local
   */
  carregarBackupLocal() {
    try {
      const backup = localStorage.getItem(CONFIG.STORAGE_KEYS.BACKUP);
      if (backup) {
        return JSON.parse(backup);
      }
    } catch (error) {
      console.error('[API] Erro ao carregar backup local:', error);
    }
    return null;
  },

  /**
   * Limpa backups e configurações locais
   */
  limparDadosLocais() {
    localStorage.removeItem(CONFIG.STORAGE_KEYS.BIN_ID);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.BACKUP);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.LAST_SAVE);
    console.log('[API] Dados locais limpos');
  }
};

// Exportar para uso global
if (typeof window !== 'undefined') {
  window.API = API;
}
