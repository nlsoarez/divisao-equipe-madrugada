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

  // Detecta DIURNO - múltiplos formatos possíveis
  if (textoUpper.includes('ALOCAÇÃO TÉCNICA HUBS/RJO DIURNO') ||
      textoUpper.includes('ALOCACAO TECNICA HUBS/RJO DIURNO') ||
      textoUpper.includes('ALOCAÇÃO TÉCNICA HUBS DIURNO') ||
      textoUpper.includes('ALOCACAO TECNICA HUBS DIURNO') ||
      textoUpper.includes('ALOCAÇÃO HUB DIURNO') ||
      textoUpper.includes('ALOCACAO HUB DIURNO') ||
      (textoUpper.includes('ALOCAÇÃO') && textoUpper.includes('HUB') && textoUpper.includes('DIURNO')) ||
      (textoUpper.includes('ALOCACAO') && textoUpper.includes('HUB') && textoUpper.includes('DIURNO'))) {
    return 'DIURNO';
  }

  // Detecta MADRUGADA - múltiplos formatos possíveis
  if (textoUpper.includes('ALOCAÇÃO TÉCNICA HUBS/RJO MADRUGADA') ||
      textoUpper.includes('ALOCACAO TECNICA HUBS/RJO MADRUGADA') ||
      textoUpper.includes('ALOCAÇÃO TÉCNICA HUBS MADRUGADA') ||
      textoUpper.includes('ALOCACAO TECNICA HUBS MADRUGADA') ||
      textoUpper.includes('ALOCAÇÃO HUB MADRUGADA') ||
      textoUpper.includes('ALOCACAO HUB MADRUGADA') ||
      (textoUpper.includes('ALOCAÇÃO') && textoUpper.includes('HUB') && textoUpper.includes('MADRUGADA')) ||
      (textoUpper.includes('ALOCACAO') && textoUpper.includes('HUB') && textoUpper.includes('MADRUGADA'))) {
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
  let match = texto.match(/(?:DIURNO|MADRUGADA)\s+(\d{1,2}\/\d{1,2})/i);
  if (match) {
    return match[1];
  }

  // Tenta formato alternativo: "26/01" em qualquer lugar da primeira linha
  const primeiraLinha = texto.split('\n')[0];
  match = primeiraLinha.match(/(\d{1,2}\/\d{1,2})/);
  if (match) {
    return match[1];
  }

  // Tenta formato com ano: "26/01/2025"
  match = texto.match(/(\d{1,2}\/\d{1,2})\/\d{2,4}/);
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
      // Remove formatação WhatsApp (*negrito*, _itálico_, ~tachado~) antes de parsear
      const linhaLimpa = linha.trim().replace(/[*_~]/g, '').trim();

      // Ignora linhas de cabeçalho
      if (linhaLimpa.toUpperCase().includes('ALOCAÇÃO TÉCNICA')) continue;

      // Detecta região - incluindo variações comuns
      const regiaoMatch = linhaLimpa.match(/^(NORTE|SUL|METROPOLITANA|OESTE|BAIXADA|LESTE|CENTRO|ZONA\s*NORTE|ZONA\s*SUL|ZONA\s*OESTE|ZONA\s*LESTE|GRANDE\s*RIO|NITERÓI|NITEROI)\s*:?\s*$/i);
      if (regiaoMatch) {
        regiaoAtual = regiaoMatch[1].toUpperCase().replace(/\s+/g, ' ');
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
      // Formato: "06:00 às 15:48- Diego(99333-2574)" ou "06:00 às 15:48 - Paulo Alexandre (99333-2574)"
      // Regex atualizado para capturar nomes com acentos e espaços
      const tecnicoMatch = linhaLimpa.match(/(\d{1,2}:\d{2}\s*(?:às|as|a|-)\s*\d{1,2}:\d{2})\s*[-–]?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]*?)\s*\(?([\d\-\s]+)\)?$/i);
      if (tecnicoMatch && regiaoAtual && regiaoAtual !== 'FOLGAS') {
        regioes[regiaoAtual].push({
          horario: tecnicoMatch[1].trim(),
          tecnico: tecnicoMatch[2].trim(),
          telefone: tecnicoMatch[3].replace(/\s/g, '').trim(),
          sobreaviso: false
        });
        continue;
      }

      // Formato alternativo: "Diego - 06:00 às 15:48 (99333-2574)"
      const tecnicoMatchAlt = linhaLimpa.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]*?)\s*[-–]\s*(\d{1,2}:\d{2}\s*(?:às|as|a|-)\s*\d{1,2}:\d{2})\s*\(?([\d\-\s]+)\)?$/i);
      if (tecnicoMatchAlt && regiaoAtual && regiaoAtual !== 'FOLGAS') {
        regioes[regiaoAtual].push({
          horario: tecnicoMatchAlt[2].trim(),
          tecnico: tecnicoMatchAlt[1].trim(),
          telefone: tecnicoMatchAlt[3].replace(/\s/g, '').trim(),
          sobreaviso: false
        });
        continue;
      }

      // Processa sobreaviso
      // Formato: "- sobreaviso : Diogo(22-99255-0211)" ou "- sobreaviso: Leri(99179-2193)"
      // Regex atualizado para capturar nomes com acentos e espaços
      const sobreavisoMatch = linhaLimpa.match(/[-–]?\s*sobreaviso\s*:?\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]*?)\s*\(?([\d\-\s]+)\)?$/i);
      if (sobreavisoMatch && regiaoAtual && regiaoAtual !== 'FOLGAS') {
        regioes[regiaoAtual].push({
          horario: 'Sobreaviso',
          tecnico: sobreavisoMatch[1].trim(),
          telefone: sobreavisoMatch[2].replace(/\s/g, '').trim(),
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
      // Remove formatação WhatsApp (*negrito*, _itálico_, ~tachado~) antes de parsear
      const linhaLimpa = linha.trim().replace(/[*_~]/g, '').trim();

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
      // Formato: "* *Paulo Alexandre: Tijuca" ou "Porfírio: Botafogo" ou "- Paulo Alexandre: Tijuca"
      const tecnicoLocalMatch = linhaLimpa.match(/^[-*•]?\s*\*?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s]*?)\s*:\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s/]+)$/);
      if (tecnicoLocalMatch && !linhaLimpa.toLowerCase().includes('tel') && !linhaLimpa.toLowerCase().includes('headend') && !linhaLimpa.toLowerCase().includes('responsavel') && !linhaLimpa.toLowerCase().includes('responsável')) {
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

  // Log para debug - mostra primeira linha da mensagem
  const primeiraLinha = texto.split('\n')[0].substring(0, 100);
  console.log(`[ParserHub] Analisando: "${primeiraLinha}"`);

  const tipo = identificarTipoAlocacao(texto);
  if (!tipo) {
    console.log('[ParserHub] Mensagem não reconhecida como alocação de HUB');
    return null;
  }

  console.log(`[ParserHub] Tipo identificado: ${tipo}`);

  const data = extrairDataAlocacao(texto);
  const timestamp = msg.date ? new Date(msg.date * 1000) : new Date();

  let dados;
  if (tipo === 'DIURNO') {
    dados = processarDiurno(texto);
    console.log(`[ParserHub] DIURNO processado: ${Object.keys(dados.regioes || {}).length} regiões, ${dados.folgas?.length || 0} folgas`);
  } else {
    dados = processarMadrugada(texto);
    console.log(`[ParserHub] MADRUGADA processado: ${dados.tecnicos?.length || 0} técnicos, ${dados.folgas?.length || 0} folgas`);
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
