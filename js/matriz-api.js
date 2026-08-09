(function (globalScope, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (globalScope) {
    globalScope.MatrizApi = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const SUPABASE_URL = 'https://wthzxrgifjtenaujhdbb.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0aHp4cmdpZmp0ZW5hdWpoZGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwMjYwODIsImV4cCI6MjA4NDYwMjA4Mn0.MGhDMxfbbKGc69Mut8M7ESmULS8d10VgeIu_vXcorpc';
  const CAMPOS_INCIDENTE = [
    'id_mostra',
    'nm_tipo',
    'nm_cidade',
    'nm_status',
    'topologia',
    'dh_inicio',
    'regional',
    'grupo',
    'cluster',
    'ds_sumario'
  ];

  function criarUrlMatrizOfensores(limit = 200, supabaseUrl = SUPABASE_URL) {
    const limiteSeguro = Number.isInteger(Number(limit))
      ? Math.min(Math.max(Number(limit), 1), 1000)
      : 200;
    const url = new URL(`${supabaseUrl}/rest/v1/incidents`);

    url.searchParams.set('select', CAMPOS_INCIDENTE.join(','));
    url.searchParams.set('nm_status', 'not.in.(treated,tratada)');
    url.searchParams.set(
      'or',
      '(ds_sumario.is.null,and(ds_sumario.not.ilike.*#QRT#*,ds_sumario.not.ilike.*QUARENTENA*))'
    );
    url.searchParams.set('order', 'dh_inicio.asc');
    url.searchParams.set('limit', String(limiteSeguro));

    return url.toString();
  }

  async function buscarMatrizOfensores(opcoes = {}) {
    const fetchImpl = opcoes.fetchImpl || (
      typeof globalThis !== 'undefined' && typeof globalThis.fetch === 'function'
        ? globalThis.fetch.bind(globalThis)
        : null
    );
    const anonKey = opcoes.anonKey || SUPABASE_ANON_KEY;

    if (!fetchImpl) {
      throw new Error('Fetch indisponível para consultar o Supabase');
    }

    const headers = { apikey: anonKey };
    if (!String(anonKey).startsWith('sb_')) {
      headers.Authorization = `Bearer ${anonKey}`;
    }

    const response = await fetchImpl(
      criarUrlMatrizOfensores(opcoes.limit, opcoes.supabaseUrl),
      {
        method: 'GET',
        cache: 'no-store',
        headers
      }
    );

    if (!response.ok) {
      const detalhe = await response.text().catch(() => '');
      throw new Error(`Supabase HTTP ${response.status}${detalhe ? `: ${detalhe}` : ''}`);
    }

    const ofensores = await response.json();
    if (!Array.isArray(ofensores)) {
      throw new Error('Resposta inválida do Supabase');
    }

    return {
      sucesso: true,
      total: ofensores.length,
      ofensores,
      timestamp: new Date().toISOString(),
      origem: 'portal-coprede-direto'
    };
  }

  return {
    CAMPOS_INCIDENTE,
    criarUrlMatrizOfensores,
    buscarMatrizOfensores
  };
});
