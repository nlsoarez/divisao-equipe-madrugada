const {
  CAMPOS_INCIDENTE,
  criarUrlMatrizOfensores,
  buscarMatrizOfensores
} = require('../../js/matriz-api');

describe('fallback da matriz de ofensores no Supabase', () => {
  test('mantém os mesmos campos e filtros do endpoint do backend', () => {
    const url = new URL(criarUrlMatrizOfensores(25));

    expect(url.pathname).toBe('/rest/v1/incidents');
    expect(url.searchParams.get('select')).toBe(CAMPOS_INCIDENTE.join(','));
    expect(url.searchParams.get('nm_status')).toBe('not.in.(treated,tratada)');
    expect(url.searchParams.get('or')).toContain('ds_sumario.not.ilike.*#QRT#*');
    expect(url.searchParams.get('or')).toContain('ds_sumario.not.ilike.*QUARENTENA*');
    expect(url.searchParams.get('order')).toBe('dh_inicio.asc');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  test('faz leitura autenticada com a chave pública e normaliza a resposta', async () => {
    const incidentes = [{ id_mostra: 'INC-1', grupo: 'Minas Gerais' }];
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(incidentes)
    });

    const resultado = await buscarMatrizOfensores({
      fetchImpl,
      anonKey: 'chave-publica-de-teste',
      limit: 10
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opcoes] = fetchImpl.mock.calls[0];
    expect(new URL(url).searchParams.get('limit')).toBe('10');
    expect(opcoes.headers).toEqual({
      apikey: 'chave-publica-de-teste',
      Authorization: 'Bearer chave-publica-de-teste'
    });
    expect(resultado).toMatchObject({
      sucesso: true,
      total: 1,
      ofensores: incidentes,
      origem: 'supabase-direto'
    });
  });

  test('expõe o status quando o Supabase rejeita a leitura', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: jest.fn().mockResolvedValue('sem permissão')
    });

    await expect(buscarMatrizOfensores({ fetchImpl }))
      .rejects.toThrow('Supabase HTTP 403: sem permissão');
  });
});
