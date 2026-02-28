/**
 * Parser para mensagens do grupo COP REDE EMPRESARIAL (Rio/ES e Leste)
 *
 * Formato das mensagens:
 *   💎 COP REDE INF:
 *   📡 SIR MONITORAMENTO
 *   📅 ATUALIZADO: 28/02/2026 04:42
 *   📊 TOTAL DE ATIVIDADES
 *   🔴 RAL: 140
 *   POR CLUSTERS:
 *   * RIO DE JANEIRO: 49
 *   * NORTE: 37
 *   ...
 *   🟢 REC: 44
 *   POR CLUSTERS:
 *   * RIO DE JANEIRO: 16
 *   * NORTE: 10
 *   ...
 *   🏷️ TIPO DE RAL  ← parar aqui
 *
 * O volume por área é a SOMA de RAL + REC por cluster.
 */

// Correções de typos conhecidos nos nomes de clusters
const TYPOS_CLUSTER = {
  'MINAS GERAISTE': 'MINAS GERAIS',
  'MINAS GERASTE': 'MINAS GERAIS',
  'MINAS GERASI': 'MINAS GERAIS',
  'ESPÍRITO SANTO': 'ESPIRITO SANTO',
  'BAHIA / SERGIPE': 'BAHIA/SERGIPE',
  'BAHIA/ SERGIPE': 'BAHIA/SERGIPE',
  'BAHIA /SERGIPE': 'BAHIA/SERGIPE'
};

function normalizarNomeCluster(nome) {
  const upper = nome.toUpperCase().trim();
  return TYPOS_CLUSTER[upper] || upper;
}

/**
 * Verifica se a mensagem é do tipo COP REDE EMPRESARIAL
 */
function identificarTipoEmpresarial(texto) {
  if (!texto) return false;
  const primeira = texto.split('\n')[0].trim().replace(/\*/g, '').trim();
  return primeira.includes('COP REDE INF');
}

/**
 * Formata data no padrão DD/MM/YYYY HH:MM:SS
 */
function formatarDataHora(date) {
  const d = date || new Date();
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const ano = d.getFullYear();
  const hora = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const seg = String(d.getSeconds()).padStart(2, '0');
  return `${dia}/${mes}/${ano} ${hora}:${min}:${seg}`;
}

/**
 * Processa uma mensagem do grupo COP REDE EMPRESARIAL
 * @param {object} msg - { message_id, date, text }
 * @returns {{ tipo: 'COP_REDE_INFORMA', dados: object }|null}
 */
function processarMensagemEmpresarial(msg) {
  const texto = msg.text || msg.body || '';
  if (!identificarTipoEmpresarial(texto)) return null;

  const linhas = texto.split('\n');

  let dataGeracao = null;
  let totalRal = 0;
  let totalRec = 0;
  const clustersRal = {};
  const clustersRec = {};

  let modo = null;       // 'ral' | 'rec' | null
  let inClusters = false;

  for (const linha of linhas) {
    // Strip Markdown bold (**) but keep single * (used as bullet points)
    const lt = linha.trim().replace(/\*\*/g, '').trim();
    if (!lt) continue;

    // Parar ao encontrar seções irrelevantes
    if (lt.includes('🏷️') || lt.includes('🏁') || lt.includes('🔗') || lt.startsWith('#')) {
      break;
    }

    // Data: ATUALIZADO: 28/02/2026 04:42
    const matchData = lt.match(/ATUALIZADO:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})/);
    if (matchData) {
      dataGeracao = `${matchData[1]} ${matchData[2]}:00`;
      continue;
    }

    // Versão limpa (sem * para detectar emojis e labels)
    const ltSemAsteriscos = lt.replace(/\*/g, '').trim();

    // Total RAL: 🔴 RAL: 140
    if (ltSemAsteriscos.includes('🔴') && ltSemAsteriscos.match(/RAL:\s*\d+/)) {
      const m = ltSemAsteriscos.match(/RAL:\s*(\d+)/);
      if (m) {
        totalRal = parseInt(m[1]);
        modo = 'ral';
        inClusters = false;
      }
      continue;
    }

    // Total REC: 🟢 REC: 44
    if (ltSemAsteriscos.includes('🟢') && ltSemAsteriscos.match(/REC:\s*\d+/)) {
      const m = ltSemAsteriscos.match(/REC:\s*(\d+)/);
      if (m) {
        totalRec = parseInt(m[1]);
        modo = 'rec';
        inClusters = false;
      }
      continue;
    }

    // POR CLUSTERS:
    if (ltSemAsteriscos.toUpperCase().startsWith('POR CLUSTERS')) {
      inClusters = true;
      continue;
    }

    // Linha de cluster: * NOME: N  (ou • NOME: N  ou - NOME: N)
    if (inClusters && modo) {
      // Detectar padrão de bullet: começa com * / • / - seguido de espaço
      const matchBullet =
        lt.match(/^\*\s+(.+?):\s*(\d+)\s*$/) ||    // * NOME: N
        lt.match(/^[•\-]\s+(.+?):\s*(\d+)\s*$/) ||  // • ou - NOME: N
        lt.match(/^\*(.+?):\s*(\d+)\s*$/);           // *NOME: N (sem espaço)

      if (matchBullet) {
        const nome = normalizarNomeCluster(
          matchBullet[1].trim().replace(/\*/g, '')
        );
        const count = parseInt(matchBullet[2]);

        // Ignorar clusters inválidos
        if (nome.toLowerCase() !== 'unknown' && nome !== '' && count > 0) {
          if (modo === 'ral') {
            clustersRal[nome] = (clustersRal[nome] || 0) + count;
          } else {
            clustersRec[nome] = (clustersRec[nome] || 0) + count;
          }
        }
        continue;
      }

      // Linha não vazia e não é bullet → fim da seção de clusters
      if (lt.length > 0) {
        inClusters = false;
      }
    }
  }

  // Somar RAL + REC por cluster
  const grupoFinal = {};
  const todosNomes = new Set([...Object.keys(clustersRal), ...Object.keys(clustersRec)]);

  for (const nome of todosNomes) {
    const total = (clustersRal[nome] || 0) + (clustersRec[nome] || 0);
    if (total > 0) {
      grupoFinal[nome] = total;
    }
  }

  if (Object.keys(grupoFinal).length === 0) {
    console.log('[ParserEmpresarial] Nenhum cluster extraído da mensagem');
    return null;
  }

  const agora = new Date();
  const msgDate = msg.date ? new Date(msg.date * 1000) : agora;
  const messageId = String(msg.message_id || msg.id || Date.now());

  console.log(`[ParserEmpresarial] Extraídos ${Object.keys(grupoFinal).length} clusters | RAL=${totalRal} REC=${totalRec}`);

  return {
    tipo: 'COP_REDE_INFORMA',
    dados: {
      id: `emp_${messageId}_${Date.now()}`,
      messageId,
      tipo: 'COP REDE INFORMA',
      formato: 'sir_monitoramento',
      dataGeracao: dataGeracao || formatarDataHora(msgDate),
      dataRecebimento: agora.toISOString(),
      dataMensagem: msgDate.toISOString(),
      totalEventos: totalRal + totalRec,
      resumo: {
        grupo: grupoFinal,
        totalRal,
        totalRec
      },
      grupoOriginal: Object.keys(grupoFinal).join(', '),
      areaPainel: null,
      status: 'SUCESSO',
      mensagemOriginal: texto,
      processadoEm: agora.toISOString()
    }
  };
}

module.exports = { processarMensagemEmpresarial, identificarTipoEmpresarial };
