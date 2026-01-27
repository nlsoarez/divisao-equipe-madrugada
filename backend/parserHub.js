/**
 * Parser para mensagens de Alocação de HUB
 * Processa dois formatos: DIURNO e MADRUGADA
 */

const { MESSAGE_TITLES } = require('./config');

/**
 * Identifica o tipo de mensagem de alocação
 * @param {string} texto - Texto da mensagem
 * @returns {string|null} - 'DIURNO', 'MADRUGADA' ou null
 */
function identificarTipoAlocacao(texto) {
  if (!texto) return null;

  const textoUpper = texto.toUpperCase();

  if (textoUpper.includes('ALOCAÇÃO TÉCNICA HUBS/RJO DIURNO') ||
      textoUpper.includes('ALOCACAO TECNICA HUBS/RJO DIURNO')) {
    return 'DIURNO';
  }

  if (textoUpper.includes('ALOCAÇÃO TÉCNICA HUBS/RJO MADRUGADA') ||
      textoUpper.includes('ALOCACAO TECNICA HUBS/RJO MADRUGADA')) {
    return 'MADRUGADA';
  }

  return null;
}

/**
 * Extrai a data da mensagem de alocação
 * @param {string} texto - Texto da mensagem
 * @returns {string|null} - Data no formato DD/MM ou null
 */
function extrairDataAlocacao(texto) {
  // Procura por padrões como "DIURNO 26/01:" ou "MADRUGADA 27/01:"
  const match = texto.match(/(?:DIURNO|MADRUGADA)\s+(\d{1,2}\/\d{1,2})/i);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * Processa mensagem de alocação DIURNO
 * @param {string} texto - Texto da mensagem
 * @returns {Object} - Dados extraídos
 */
function processarDiurno(texto) {
  const regioes = {};
  const folgas = [];

  // Divide por seções (usando _____ como separador)
  const secoes = texto.split(/_{3,}/);

  let regiaoAtual = null;

  for (const secao of secoes) {
    const linhas = secao.trim().split('\n').filter(l => l.trim());

    for (const linha of linhas) {
      const linhaLimpa = linha.trim();

      // Ignora linhas de cabeçalho
      if (linhaLimpa.toUpperCase().includes('ALOCAÇÃO TÉCNICA')) continue;

      // Detecta região
      const regiaoMatch = linhaLimpa.match(/^(NORTE|SUL|METROPOLITANA|OESTE|BAIXADA|LESTE|CENTRO)\s*:?\s*$/i);
      if (regiaoMatch) {
        regiaoAtual = regiaoMatch[1].toUpperCase();
        if (!regioes[regiaoAtual]) {
          regioes[regiaoAtual] = [];
        }
        continue;
      }

      // Detecta folgas
      if (linhaLimpa.toLowerCase().startsWith('folgas:') || linhaLimpa.toLowerCase() === 'folgas') {
        regiaoAtual = 'FOLGAS';
        continue;
      }

      // Se estamos na seção de folgas
      if (regiaoAtual === 'FOLGAS') {
        // Extrai nomes das folgas (formato: "- Nome" ou "- Nome (motivo)")
        const folgaMatch = linhaLimpa.match(/^-\s*(.+)$/);
        if (folgaMatch) {
          folgas.push(folgaMatch[1].trim());
        }
        continue;
      }

      // Processa técnico com horário
      // Formato: "06:00 às 15:48- Diego(99333-2574)"
      const tecnicoMatch = linhaLimpa.match(/(\d{1,2}:\d{2}\s*(?:às|as|a)\s*\d{1,2}:\d{2})\s*[-–]\s*(\w+)\s*\(?([\d\-]+)\)?/i);
      if (tecnicoMatch && regiaoAtual && regiaoAtual !== 'FOLGAS') {
        regioes[regiaoAtual].push({
          horario: tecnicoMatch[1].trim(),
          tecnico: tecnicoMatch[2].trim(),
          telefone: tecnicoMatch[3].trim(),
          sobreaviso: false
        });
        continue;
      }

      // Processa sobreaviso
      // Formato: "- sobreaviso : Diogo(22-99255-0211)" ou "- sobreaviso: Leri(99179-2193)"
      const sobreavisoMatch = linhaLimpa.match(/[-–]\s*sobreaviso\s*:?\s*(\w+)\s*\(?([\d\-]+)\)?/i);
      if (sobreavisoMatch && regiaoAtual && regiaoAtual !== 'FOLGAS') {
        regioes[regiaoAtual].push({
          horario: 'Sobreaviso',
          tecnico: sobreavisoMatch[1].trim(),
          telefone: sobreavisoMatch[2].trim(),
          sobreaviso: true
        });
        continue;
      }
    }
  }

  return { regioes, folgas };
}

/**
 * Processa mensagem de alocação MADRUGADA
 * @param {string} texto - Texto da mensagem
 * @returns {Object} - Dados extraídos
 */
function processarMadrugada(texto) {
  const tecnicos = [];
  const folgas = [];
  let responsavel = null;

  // Divide por seções (usando _____ como separador)
  const secoes = texto.split(/_{3,}/);

  let emFolgas = false;

  for (const secao of secoes) {
    const linhas = secao.trim().split('\n').filter(l => l.trim());

    // Ignora seção de cabeçalho
    if (linhas.some(l => l.toUpperCase().includes('ALOCAÇÃO TÉCNICA'))) {
      continue;
    }

    let tecnicoAtual = null;
    let localAtual = null;
    let atividadeAtual = null;
    let telefoneAtual = null;
    let observacaoAtual = null;

    for (const linha of linhas) {
      const linhaLimpa = linha.trim();

      // Detecta folgas
      if (linhaLimpa.toLowerCase().startsWith('folgas:') || linhaLimpa.toLowerCase() === 'folgas') {
        emFolgas = true;
        continue;
      }

      // Se estamos na seção de folgas
      if (emFolgas) {
        const folgaMatch = linhaLimpa.match(/^-\s*(.+)$/);
        if (folgaMatch) {
          folgas.push(folgaMatch[1].trim());
        }
        continue;
      }

      // Detecta responsável
      // Formato: "Responsável: Douglas Ignacio."
      const responsavelMatch = linhaLimpa.match(/Respons[aá]vel\s*:\s*(.+?)\.?\s*$/i);
      if (responsavelMatch) {
        responsavel = { nome: responsavelMatch[1].trim() };
        continue;
      }

      // Detecta telefone do responsável
      // Formato: "Tel/Whatsapp: 99357-9473"
      if (responsavel && !responsavel.telefone) {
        const telRespMatch = linhaLimpa.match(/Tel(?:\/Whatsapp)?\s*:\s*([\d\-]+)/i);
        if (telRespMatch) {
          responsavel.telefone = telRespMatch[1].trim();
          continue;
        }
      }

      // Detecta técnico com local
      // Formato: "* *Paulo Alexandre: Tijuca" ou "Porfírio: Botafogo"
      const tecnicoLocalMatch = linhaLimpa.match(/^\*?\s*\*?([A-Za-zÀ-ÿ\s]+)\s*:\s*([A-Za-zÀ-ÿ\s]+)$/);
      if (tecnicoLocalMatch && !linhaLimpa.toLowerCase().includes('tel') && !linhaLimpa.toLowerCase().includes('headend')) {
        // Salva técnico anterior se existir
        if (tecnicoAtual) {
          tecnicos.push({
            nome: tecnicoAtual,
            local: localAtual,
            atividade: atividadeAtual,
            telefone: telefoneAtual,
            observacao: observacaoAtual
          });
        }

        tecnicoAtual = tecnicoLocalMatch[1].trim();
        localAtual = tecnicoLocalMatch[2].trim();
        atividadeAtual = null;
        telefoneAtual = null;
        observacaoAtual = null;
        continue;
      }

      // Detecta Headend
      // Formato: "* *Headend - Freguesia"
      const headendMatch = linhaLimpa.match(/^\*?\s*\*?Headend\s*[-–]\s*([A-Za-zÀ-ÿ\s]+)$/i);
      if (headendMatch) {
        if (tecnicoAtual) {
          tecnicos.push({
            nome: tecnicoAtual,
            local: localAtual,
            atividade: atividadeAtual,
            telefone: telefoneAtual,
            observacao: observacaoAtual
          });
        }

        tecnicoAtual = 'Headend';
        localAtual = headendMatch[1].trim();
        atividadeAtual = null;
        telefoneAtual = null;
        observacaoAtual = null;
        continue;
      }

      // Detecta atividade
      // Formato: "° Tijuca: (rebaixamento rota Grajaú [8])."
      const atividadeMatch = linhaLimpa.match(/^[°•]\s*[A-Za-zÀ-ÿ\s]+\s*:\s*\((.+?)\)\.?\s*$/);
      if (atividadeMatch && tecnicoAtual) {
        atividadeAtual = atividadeMatch[1].trim();
        continue;
      }

      // Detecta telefone
      // Formato: "Tel: 96763-5440"
      const telMatch = linhaLimpa.match(/^Tel\s*:\s*([\d\-]+)/i);
      if (telMatch && tecnicoAtual) {
        telefoneAtual = telMatch[1].trim();
        continue;
      }

      // Detecta observação
      // Formato: "[Obs: pega o carro em Niterói e vai para a Tijuca]."
      const obsMatch = linhaLimpa.match(/^\[Obs\s*:\s*(.+?)\]\.?\s*$/i);
      if (obsMatch && tecnicoAtual) {
        observacaoAtual = obsMatch[1].trim();
        continue;
      }
    }

    // Salva último técnico da seção
    if (tecnicoAtual) {
      tecnicos.push({
        nome: tecnicoAtual,
        local: localAtual,
        atividade: atividadeAtual,
        telefone: telefoneAtual,
        observacao: observacaoAtual
      });
      tecnicoAtual = null;
    }
  }

  return { tecnicos, folgas, responsavel };
}

/**
 * Processa mensagem de alocação de HUB
 * @param {Object} msg - Objeto de mensagem compatível
 * @returns {Object|null} - Dados processados ou null
 */
function processarMensagemHub(msg) {
  const texto = msg.text || msg.body || msg.content || '';

  const tipo = identificarTipoAlocacao(texto);
  if (!tipo) {
    return null;
  }

  const data = extrairDataAlocacao(texto);
  const timestamp = msg.date ? new Date(msg.date * 1000) : new Date();

  let dados;
  if (tipo === 'DIURNO') {
    dados = processarDiurno(texto);
  } else {
    dados = processarMadrugada(texto);
  }

  return {
    tipo: 'ALOCACAO_HUB',
    dados: {
      id: `hub_${msg.message_id || Date.now()}_${timestamp.getTime()}`,
      messageId: msg.message_id?.toString() || Date.now().toString(),
      tipoAlocacao: tipo,
      data: data,
      dataRecebimento: timestamp.toISOString(),
      ...dados,
      mensagemOriginal: texto.substring(0, 5000),
      processadoEm: new Date().toISOString()
    }
  };
}

module.exports = {
  identificarTipoAlocacao,
  processarMensagemHub,
  processarDiurno,
  processarMadrugada
};
