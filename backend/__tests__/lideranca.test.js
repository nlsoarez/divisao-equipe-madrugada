const LiderancaEscala = require('../../js/lideranca');

describe('escala de liderança técnica', () => {
  test('usa os líderes padrão em dia útil', () => {
    expect(LiderancaEscala.resolverDia('2026-10-19', {})).toEqual({
      tipo: 'dia_util',
      geral: '',
      residencial: 'Kelly / Marley',
      rio_es: 'Leandro',
      leste: 'Bruno'
    });
  });

  test('Leandro assume as duas áreas empresariais quando Bruno folga', () => {
    const dia = LiderancaEscala.resolverDia('2026-10-19', { folgas: ['Bruno'] });
    expect(dia.leste).toBe('Leandro');
    expect(dia.rio_es).toBe('Leandro');
  });

  test('Bruno assume as duas áreas empresariais quando Leandro folga', () => {
    const dia = LiderancaEscala.resolverDia('2026-10-19', { folgas: ['Leandro'] });
    expect(dia.leste).toBe('Bruno');
    expect(dia.rio_es).toBe('Bruno');
  });

  test('Marley assume empresarial e Kelly residencial quando os dois folgam', () => {
    const dia = LiderancaEscala.resolverDia('2026-10-19', { folgas: ['Bruno', 'Leandro'] });
    expect(dia.leste).toBe('Marley');
    expect(dia.rio_es).toBe('Marley');
    expect(dia.residencial).toBe('Kelly');
  });

  test('um único líder atende todas as áreas no fim de semana', () => {
    const dia = LiderancaEscala.resolverDia('2026-10-18', { liderGeral: 'Bruno' });
    expect(dia.residencial).toBe('Bruno');
    expect(dia.rio_es).toBe('Bruno');
    expect(dia.leste).toBe('Bruno');
  });

  test('feriado em dia útil também usa um único líder', () => {
    const dia = LiderancaEscala.resolverDia('2026-10-19', { feriado: true, liderGeral: 'Kelly' });
    expect(dia.tipo).toBe('feriado');
    expect(dia.residencial).toBe('Kelly');
    expect(dia.rio_es).toBe('Kelly');
    expect(dia.leste).toBe('Kelly');
  });

  test('importa a mesma estrutura processada da planilha dos analistas', () => {
    const dados = {};
    for (let dia = 1; dia <= 31; dia++) {
      const fimDeSemana = [0, 6].includes(new Date(2026, 9, dia, 12).getDay());
      dados[dia] = {
        trabalhando: fimDeSemana ? ['Kelly Lira'] : ['Bruno Silva', 'Leandro Souza', 'Kelly Lira', 'Marley Lima'],
        ausentes: fimDeSemana
          ? [{ nome: 'Bruno Silva' }, { nome: 'Leandro Souza' }, { nome: 'Marley Lima' }]
          : []
      };
    }
    dados[19] = {
      trabalhando: ['Kelly Lira', 'Marley Lima'],
      ausentes: [{ nome: 'Bruno Silva' }, { nome: 'Leandro Souza' }]
    };

    const resultado = LiderancaEscala.importarCalendario(dados, 2026, 9);
    expect(resultado.erros).toEqual([]);
    expect(resultado.dias['2026-10-18'].liderGeral).toBe('Kelly');
    expect(resultado.dias['2026-10-19'].folgas).toEqual(['Bruno', 'Leandro']);
    expect(LiderancaEscala.resolverDia('2026-10-19', resultado.dias['2026-10-19']).leste).toBe('Marley');
  });

  test('recusa fim de semana com mais de um líder trabalhando', () => {
    const dados = {};
    for (let dia = 1; dia <= 31; dia++) {
      dados[dia] = {
        trabalhando: ['Bruno', 'Leandro', 'Kelly', 'Marley'],
        ausentes: []
      };
    }
    const resultado = LiderancaEscala.importarCalendario(dados, 2026, 9);
    expect(resultado.erros).toContain('Dia 3: fim de semana deve ter exatamente 1 líder, mas foram encontrados 4');
  });
});
