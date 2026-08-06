(function (globalScope) {
  'use strict';

  const AREAS_RESIDENCIAIS = Object.freeze(['CO', 'NO', 'NE', 'BA', 'ES', 'RIO', 'MG']);
  const GRUPOS_FIXOS_RESIDENCIAIS = Object.freeze(['SIR/APOIO']);

  function normalizarAreaManual(valor) {
    const segmentos = String(valor || '')
      .toUpperCase()
      .split('/')
      .map(area => area.trim());

    if (segmentos.length === 0 || segmentos.some(area => !area)) {
      return { valido: false, erro: 'Informe uma ou mais áreas separadas por /.' };
    }

    const invalidas = segmentos.filter(area => !AREAS_RESIDENCIAIS.includes(area));
    if (invalidas.length > 0) {
      return {
        valido: false,
        erro: `Área inválida: ${invalidas[0]}. Use apenas ${AREAS_RESIDENCIAIS.join(', ')}.`
      };
    }

    const repetida = segmentos.find((area, indice) => segmentos.indexOf(area) !== indice);
    if (repetida) {
      return { valido: false, erro: `A área ${repetida} está repetida no mesmo grupo.` };
    }

    return {
      valido: true,
      area: segmentos.join('/'),
      areas: segmentos
    };
  }

  function montarDivisaoManual(linhas) {
    if (!Array.isArray(linhas) || linhas.length === 0) {
      return { valido: false, erro: 'A divisão precisa ter pelo menos um grupo de áreas.' };
    }

    const divisao = {};
    const areasUtilizadas = new Set();

    for (let indice = 0; indice < linhas.length; indice++) {
      const linha = linhas[indice] || {};
      const areaInformada = String(linha.area || '').trim().toUpperCase();
      const pessoa1 = String(linha.pessoa1 || '').trim();
      const pessoa2 = String(linha.pessoa2 || '').trim();

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
    }

    const areasAusentes = AREAS_RESIDENCIAIS.filter(area => !areasUtilizadas.has(area));
    if (areasAusentes.length > 0) {
      return {
        valido: false,
        erro: `Inclua todas as áreas na divisão. Faltando: ${areasAusentes.join(', ')}.`
      };
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
