/**
 * MÓDULO DE PERSISTÊNCIA RESILIENTE DA ESCALA (Multi-Tier Resilient Storage)
 * 
 * Camadas de redundância para alta disponibilidade:
 * 1. Supabase Data API (Nuvem principal - sem limite de cota de 10k)
 * 2. GitHub Pages / Repositório Estático (data/escala.json - 100% uptime)
 * 3. Backend OCI / Local (/api/escala)
 * 4. LocalStorage (Cache local offline)
 */

(function (globalScope, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.EscalaApi = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_SUPABASE_URL = 'https://wthzxrgifjtenaujhdbb.supabase.co';
  const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0aHp4cmdpZmp0ZW5hdWpoZGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwMjYwODIsImV4cCI6MjA4NDYwMjA4Mn0.MGhDMxfbbKGc69Mut8M7ESmULS8d10VgeIu_vXcorpc';
  const DEFAULT_TABLE = 'escalas';
  const DEFAULT_RECORD_ID = 'escala_ativa';
  const DEFAULT_STATIC_PATH = 'data/escala.json';

  function extrairFetch(opcoes = {}) {
    if (opcoes.fetchImpl) return opcoes.fetchImpl;
    if (typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function') {
      return globalThis.fetch.bind(globalThis);
    }
    return null;
  }

  function extrairLocalStorage(opcoes = {}) {
    if (opcoes.localStorageImpl) return opcoes.localStorageImpl;
    if (typeof localStorage !== 'undefined') return localStorage;
    return null;
  }

  function validarDadosEscala(dados) {
    if (!dados || typeof dados !== 'object') return false;

    // Formato v3.0 (múltiplos calendários)
    if (dados.versao === '3.0' || dados.calendario1 || dados.calendario2) {
      const cal1Tem = dados.calendario1 && typeof dados.calendario1 === 'object';
      const cal2Tem = dados.calendario2 && typeof dados.calendario2 === 'object';
      return cal1Tem || cal2Tem || dados.escala_id === 'portal_escala_v3_multi';
    }

    // Formato v2.0 (legado)
    if (dados.dadosOriginais && typeof dados.dadosOriginais === 'object') {
      return Object.keys(dados.dadosOriginais).length > 0;
    }
    if (Array.isArray(dados.dadosPlanilha) && dados.dadosPlanilha.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Camada 1: Leitura via Supabase Data API (Tabela escalas ou fallback em indicators)
   */
  async function carregarDoSupabase(opcoes = {}) {
    const fetchImpl = extrairFetch(opcoes);
    if (!fetchImpl) throw new Error('Fetch indisponível para Supabase');

    const supabaseUrl = opcoes.supabaseUrl || DEFAULT_SUPABASE_URL;
    const anonKey = opcoes.anonKey || DEFAULT_SUPABASE_KEY;
    const table = opcoes.table || DEFAULT_TABLE;
    const recordId = opcoes.recordId || DEFAULT_RECORD_ID;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), opcoes.timeout || 10000) : null;

    try {
      // 1. Tentar tabela configurada (ex: escalas)
      const url = `${supabaseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(recordId)}&select=dados,atualizado_em,versao`;
      let resp = await fetchImpl(url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Accept': 'application/json'
        },
        signal: controller ? controller.signal : undefined
      }).catch(() => null);

      if (resp && resp.ok) {
        const rows = await resp.json();
        if (Array.isArray(rows) && rows.length > 0 && rows[0].dados && validarDadosEscala(rows[0].dados)) {
          if (timeoutId) clearTimeout(timeoutId);
          return {
            sucesso: true,
            origem: 'supabase',
            dados: rows[0].dados,
            atualizadoEm: rows[0].atualizado_em || null,
            versao: rows[0].versao || rows[0].dados.versao || '3.0'
          };
        }
      }

      // 2. Fallback direto para tabela indicators (onde a anonKey já tem permissão nativa de leitura)
      const urlInd = `${supabaseUrl}/rest/v1/indicators?code=eq.ESCALA_PUBLICA_MADRUGADA&select=name,created_at,unit`;
      const respInd = await fetchImpl(urlInd, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Accept': 'application/json'
        },
        signal: controller ? controller.signal : undefined
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (respInd && respInd.ok) {
        const rowsInd = await respInd.json();
        if (Array.isArray(rowsInd) && rowsInd.length > 0 && rowsInd[0].name) {
          try {
            const dadosParsed = JSON.parse(rowsInd[0].name);
            if (validarDadosEscala(dadosParsed)) {
              return {
                sucesso: true,
                origem: 'supabase',
                dados: dadosParsed,
                atualizadoEm: rowsInd[0].created_at || null,
                versao: dadosParsed.versao || '3.0'
              };
            }
          } catch (pe) {
            console.warn('[EscalaApi] Erro ao parsear dados da tabela indicators:', pe);
          }
        }
      }

      throw new Error('Nenhum registro de escala encontrado no Supabase');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Camada 2: Leitura via Arquivo Estático no GitHub Pages (data/escala.json)
   */
  async function carregarDoArquivoEstatico(opcoes = {}) {
    const fetchImpl = extrairFetch(opcoes);
    if (!fetchImpl) throw new Error('Fetch indisponível para arquivo estático');

    const caminho = opcoes.caminhoEstatico || DEFAULT_STATIC_PATH;
    const url = `${caminho}${caminho.includes('?') ? '&' : '?'}t=${Date.now()}`;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), opcoes.timeout || 8000) : null;

    try {
      const resp = await fetchImpl(url, {
        method: 'GET',
        cache: 'no-store',
        headers: {
          'Accept': 'application/json'
        },
        signal: controller ? controller.signal : undefined
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!resp.ok) {
        throw new Error(`Arquivo estático HTTP ${resp.status}`);
      }

      const dados = await resp.json();
      if (!validarDadosEscala(dados)) {
        throw new Error('Arquivo estático não contém dados válidos de escala');
      }

      return {
        sucesso: true,
        origem: 'github-static',
        dados,
        atualizadoEm: dados.ultima_atualizacao || null,
        versao: dados.versao || '3.0'
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Camada 3: Leitura via Backend Node / Express (/api/escala)
   */
  async function carregarDoBackend(opcoes = {}) {
    const fetchImpl = extrairFetch(opcoes);
    if (!fetchImpl) throw new Error('Fetch indisponível para backend');

    const backendUrl = opcoes.backendUrl;
    if (!backendUrl) throw new Error('URL do backend não configurada');

    const url = `${backendUrl}/api/escala${opcoes.binId ? `?binId=${opcoes.binId}` : ''}`;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), opcoes.timeout || 8000) : null;

    try {
      const resp = await fetchImpl(url, {
        method: 'GET',
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!resp.ok) throw new Error(`Backend HTTP ${resp.status}`);

      const result = await resp.json();
      if (!result.sucesso || !result.dados || !validarDadosEscala(result.dados)) {
        throw new Error('Backend não retornou dados de escala válidos');
      }

      return {
        sucesso: true,
        origem: result.origem || 'backend',
        dados: result.dados,
        atualizadoEm: result.atualizadoEm || null
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Camada 4: Leitura via LocalStorage (Cache local offline)
   */
  function carregarDoLocalStorage(opcoes = {}) {
    const storage = extrairLocalStorage(opcoes);
    if (!storage) throw new Error('LocalStorage indisponível');

    const chaveBackup = opcoes.storageKey || 'escala_backup';
    const chaveUltimoSave = opcoes.lastSaveKey || 'escala_ultimo_salvamento';

    const raw = storage.getItem(chaveBackup);
    if (!raw) throw new Error('Nenhum backup encontrado no localStorage');

    const dados = JSON.parse(raw);
    if (!validarDadosEscala(dados)) {
      throw new Error('Backup no localStorage não contém dados válidos');
    }

    const ultimoSalvamento = storage.getItem(chaveUltimoSave);

    return {
      sucesso: true,
      origem: 'localstorage',
      dados,
      atualizadoEm: ultimoSalvamento || null
    };
  }

  /**
   * Orquestrador de Carregamento em Camadas (Multi-Tier Resilient Load)
   */
  async function carregarEscala(opcoes = {}) {
    const logs = [];

    // 1. Tentar Supabase
    try {
      const res = await carregarDoSupabase(opcoes);
      return { ...res, logs };
    } catch (err) {
      logs.push(`Supabase: ${err.message}`);
    }

    // 2. Tentar Arquivo Estático (data/escala.json)
    try {
      const res = await carregarDoArquivoEstatico(opcoes);
      return { ...res, logs };
    } catch (err) {
      logs.push(`Arquivo Estático: ${err.message}`);
    }

    // 3. Tentar Backend
    if (opcoes.backendUrl && !opcoes.backendUrl.includes('github.io')) {
      try {
        const res = await carregarDoBackend(opcoes);
        return { ...res, logs };
      } catch (err) {
        logs.push(`Backend: ${err.message}`);
      }
    }

    // 4. Tentar LocalStorage
    try {
      const res = carregarDoLocalStorage(opcoes);
      return { ...res, logs, aviso: 'Carregado do cache local' };
    } catch (err) {
      logs.push(`LocalStorage: ${err.message}`);
    }

    return {
      sucesso: false,
      dados: null,
      erro: 'Não foi possível carregar a escala de nenhuma fonte disponível.',
      logs
    };
  }

  /**
   * Gravação no Supabase Data API (Upsert na tabela configurada ou indicators)
   */
  async function salvarNoSupabase(dados, opcoes = {}) {
    const fetchImpl = extrairFetch(opcoes);
    if (!fetchImpl) throw new Error('Fetch indisponível para Supabase');

    const supabaseUrl = opcoes.supabaseUrl || DEFAULT_SUPABASE_URL;
    const anonKey = opcoes.anonKey || DEFAULT_SUPABASE_KEY;
    const table = opcoes.table || DEFAULT_TABLE;
    const recordId = opcoes.recordId || DEFAULT_RECORD_ID;

    // 1. Tentar upsert na tabela configurada
    try {
      const payload = {
        id: recordId,
        dados: dados,
        versao: dados.versao || '3.0',
        atualizado_em: new Date().toISOString(),
        atualizado_por: 'portal_madrugada'
      };

      const url = `${supabaseUrl}/rest/v1/${table}`;
      const resp = await fetchImpl(url, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(payload)
      });

      if (resp.ok) {
        return { sucesso: true, destino: 'supabase' };
      }
    } catch (e) {
      console.warn('[EscalaApi] Falha na tabela configurada do Supabase, tentando indicators...', e.message);
    }

    // 2. Fallback garantido na tabela indicators
    const checkUrl = `${supabaseUrl}/rest/v1/indicators?code=eq.ESCALA_PUBLICA_MADRUGADA&select=code`;
    const checkResp = await fetchImpl(checkUrl, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    });

    const rows = checkResp.ok ? await checkResp.json() : [];
    const payloadStr = JSON.stringify(dados);

    if (Array.isArray(rows) && rows.length > 0) {
      // Atualizar
      const patchUrl = `${supabaseUrl}/rest/v1/indicators?code=eq.ESCALA_PUBLICA_MADRUGADA`;
      const patchResp = await fetchImpl(patchUrl, {
        method: 'PATCH',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: payloadStr,
          target_value: 3.0,
          unit: 'JSON_V3'
        })
      });
      if (patchResp.ok) {
        return { sucesso: true, destino: 'supabase-indicators' };
      }
      const errText = await patchResp.text().catch(() => '');
      throw new Error(`Supabase PATCH HTTP ${patchResp.status}: ${errText.substring(0, 100)}`);
    } else {
      // Inserir
      const postUrl = `${supabaseUrl}/rest/v1/indicators`;
      const postResp = await fetchImpl(postUrl, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: 'ESCALA_PUBLICA_MADRUGADA',
          name: payloadStr,
          target_value: 3.0,
          unit: 'JSON_V3'
        })
      });
      if (postResp.ok) {
        return { sucesso: true, destino: 'supabase-indicators' };
      }
      const errText = await postResp.text().catch(() => '');
      throw new Error(`Supabase POST HTTP ${postResp.status}: ${errText.substring(0, 100)}`);
    }
  }

  /**
   * Gravação Resiliente da Escala
   */
  async function salvarEscala(dados, opcoes = {}) {
    const resultados = {
      supabase: false,
      backend: false,
      localstorage: false,
      erros: []
    };

    // 1. Tentar salvar no Supabase
    try {
      await salvarNoSupabase(dados, opcoes);
      resultados.supabase = true;
    } catch (err) {
      resultados.erros.push(`Supabase: ${err.message}`);
    }

    // 2. Tentar salvar no Backend (se configurado e não for github.io)
    if (opcoes.backendUrl && !opcoes.backendUrl.includes('github.io')) {
      try {
        const fetchImpl = extrairFetch(opcoes);
        const resp = await fetchImpl(`${opcoes.backendUrl}/api/escala`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ binId: opcoes.binId, dados })
        });
        if (resp.ok) resultados.backend = true;
        else resultados.erros.push(`Backend HTTP ${resp.status}`);
      } catch (err) {
        resultados.erros.push(`Backend: ${err.message}`);
      }
    }

    // 3. Sempre salvar no LocalStorage
    try {
      const storage = extrairLocalStorage(opcoes);
      if (storage) {
        storage.setItem(opcoes.storageKey || 'escala_backup', JSON.stringify(dados));
        storage.setItem(opcoes.lastSaveKey || 'escala_ultimo_salvamento', new Date().toISOString());
        resultados.localstorage = true;
      }
    } catch (err) {
      resultados.erros.push(`LocalStorage: ${err.message}`);
    }

    const salvouEmAlgumLugarRemoto = resultados.supabase || resultados.backend;

    return {
      sucesso: salvouEmAlgumLugarRemoto || resultados.localstorage,
      salvouRemoto: salvouEmAlgumLugarRemoto,
      resultados
    };
  }

  /**
   * Utilitário para exportar o JSON da escala formatado
   */
  function gerarJsonExportavel(dados) {
    return JSON.stringify(dados, null, 2);
  }

  return {
    DEFAULT_SUPABASE_URL,
    DEFAULT_SUPABASE_KEY,
    DEFAULT_TABLE,
    DEFAULT_RECORD_ID,
    DEFAULT_STATIC_PATH,
    validarDadosEscala,
    carregarDoSupabase,
    carregarDoArquivoEstatico,
    carregarDoBackend,
    carregarDoLocalStorage,
    carregarEscala,
    salvarNoSupabase,
    salvarEscala,
    gerarJsonExportavel
  };
});
