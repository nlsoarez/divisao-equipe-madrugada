const EscalaApi = require('../../js/escala-api');

describe('EscalaApi - Persistência Resiliente da Escala (Multi-Tier Storage)', () => {
  const dadosValidos = {
    escala_id: 'portal_escala_v3_multi',
    versao: '3.0',
    calendarioAtivo: 'calendario1',
    calendario1: {
      mes: 7,
      ano: 2026,
      dadosOriginais: { '1': ['ALAN', 'THIAGO'] }
    },
    calendario2: null,
    ultima_atualizacao: '2026-08-19T00:00:00.000Z'
  };

  test('valida corretamente dados no formato v3.0 e formato v2.0', () => {
    expect(EscalaApi.validarDadosEscala(dadosValidos)).toBe(true);
    expect(EscalaApi.validarDadosEscala({ dadosOriginais: { '1': ['TESTE'] } })).toBe(true);
    expect(EscalaApi.validarDadosEscala(null)).toBe(false);
    expect(EscalaApi.validarDadosEscala({})).toBe(false);
  });

  test('Camada 1: carrega com sucesso via Supabase quando disponível', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue([
        {
          id: 'escala_ativa',
          dados: dadosValidos,
          atualizado_em: '2026-08-19T02:00:00.000Z',
          versao: '3.0'
        }
      ])
    });

    const res = await EscalaApi.carregarEscala({
      fetchImpl,
      supabaseUrl: 'https://fake-supabase.co',
      anonKey: 'fake-key'
    });

    expect(res.sucesso).toBe(true);
    expect(res.origem).toBe('supabase');
    expect(res.dados).toEqual(dadosValidos);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toContain('/rest/v1/escalas?id=eq.escala_ativa');
    expect(opts.headers.apikey).toBe('fake-key');
  });

  test('Camada 2: faz fallback para data/escala.json quando Supabase falhar', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 404, text: jest.fn().mockResolvedValue('Table not found') }) // Supabase escalas
      .mockResolvedValueOnce({ ok: false, status: 404, text: jest.fn().mockResolvedValue('No indicators') }) // Supabase indicators
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue(dadosValidos)
      }); // data/escala.json

    const res = await EscalaApi.carregarEscala({
      fetchImpl,
      supabaseUrl: 'https://fake-supabase.co',
      anonKey: 'fake-key',
      caminhoEstatico: 'data/escala.json'
    });

    expect(res.sucesso).toBe(true);
    expect(res.origem).toBe('github-static');
    expect(res.dados).toEqual(dadosValidos);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[2][0]).toContain('data/escala.json');
  });

  test('Camada 3: faz fallback para Backend quando Supabase e estático falharem', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: jest.fn().mockResolvedValue('Error') }) // Supabase escalas
      .mockResolvedValueOnce({ ok: false, status: 500, text: jest.fn().mockResolvedValue('Error') }) // Supabase indicators
      .mockResolvedValueOnce({ ok: false, status: 404, text: jest.fn().mockResolvedValue('Not found') }) // Estático
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValue({ sucesso: true, dados: dadosValidos, origem: 'backend' })
      }); // Backend

    const res = await EscalaApi.carregarEscala({
      fetchImpl,
      backendUrl: 'https://backend.coprede.com.br'
    });

    expect(res.sucesso).toBe(true);
    expect(res.origem).toBe('backend');
    expect(res.dados).toEqual(dadosValidos);
  });

  test('Camada 4: faz fallback para LocalStorage quando todas as redes falharem', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('Network offline'));
    const localStorageImpl = {
      getItem: jest.fn((key) => {
        if (key === 'escala_backup') return JSON.stringify(dadosValidos);
        if (key === 'escala_ultimo_salvamento') return '2026-08-19T01:00:00.000Z';
        return null;
      }),
      setItem: jest.fn()
    };

    const res = await EscalaApi.carregarEscala({
      fetchImpl,
      localStorageImpl
    });

    expect(res.sucesso).toBe(true);
    expect(res.origem).toBe('localstorage');
    expect(res.dados).toEqual(dadosValidos);
    expect(res.aviso).toContain('cache local');
  });

  test('Salvar escala: realiza upsert no Supabase e salva no LocalStorage', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: jest.fn().mockResolvedValue([])
    });
    const localStorageImpl = {
      setItem: jest.fn(),
      getItem: jest.fn()
    };

    const res = await EscalaApi.salvarEscala(dadosValidos, {
      fetchImpl,
      localStorageImpl,
      supabaseUrl: 'https://fake-supabase.co',
      anonKey: 'fake-key'
    });

    expect(res.sucesso).toBe(true);
    expect(res.salvouRemoto).toBe(true);
    expect(res.resultados.supabase).toBe(true);
    expect(res.resultados.localstorage).toBe(true);
    expect(localStorageImpl.setItem).toHaveBeenCalledWith('escala_backup', JSON.stringify(dadosValidos));
  });
});
