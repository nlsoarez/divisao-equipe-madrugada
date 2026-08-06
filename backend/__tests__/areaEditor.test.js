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

  test.each(['SIR', 'CO//MG', 'CO/MG/MG'])('rejeita grupo inválido: %s', grupo => {
    expect(normalizarAreaManual(grupo).valido).toBe(false);
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

  test('exige cada uma das sete áreas exatamente uma vez', () => {
    const duplicada = montarDivisaoManual([
      { area: 'CO/MG', pessoa1: 'Cristiane' },
      { area: 'CO/NO/ES', pessoa1: 'Leonardo' },
      { area: 'NE/BA', pessoa1: 'Raissa' },
      { area: 'RIO', pessoa1: 'Thiago' }
    ]);
    expect(duplicada.valido).toBe(false);
    expect(duplicada.erro).toContain('CO aparece em mais de um grupo');

    const ausente = montarDivisaoManual([
      { area: 'CO/MG', pessoa1: 'Cristiane' },
      { area: 'ES', pessoa1: 'Leonardo' },
      { area: 'NE/BA', pessoa1: 'Raissa' },
      { area: 'RIO', pessoa1: 'Thiago' }
    ]);
    expect(ausente.valido).toBe(false);
    expect(ausente.erro).toContain('Faltando: NO');
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
      { area: 'SIR/APOIO', pessoa1: 'Maristella', fixa: true }
    ]);

    expect(resultado.valido).toBe(true);
    expect(resultado.divisao['SIR/APOIO']).toBe('Maristella');
  });
});
