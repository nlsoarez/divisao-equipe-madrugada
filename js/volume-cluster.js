(function (globalScope) {
  'use strict';

  const ORDEM_CLUSTERS = Object.freeze(['CO', 'NO', 'NE', 'BA', 'MG', 'ES', 'RIO']);

  function normalizarTexto(valor) {
    return String(valor || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  function identificarClusterBase(grupo) {
    const texto = normalizarTexto(grupo);
    if (!texto) return null;

    const isVitoria = texto === 'vitoria';
    const isRio = texto.includes('rio');
    const isES = isVitoria || texto.includes('espirito santo') || texto === 'es' || texto.includes(' es');
    const isMG = texto.includes('minas') || texto === 'mg' || texto.includes(' mg') ||
      texto.includes('bh capital') || texto.includes('belo horizonte') || texto === 'bh' || texto.startsWith('bh ');
    const isBA = texto.includes('bahia') || texto.includes('sergipe') || texto === 'ba' || texto.includes(' ba') ||
      texto === 'se' || texto.includes(' se');
    const isNE = texto.includes('nordeste') || texto === 'ne' || texto.includes(' ne');
    const isCO = texto.includes('centro oeste') || texto.includes('centro-oeste') || texto === 'co';
    const isNO = !isNE && (texto.includes('norte') || texto === 'no');

    if (isRio) return 'RIO';
    if (isES) return 'ES';
    if (isMG) return 'MG';
    if (isBA) return 'BA';
    if (isNE) return 'NE';
    if (isCO) return 'CO';
    if (isNO) return 'NO';
    return null;
  }

  function contarOutagesPorCluster(ofensores, obterCluster) {
    const clusters = Object.fromEntries(ORDEM_CLUSTERS.map(cluster => [cluster, 0]));
    let outros = 0;
    const extrairCluster = typeof obterCluster === 'function'
      ? obterCluster
      : incidente => incidente?.grupo || incidente?.cluster || incidente?.regional || '';

    for (const incidente of Array.isArray(ofensores) ? ofensores : []) {
      const cluster = identificarClusterBase(extrairCluster(incidente));
      if (cluster) clusters[cluster]++;
      else outros++;
    }

    return { clusters, outros };
  }

  const api = { ORDEM_CLUSTERS, identificarClusterBase, contarOutagesPorCluster };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.VolumeCluster = api;
})(typeof window !== 'undefined' ? window : globalThis);
