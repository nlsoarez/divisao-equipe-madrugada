const {
  AREAS_RESIDENCIAIS,
  normalizarAreaManual,
  montarDivisaoManual,
  encontrarGrupoDaArea
} = require('../../js/area-editor');

describe('edição manual de áreas residenciais', () => {
  test('normaliza combinações digitadas com espaços e letras minúsculas', () => {
    expect(normalizarAreaManual(' co / mg ')).toEqual({
      valido: true,
      area: 'CO/MG',
      areas: ['CO', 'MG']
    });
  });

  test.each(['CO//MG', 'CO/MG/MG'])('rejeita grupo inválido: %s', grupo => {
    expect(normalizarAreaManual(grupo).valido).toBe(false);
  });

  test('aceita texto livre fora das siglas conhecidas', () => {
    expect(normalizarAreaManual(' apoio backbone ')).toEqual({
      valido: true,
      area: 'APOIO BACKBONE',
      areas: []
    });
  });

  test('monta uma configuração manual completa com CO/MG', () => {
    const resultado = montarDivisaoManual([
      { area: 'CO/MG', pessoa1: 'Cristiane' },
      { area: 'NO/ES', pessoa1: 'Leonardo' },
      { area: 'NE/BA', pessoa1: 'Raissa' },
      { area: 'RIO', pessoa1: 'Thiago' }
    ]);

    expect(resultado).toEqual({
      valido: true,
      divisao: {
        'CO/MG': 'Cristiane',
        'NO/ES': 'Leonardo',
        'NE/BA': 'Raissa',
        RIO: 'Thiago'
      }
    });
  });

  test('impede que uma sigla conhecida apareça em mais de um bloco', () => {
    const duplicada = montarDivisaoManual([
      { area: 'CO/MG', pessoa1: 'Cristiane' },
      { area: 'CO/NO/ES', pessoa1: 'Leonardo' },
      { area: 'NE/BA', pessoa1: 'Raissa' },
      { area: 'RIO', pessoa1: 'Thiago' }
    ]);
    expect(duplicada.valido).toBe(false);
    expect(duplicada.erro).toContain('CO aparece em mais de um grupo');
  });

  test('ignora linha com área vazia e mantém somente três blocos', () => {
    const resultado = montarDivisaoManual([
      { area: 'BA/CO', pessoa1: 'Cristiane' },
      { area: 'NO/NE', pessoa1: 'Leonardo' },
      { area: 'MG/ES/RIO', pessoa1: 'Raissa', pessoa2: 'Thiago' },
      { area: '   ', pessoa1: 'Thiago' }
    ]);

    expect(resultado.valido).toBe(true);
    expect(resultado.divisao).toEqual({
      'BA/CO': 'Cristiane',
      'NO/NE': 'Leonardo',
      'MG/ES/RIO': 'Raissa / Thiago'
    });
    expect(Object.keys(resultado.divisao)).toHaveLength(3);
  });

  test('localiza a combinação manual responsável por uma área', () => {
    const divisao = {
      'CO/MG': 'Cristiane',
      'NO/ES': 'Leonardo',
      'NE/BA': 'Raissa',
      RIO: 'Thiago'
    };

    expect(encontrarGrupoDaArea('MG', divisao)).toBe('CO/MG');
    expect(encontrarGrupoDaArea('ES', divisao)).toBe('NO/ES');
    expect(encontrarGrupoDaArea(AREAS_RESIDENCIAIS[5], divisao)).toBe('RIO');
  });

  test('preserva a atribuição fixa SIR/APOIO fora da partição regional', () => {
    const resultado = montarDivisaoManual([
      { area: 'CO/NO', pessoa1: 'Cristiane' },
      { area: 'NE/BA', pessoa1: 'Raissa' },
      { area: 'MG/ES', pessoa1: 'Leonardo' },
      { area: 'RIO', pessoa1: 'Thiago', pessoa2: 'Alan' },
      { area: 'SIR/APOIO', pessoa1: 'Marcelo Almeida', fixa: true }
    ]);

    expect(resultado.valido).toBe(true);
    expect(resultado.divisao['SIR/APOIO']).toBe('Marcelo Almeida');
  });
});
