/**
 * Testes unitários da normalização e validação de topologia dos incidentes
 * (seção "Incidentes ativos por analista" / botão "Testar incidentes").
 *
 * O módulo backend/topologia.js é compartilhado entre o backend central
 * (server.js) e o helper local (local-visium-helper.js).
 */

const {
  normalizarTopologia,
  decodificarEntidades,
  pareceLogin,
  compactarCodigo,
  normalizarNapGponConsulta,
  extrairNodesTopologia,
  ehNodeHfcConsultaNode,
  reduzirNodesHfcRedundantes,
  tabelaCorrespondeNode,
  motivoGponPendente,
  erroGlobalVisium,
  escolherOpcao,
  parseCmr,
  lerTabelaVisium,
  classificarStatusConsultas,
  validarTopologias
} = require('../topologia');

describe('normalizarTopologia()', () => {
  test('remove acentos e converte para lowercase', () => {
    expect(normalizarTopologia('São PAULO')).toBe('sao paulo');
  });

  test('colapsa espaços múltiplos e apara as pontas', () => {
    expect(normalizarTopologia('  NÓ   ABC  ')).toBe('no abc');
  });

  test('trata null e undefined como string vazia', () => {
    expect(normalizarTopologia(null)).toBe('');
    expect(normalizarTopologia(undefined)).toBe('');
  });

  test('gera a mesma chave para variações do mesmo node (frontend x backend)', () => {
    expect(normalizarTopologia('NÓ-123 A')).toBe(normalizarTopologia('no-123   a'));
  });
});

describe('compactarCodigo()', () => {
  test('mantém apenas letras e dígitos em uppercase', () => {
    expect(compactarCodigo('nó-12a.b')).toBe('NO12AB');
  });

  test('string vazia e null viram vazio', () => {
    expect(compactarCodigo('')).toBe('');
    expect(compactarCodigo(null)).toBe('');
  });
});

describe('normalizarNapGponConsulta()', () => {
  test('troca o segmento 00 por M e remove separadores para consulta GPON', () => {
    expect(normalizarNapGponConsulta('ABC.DE.123.00.456')).toBe('ABCDE123M456');
    expect(normalizarNapGponConsulta('BC.DE.123.00.45')).toBe('BCDE123M45');
    expect(normalizarNapGponConsulta('ABC.DE.123.00,456')).toBe('ABCDE123M456');
    expect(normalizarNapGponConsulta('ABCDE12300456')).toBe('ABCDE123M456');
  });
});

describe('extrairNodesTopologia()', () => {
  test('separa por vírgula, ponto-e-vírgula e pipe', () => {
    expect(extrairNodesTopologia('NO123, AB456; CD789 | EF012')).toEqual(['NO123', 'AB456', 'CD789', 'EF012']);
  });

  test('remove duplicados', () => {
    expect(extrairNodesTopologia('NO123, NO123')).toEqual(['NO123']);
  });

  test('descarta partes com código compacto menor que 4 caracteres', () => {
    expect(extrairNodesTopologia('AB1, NO123')).toEqual(['NO123']);
  });

  test('valor único sem separador vira um node', () => {
    expect(extrairNodesTopologia('NO123')).toEqual(['NO123']);
  });

  test('nao separa virgula usada no sufixo GPON apos 00', () => {
    expect(extrairNodesTopologia('ABC.DE.123.00,456, BC.DE.123.00,45')).toEqual([
      'ABC.DE.123.00.456',
      'BC.DE.123.00.45'
    ]);
  });

  test('vazio retorna lista vazia', () => {
    expect(extrairNodesTopologia('')).toEqual([]);
    expect(extrairNodesTopologia(null)).toEqual([]);
  });
});

describe('ehNodeHfcConsultaNode()', () => {
  test('aceita node alfanumérico HFC inclusive acima de 8 caracteres', () => {
    expect(ehNodeHfcConsultaNode('AB12')).toBe(true);
    expect(ehNodeHfcConsultaNode('NO123456')).toBe(true);
    expect(ehNodeHfcConsultaNode('GRTABB1RP')).toBe(true);
  });

  test('rejeita NAP GPON com separadores', () => {
    expect(ehNodeHfcConsultaNode('NAP-01.23')).toBe(false);
    expect(ehNodeHfcConsultaNode('CTO_AB/12')).toBe(false);
  });

  test('rejeita códigos muito curtos ou muito longos', () => {
    expect(ehNodeHfcConsultaNode('AB1')).toBe(false);
    expect(ehNodeHfcConsultaNode('ABCDEFGHIJKLMNOPQ')).toBe(false);
  });

  test('mensagem GPON pendente cita o node', () => {
    expect(motivoGponPendente('NAP-01')).toContain('NAP-01');
  });
});

describe('reduzirNodesHfcRedundantes()', () => {
  test('consulta apenas o node-base quando derivações estão no mesmo incidente', () => {
    expect(reduzirNodesHfcRedundantes([
      'GRTABB', 'GRTABB1RP', 'GRTABB2RP', 'GRTABB2RR', 'GRTABA2', 'GRTABA1', 'GRTABA'
    ])).toEqual(['GRTABB', 'GRTABA']);
  });

  test('preserva nodes independentes com prefixos diferentes', () => {
    expect(reduzirNodesHfcRedundantes(['AC1J', 'AC1M', 'AC1N'])).toEqual(['AC1J', 'AC1M', 'AC1N']);
  });
});

describe('tabelaCorrespondeNode()', () => {
  test('aceita subnodes pertencentes ao node solicitado', () => {
    expect(tabelaCorrespondeNode({
      found: true,
      subnodes: [{ name: 'AC1J-1' }, { name: 'AC1J-2' }]
    }, 'AC1J')).toBe(true);
  });

  test('rejeita tabela deixada pela consulta anterior', () => {
    expect(tabelaCorrespondeNode({
      found: true,
      subnodes: [{ name: 'AC1N-1' }, { name: 'AC1N-2' }]
    }, 'AC1J')).toBe(false);
  });
});

describe('erroGlobalVisium()', () => {
  test('timeout, VPN e login derrubam o ciclo inteiro', () => {
    expect(erroGlobalVisium('timeout ao acessar Visium (25000ms)')).toBe(true);
    expect(erroGlobalVisium('request to http://x failed, reason: ECONNREFUSED')).toBe(true);
    expect(erroGlobalVisium('Visium HTTP 502')).toBe(true);
    expect(erroGlobalVisium('Visium exigiu login/sessao')).toBe(true);
    expect(erroGlobalVisium('login no Vision HFC nao concluido dentro do tempo limite')).toBe(true);
  });

  test('erro pontual de um node não é global', () => {
    expect(erroGlobalVisium('node nao encontrado no HFC/ConsultaInterfaceNode: NO123')).toBe(false);
    expect(erroGlobalVisium('')).toBe(false);
  });
});

describe('decodificarEntidades() / pareceLogin()', () => {
  test('decodifica entidades HTML comuns', () => {
    expect(decodificarEntidades('a&nbsp;&amp;&nbsp;b &lt;x&gt; &quot;c&quot; &#39;d&#39;')).toBe("a & b <x> \"c\" 'd'");
  });

  test('detecta página de login', () => {
    expect(pareceLogin('<label>Usuário</label><input type=password placeholder=Senha>login')).toBe(true);
    expect(pareceLogin('Consulta Interface Node')).toBe(false);
  });
});

describe('escolherOpcao()', () => {
  const opcoes = [
    { value: '0', text: 'Selecione...' },
    { value: '1', text: 'RIO DE JANEIRO' },
    { value: '2', text: 'NO-123 CENTRO' },
    { value: '3', text: 'BELÉM' }
  ];

  test('ignora opção "Selecione"', () => {
    expect(escolherOpcao(opcoes, 'selecione')).toBeNull();
  });

  test('match exato normalizado (ignora acento)', () => {
    expect(escolherOpcao(opcoes, 'belem')).toEqual({ value: '3', text: 'BELÉM' });
  });

  test('match por código compacto', () => {
    expect(escolherOpcao(opcoes, 'no123centro')).toEqual({ value: '2', text: 'NO-123 CENTRO' });
  });

  test('match parcial', () => {
    expect(escolherOpcao(opcoes, 'rio de janeiro - capital')).toEqual({ value: '1', text: 'RIO DE JANEIRO' });
  });

  test('sem candidato retorna null', () => {
    expect(escolherOpcao(opcoes, 'manaus')).toBeNull();
  });
});

describe('parseCmr()', () => {
  test('número com separador de milhar', () => {
    expect(parseCmr('1.234')).toBe(1234);
  });

  test('zero é válido (indica node down)', () => {
    expect(parseCmr('0')).toBe(0);
  });

  test('descarta casas decimais após vírgula', () => {
    expect(parseCmr('12,5')).toBe(12);
  });

  test('traço, travessão e vazio viram null', () => {
    expect(parseCmr('-')).toBeNull();
    expect(parseCmr('—')).toBeNull();
    expect(parseCmr('')).toBeNull();
    expect(parseCmr('abc')).toBeNull();
  });
});

describe('lerTabelaVisium()', () => {
  function tabela(linhas) {
    const tr = linhas.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<html><table><tr><th>ID</th><th>NODE</th><th>CM-R</th></tr>${tr}</table></html>`;
  }

  test('agrupa linhas por node e marca UP quando todos os CM-R > 0', () => {
    const html = tabela([
      ['1', 'NO123', '10'],
      ['2', 'NO123', '5'],
      ['3', 'AB456', '7']
    ]);
    const resultado = lerTabelaVisium(html);
    expect(resultado.found).toBe(true);
    expect(resultado.rows).toBe(3);
    expect(resultado.subnodes).toEqual([
      { name: 'AB456', up: true, rows: 1, downRows: 0, cmrs: [7] },
      { name: 'NO123', up: true, rows: 2, downRows: 0, cmrs: [10, 5] }
    ]);
  });

  test('CM-R igual a 0 marca o subnode como down', () => {
    const html = tabela([
      ['1', 'NO123', '0'],
      ['2', 'NO123', '8']
    ]);
    const resultado = lerTabelaVisium(html);
    expect(resultado.subnodes[0].up).toBe(false);
    expect(resultado.subnodes[0].downRows).toBe(1);
  });

  test('linhas com CM-R inválido são ignoradas', () => {
    const html = tabela([
      ['1', 'NO123', '-'],
      ['2', 'NO123', '3']
    ]);
    const resultado = lerTabelaVisium(html);
    expect(resultado.rows).toBe(1);
    expect(resultado.subnodes[0].cmrs).toEqual([3]);
  });

  test('html sem tabela de dados retorna found=false', () => {
    expect(lerTabelaVisium('<html><p>vazio</p></html>')).toEqual({ found: false, subnodes: [], rows: 0 });
    expect(lerTabelaVisium('')).toEqual({ found: false, subnodes: [], rows: 0 });
  });
});

describe('classificarStatusConsultas()', () => {
  test('qualquer node down => down (mesmo com outro indeterminado)', () => {
    const { status } = classificarStatusConsultas([
      { status: 'down' },
      { status: 'indeterminado' }
    ]);
    expect(status).toBe('down');
  });

  test('todos consultados e up => up', () => {
    const { status, motivo } = classificarStatusConsultas([
      { status: 'up' },
      { status: 'up' }
    ]);
    expect(status).toBe('up');
    expect(motivo).toBeNull();
  });

  test('up parcial com node sem diagnóstico => indeterminado', () => {
    const { status } = classificarStatusConsultas([
      { status: 'up' },
      { status: 'indeterminado', erro: 'timeout' }
    ]);
    expect(status).toBe('indeterminado');
  });

  test('GPON pendente gera motivo específico', () => {
    const { status, motivo } = classificarStatusConsultas([
      { status: 'indeterminado', tipo: 'gpon-pendente' }
    ]);
    expect(status).toBe('indeterminado');
    expect(motivo).toMatch(/GPON/);
  });

  test('lista vazia => indeterminado', () => {
    expect(classificarStatusConsultas([]).status).toBe('indeterminado');
  });
});

describe('validarTopologias() — ciclo compartilhado', () => {
  test('consulta cada node HFC e classifica a topologia', async () => {
    const consultarNode = jest.fn()
      .mockResolvedValueOnce({ node: 'NO123', cidade: 'RIO', status: 'up' })
      .mockResolvedValueOnce({ node: 'AB456', cidade: 'RIO', status: 'down' });

    const { resultados, falhaGlobalVisium } = await validarTopologias(
      [{ id: 'INC1', topologia: 'NO123, AB456', cidade: 'RIO' }],
      { consultarNode }
    );

    expect(consultarNode).toHaveBeenCalledTimes(2);
    expect(resultados).toHaveLength(1);
    expect(resultados[0].status).toBe('down');
    expect(resultados[0].nodes).toEqual(['NO123', 'AB456']);
    expect(falhaGlobalVisium).toBeNull();
  });

  test('reduz derivações HFC e não envia node alfanumérico longo ao GPON', async () => {
    const consultarNode = jest.fn().mockResolvedValue({ status: 'up' });
    const consultarGpon = jest.fn();

    const { resultados } = await validarTopologias(
      [{
        topologia: 'GRTABB,GRTABB1RP,GRTABB2RP,GRTABB2RR,GRTABB1RR,GRTABA2,GRTABA1,GRTABA',
        cidade: 'RIO DE JANEIRO'
      }],
      { consultarNode, consultarGpon }
    );

    expect(consultarNode.mock.calls).toEqual([
      ['RIO DE JANEIRO', 'GRTABB'],
      ['RIO DE JANEIRO', 'GRTABA']
    ]);
    expect(consultarGpon).not.toHaveBeenCalled();
    expect(resultados[0].status).toBe('up');
  });

  test('node GPON não é consultado no HFC (filtro compartilhado)', async () => {
    const consultarNode = jest.fn().mockResolvedValue({ status: 'up' });

    const { resultados, avisos } = await validarTopologias(
      [{ topologia: 'NAP-01.23', cidade: 'RIO' }],
      { consultarNode }
    );

    expect(consultarNode).not.toHaveBeenCalled();
    expect(resultados[0].status).toBe('indeterminado');
    expect(resultados[0].motivo).toMatch(/GPON/);
    expect(avisos[0]).toMatch(/GPON pendente/);
  });

  test('consulta GPON quando motor GPON é fornecido', async () => {
    const consultarNode = jest.fn();
    const consultarGpon = jest.fn().mockResolvedValue({
      naps: [
        { nap: 'CNTAA09200010', total: 4, online: 3, offline: 1, unknown: 0, ratio: 0.75, up: true },
        { nap: 'CNTAA09200020', total: 4, online: 1, offline: 3, unknown: 0, ratio: 0.25, up: false }
      ],
      rows: 8,
      sourceUrl: 'http://201.55.234.76:8080/ConsultasGPON_/ConsultaOntLista',
      modo: 'browser-gpon'
    });

    const { resultados, avisos } = await validarTopologias(
      [{ topologia: 'CNT.AA.092.00.010, CNT.AA.092.00.020', cidade: 'VILA VELHA' }],
      { consultarNode, consultarGpon }
    );

    expect(consultarNode).not.toHaveBeenCalled();
    expect(consultarGpon).toHaveBeenCalledWith('VILA VELHA', ['CNT.AA.092.00.010', 'CNT.AA.092.00.020'], expect.any(Object));
    expect(resultados[0].status).toBe('down');
    expect(resultados[0].consultas).toEqual(expect.arrayContaining([
      expect.objectContaining({ node: 'CNT.AA.092.00.010', status: 'up', tipo: 'gpon', online: 3, total: 4 }),
      expect.objectContaining({ node: 'CNT.AA.092.00.020', status: 'down', tipo: 'gpon', online: 1, total: 4 })
    ]));
    expect(avisos).toEqual([]);
  });

  test('falha global (timeout/VPN) interrompe o ciclo e é reportada', async () => {
    const consultarNode = jest.fn().mockRejectedValue(new Error('timeout ao acessar Visium (25000ms)'));

    const { resultados, falhaGlobalVisium } = await validarTopologias(
      [
        { topologia: 'NO123', cidade: 'RIO' },
        { topologia: 'AB456', cidade: 'BELEM' }
      ],
      { consultarNode }
    );

    // após a primeira falha global, os demais nodes não são consultados
    expect(consultarNode).toHaveBeenCalledTimes(1);
    expect(falhaGlobalVisium).toMatch(/timeout/);
    expect(resultados.every((r) => r.status === 'indeterminado')).toBe(true);
  });

  test('erro pontual de um node não derruba o restante do ciclo', async () => {
    const consultarNode = jest.fn()
      .mockRejectedValueOnce(new Error('node nao encontrado no HFC/ConsultaInterfaceNode: NO999'))
      .mockResolvedValueOnce({ node: 'AB456', cidade: 'RIO', status: 'up' });

    const { resultados, falhaGlobalVisium } = await validarTopologias(
      [
        { topologia: 'NO999', cidade: 'RIO' },
        { topologia: 'AB456', cidade: 'RIO' }
      ],
      { consultarNode }
    );

    expect(consultarNode).toHaveBeenCalledTimes(2);
    expect(falhaGlobalVisium).toBeNull();
    expect(resultados[0].status).toBe('indeterminado');
    expect(resultados[1].status).toBe('up');
  });

  test('incidente sem cidade fica indeterminado sem consultar o Visium', async () => {
    const consultarNode = jest.fn();

    const { resultados } = await validarTopologias(
      [{ topologia: 'NO123' }],
      { consultarNode }
    );

    expect(consultarNode).not.toHaveBeenCalled();
    expect(resultados[0].status).toBe('indeterminado');
    expect(resultados[0].motivo).toMatch(/cidade ausente/);
  });

  test('itens sem topologia são descartados', async () => {
    const consultarNode = jest.fn();

    const { resultados } = await validarTopologias(
      [{ topologia: '' }, { topologia: '   ' }, null],
      { consultarNode }
    );

    expect(resultados).toEqual([]);
    expect(consultarNode).not.toHaveBeenCalled();
  });

  test('aceita cidade no campo nm_cidade (formato do Supabase)', async () => {
    const consultarNode = jest.fn().mockResolvedValue({ status: 'up' });

    const { resultados } = await validarTopologias(
      [{ topologia: 'NO123', nm_cidade: 'RIO DE JANEIRO' }],
      { consultarNode }
    );

    expect(consultarNode).toHaveBeenCalledWith('RIO DE JANEIRO', 'NO123');
    expect(resultados[0].status).toBe('up');
  });
});
