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
});
