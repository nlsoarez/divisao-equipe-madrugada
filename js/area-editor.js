(function (globalScope) {
  'use strict';

  const AREAS_RESIDENCIAIS = Object.freeze(['CO', 'NO', 'NE', 'BA', 'ES', 'RIO', 'MG']);
  const GRUPOS_FIXOS_RESIDENCIAIS = Object.freeze(['SIR/APOIO']);

  const ALIASES_AREAS = Object.freeze({
    CO: 'CO',
    'CENTRO OESTE': 'CO',
    'CENTRO-OESTE': 'CO',
    NO: 'NO',
    NORTE: 'NO',
    NE: 'NE',
    NORDESTE: 'NE',
    BA: 'BA',
    BAHIA: 'BA',
    SERGIPE: 'BA',
    ES: 'ES',
    'ESPIRITO SANTO': 'ES',
    RIO: 'RIO',
    'RIO DE JANEIRO': 'RIO',
    MG: 'MG',
    'MINAS GERAIS': 'MG'
  });

  function removerAcentos(valor) {
    return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function extrairAreasConhecidas(segmentos) {
    const encontradas = [];

    segmentos.forEach(segmento => {
      const alias = removerAcentos(segmento).toUpperCase().replace(/\s+/g, ' ').trim();
      const area = ALIASES_AREAS[alias];
      if (area) encontradas.push(area);
    });

    return encontradas;
  }

  function normalizarAreaManual(valor) {
    const areaLivre = String(valor || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');

    if (!areaLivre) {
      return { valido: false, vazio: true, erro: 'Informe a área ou deixe a linha em branco para desconsiderá-la.' };
    }

    if (areaLivre.length > 80) {
      return { valido: false, erro: 'O texto da área deve ter no máximo 80 caracteres.' };
    }

    if (/[<>]/.test(areaLivre)) {
      return { valido: false, erro: 'Não use os caracteres < ou > no texto da área.' };
    }

    const segmentos = areaLivre
      .split('/')
      .map(area => area.trim());

    if (segmentos.length === 0 || segmentos.some(area => !area)) {
      return { valido: false, erro: 'Não deixe trechos vazios entre as barras (/).' };
    }

    const areasConhecidas = extrairAreasConhecidas(segmentos);

    const repetida = areasConhecidas.find((area, indice) => areasConhecidas.indexOf(area) !== indice);
    if (repetida) {
      return { valido: false, erro: `A área ${repetida} está repetida no mesmo grupo.` };
    }

    return {
      valido: true,
      area: segmentos.join('/'),
      areas: areasConhecidas
    };
  }

  function montarDivisaoManual(linhas) {
    if (!Array.isArray(linhas) || linhas.length === 0) {
      return { valido: false, erro: 'A divisão precisa ter pelo menos um grupo de áreas.' };
    }

    const divisao = {};
    const areasUtilizadas = new Set();
    let gruposRegionais = 0;

    for (let indice = 0; indice < linhas.length; indice++) {
      const linha = linhas[indice] || {};
      const areaInformada = String(linha.area || '').trim().toUpperCase();
      const pessoa1 = String(linha.pessoa1 || '').trim();
      const pessoa2 = String(linha.pessoa2 || '').trim();

      // Uma linha sem área não representa um bloco e não participa da divisão,
      // mesmo que ainda haja uma pessoa selecionada no formulário.
      if (!linha.fixa && !areaInformada) continue;

      if (!pessoa1 && !pessoa2) {
        return { valido: false, erro: `Selecione ao menos uma pessoa para ${areaInformada || `o grupo ${indice + 1}`}.` };
      }

      if (pessoa1 && pessoa2 && pessoa1 === pessoa2) {
        return { valido: false, erro: `Selecione pessoas diferentes para ${areaInformada || `o grupo ${indice + 1}`}.` };
      }

      if (linha.fixa) {
        if (!GRUPOS_FIXOS_RESIDENCIAIS.includes(areaInformada)) {
          return { valido: false, erro: `Grupo fixo inválido: ${areaInformada}.` };
        }
        if (Object.prototype.hasOwnProperty.call(divisao, areaInformada)) {
          return { valido: false, erro: `O grupo ${areaInformada} está repetido.` };
        }
        divisao[areaInformada] = pessoa1 && pessoa2 ? `${pessoa1} / ${pessoa2}` : pessoa1 || pessoa2;
        continue;
      }

      const resultadoArea = normalizarAreaManual(areaInformada);

      if (!resultadoArea.valido) {
        return { valido: false, erro: `Grupo ${indice + 1}: ${resultadoArea.erro}` };
      }

      for (const area of resultadoArea.areas) {
        if (areasUtilizadas.has(area)) {
          return { valido: false, erro: `A área ${area} aparece em mais de um grupo.` };
        }
        areasUtilizadas.add(area);
      }

      if (Object.prototype.hasOwnProperty.call(divisao, resultadoArea.area)) {
        return { valido: false, erro: `O grupo ${resultadoArea.area} está repetido.` };
      }

      divisao[resultadoArea.area] = pessoa1 && pessoa2
        ? `${pessoa1} / ${pessoa2}`
        : pessoa1 || pessoa2;
      gruposRegionais++;
    }

    if (gruposRegionais === 0) {
      return { valido: false, erro: 'A divisão precisa ter pelo menos um bloco de área preenchido.' };
    }

    return { valido: true, divisao };
  }

  function encontrarGrupoDaArea(area, divisao) {
    const areaNormalizada = String(area || '').trim().toUpperCase();
    if (!AREAS_RESIDENCIAIS.includes(areaNormalizada) || !divisao) return null;

    for (const grupo of Object.keys(divisao)) {
      const resultado = normalizarAreaManual(grupo);
      if (resultado.valido && resultado.areas.includes(areaNormalizada)) return resultado.area;
    }

    return null;
  }

  const api = {
    AREAS_RESIDENCIAIS,
    GRUPOS_FIXOS_RESIDENCIAIS,
    normalizarAreaManual,
    montarDivisaoManual,
    encontrarGrupoDaArea
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.AreaEditor = api;
})(typeof window !== 'undefined' ? window : globalThis);
