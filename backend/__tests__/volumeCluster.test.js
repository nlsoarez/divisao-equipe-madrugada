const {
  ORDEM_CLUSTERS,
  identificarClusterBase,
  contarOutagesPorCluster
} = require('../../js/volume-cluster');

describe('volumetria atômica por cluster', () => {
  test.each([
    ['Centro Oeste', 'CO'],
    ['Norte', 'NO'],
    ['Nordeste', 'NE'],
    ['Bahia / Sergipe', 'BA'],
    ['BH Capital', 'MG'],
    ['Vitória', 'ES'],
    ['Rio Capital', 'RIO']
  ])('identifica %s como %s', (origem, esperado) => {
    expect(identificarClusterBase(origem)).toBe(esperado);
  });

  test('conta cada cluster antes de qualquer combinação de áreas', () => {
    const outages = [
      { grupo: 'Bahia' },
      { grupo: 'Bahia / Sergipe' },
      { grupo: 'Centro Oeste' },
      { grupo: 'Norte' },
      { grupo: 'Norte' },
      { grupo: 'Cluster desconhecido' }
    ];

    const resultado = contarOutagesPorCluster(outages, outage => outage.grupo);

    expect(ORDEM_CLUSTERS).toEqual(['CO', 'NO', 'NE', 'BA', 'MG', 'ES', 'RIO']);
    expect(resultado.clusters).toMatchObject({ CO: 1, NO: 2, NE: 0, BA: 2, MG: 0, ES: 0, RIO: 0 });
    expect(resultado.outros).toBe(1);
  });

  test('não depende da quantidade ou composição dos blocos finais', () => {
    const outages = [{ cluster: 'BA' }, { cluster: 'CO' }, { cluster: 'BA' }];
    const resultado = contarOutagesPorCluster(outages);

    expect(resultado.clusters.BA + resultado.clusters.CO).toBe(3);
    expect(resultado.clusters.BA).toBe(2);
    expect(resultado.clusters.CO).toBe(1);
  });
});
