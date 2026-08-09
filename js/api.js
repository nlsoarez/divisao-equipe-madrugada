/**
 * API de persistência da escala.
 * O navegador fala somente com o backend OCI; as credenciais Supabase ficam
 * exclusivamente no ambiente do servidor.
 */

const API = {
  getBackendUrl() {
    const configured = window.APP_CONFIG && window.APP_CONFIG.BACKEND_URL;
    if (configured) return String(configured).replace(/\/$/, '');
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      return window.location.origin;
    }
    return 'http://localhost:3001';
  },

  getBinId() {
    return 'supabase';
  },

  saveBinId() {
    localStorage.removeItem('escala_bin_id');
    return 'supabase';
  },

  clearBinId() {
    localStorage.removeItem('escala_bin_id');
  },

  async criarBin(dadosIniciais) {
    const result = await this.salvarDados(dadosIniciais);
    if (!result.success) throw new Error(result.error || 'Falha ao inicializar Supabase');
    return { success: true, binId: 'supabase', result };
  },

  async carregarDados() {
    try {
      const response = await fetch(`${this.getBackendUrl()}/api/escala`);
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.sucesso) {
        return { error: result?.erro || `Backend ${response.status}`, status: response.status };
      }
      return result.dados;
    } catch (error) {
      return { error: error.message, status: 0 };
    }
  },

  async salvarDados(dados) {
    try {
      const response = await fetch(`${this.getBackendUrl()}/api/escala`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dados })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.sucesso) {
        return {
          success: false,
          error: result?.erro || `Backend ${response.status}`,
          status: response.status
        };
      }
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message, status: 0 };
    }
  },

  async limparDados() {
    return this.salvarDados({
      escala_id: 'portal_escala_v3_multi',
      versao: '3.0',
      calendarioAtivo: 'calendario1',
      calendario1: null,
      calendario2: null,
      escalonamento: null,
      ultima_atualizacao: new Date().toISOString()
    });
  },

  async verificarBin() {
    try {
      const response = await fetch(`${this.getBackendUrl()}/api/health`);
      const result = await response.json().catch(() => null);
      return Boolean(response.ok && result?.capacidades?.persistencia?.configurada);
    } catch (error) {
      return false;
    }
  },

  salvarBackupLocal(dados) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.BACKUP, JSON.stringify(dados));
      localStorage.setItem(CONFIG.STORAGE_KEYS.LAST_SAVE, new Date().toISOString());
      return true;
    } catch (error) {
      console.error('[API] Erro ao salvar backup local:', error);
      return false;
    }
  },

  carregarBackupLocal() {
    try {
      const backup = localStorage.getItem(CONFIG.STORAGE_KEYS.BACKUP);
      return backup ? JSON.parse(backup) : null;
    } catch (error) {
      console.error('[API] Erro ao carregar backup local:', error);
      return null;
    }
  },

  limparDadosLocais() {
    localStorage.removeItem('escala_bin_id');
    localStorage.removeItem(CONFIG.STORAGE_KEYS.BACKUP);
    localStorage.removeItem(CONFIG.STORAGE_KEYS.LAST_SAVE);
  }
};

if (typeof window !== 'undefined') {
  window.API = API;
}
