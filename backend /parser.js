/**
 * Parser de mensagens do Telegram
 * Extrai campos estruturados das mensagens COP REDE INFORMA e Novos Alertas
 */

const {
  MESSAGE_TITLES,
  GRUPO_PARA_AREA,
  STATUS_PROCESSAMENTO
} = require('./config');

/**
 * Normaliza string removendo acentos e convertendo para lowercase
 * @param {string} str - String a ser normalizada
 * @returns {string} String normalizada
 */
function normalizar(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Identifica o tipo de mensagem pelo título (primeira linha)
 * @param {string} texto - Texto completo da mensagem
 * @returns {string|null} Tipo da mensagem ou null se não reconhecida
 */
function identificarTipoMensagem(texto) {
  if (!texto) return null;

  const primeiraLinha = texto.split('\n')[0].trim();
  // Remove markdown bold markers para comparação
  const primeiraLinhaSemMarkdown = primeiraLinha.replace(/\*\*/g, '');

  // COP REDE INFORMA
  if (primeiraLinha === MESSAGE_TITLES.COP_REDE_INFORMA ||
      primeiraLinha.includes('COP REDE INFORMA') ||
      primeiraLinhaSemMarkdown.includes('COP REDE INFORMA')) {
    return 'COP_REDE_INFORMA';
  }

  // 🚨 Novo Evento Detectado! (suporta com e sem emoji, com e sem markdown)
  if (primeiraLinha === MESSAGE_TITLES.NOVO_EVENTO ||
      primeiraLinha.includes('Novo Evento Detectado') ||
      primeiraLinhaSemMarkdown.includes('Novo Evento Detectado') ||
      primeiraLinha.includes('🚨') ||
      primeiraLinha.includes('🚧')) {
    return 'NOVO_EVENTO';
  }

  return null;
}

/**
 * Extrai valor de um campo no formato "CHAVE: valor"
 * @param {string} texto - Texto completo da mensagem
 * @param {string} chave - Nome da chave a buscar
 * @returns {string|null} Valor encontrado ou null
 */
function extrairCampo(texto, chave) {
  if (!texto || !chave) return null;

  // Regex flexível para encontrar padrão "CHAVE: valor" ou "CHAVE : valor"
  // Aceita variações de espaço e é case-insensitive
  const regex = new RegExp(`^\\s*${chave}\\s*:\\s*(.+)$`, 'im');
  const match = texto.match(regex);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Extrai data de uma string no formato dd/mm ou dd/mm/aaaa
 * @param {string} texto - Texto contendo a data
 * @returns {string|null} Data no formato dd/mm/aaaa ou null
 */
function extrairData(texto) {
  if (!texto) return null;

  // Padrão dd/mm/aaaa
  let match = texto.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const dia = match[1].padStart(2, '0');
    const mes = match[2].padStart(2, '0');
    const ano = match[3];
    return `${dia}/${mes}/${ano}`;
  }

  // Padrão dd/mm (assume ano atual)
  match = texto.match(/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    const dia = match[1].padStart(2, '0');
    const mes = match[2].padStart(2, '0');
    const ano = new Date().getFullYear();
    return `${dia}/${mes}/${ano}`;
  }

  return null;
}

/**
 * Extrai valor numérico (volume)
 * @param {string} texto - Texto contendo o número
 * @returns {number|null} Número extraído ou null
 */
function extrairVolume(texto) {
  if (!texto) return null;

  // Remove caracteres não numéricos exceto ponto e vírgula
  const limpo = texto.replace(/[^\d.,]/g, '').replace(',', '.');
  const numero = parseFloat(limpo);

  return isNaN(numero) ? null : numero;
}

/**
 * Mapeia o GRUPO da mensagem para a área do painel
 * @param {string} grupo - Nome do grupo da mensagem
 * @returns {object} { areaPainel, status }
 */
function mapearGrupoParaArea(grupo) {
  if (!grupo) {
    return {
      areaPainel: null,
      status: STATUS_PROCESSAMENTO.GRUPO_DESCONHECIDO
    };
  }

  const grupoNormalizado = normalizar(grupo);

  // Busca exata
  if (GRUPO_PARA_AREA[grupoNormalizado]) {
    return {
      areaPainel: GRUPO_PARA_AREA[grupoNormalizado],
      status: STATUS_PROCESSAMENTO.SUCESSO
    };
  }

  // Busca parcial (se o grupo contém alguma das chaves)
  for (const [chave, valor] of Object.entries(GRUPO_PARA_AREA)) {
    if (grupoNormalizado.includes(chave) || chave.includes(grupoNormalizado)) {
      return {
        areaPainel: valor,
        status: STATUS_PROCESSAMENTO.SUCESSO
      };
    }
  }

  // Não encontrado
  return {
    areaPainel: null,
    status: STATUS_PROCESSAMENTO.GRUPO_DESCONHECIDO
  };
}

/**
 * Extrai seções do formato de lista do COP REDE INFORMA
 * Formato: SECAO:\n- item1: valor1\n- item2: valor2
 * Também suporta formato markdown: **SECAO:**\n- item1: valor1
 * @param {string} texto - Texto completo
 * @param {string} secao - Nome da seção
 * @returns {object} Objeto com itens e valores
 */
function extrairSecaoLista(texto, secao) {
  if (!texto || !secao) return null;

  console.log(`[Parser] Buscando seção: ${secao}`);

  let conteudo = null;

  // Método 1: Busca por seção markdown **SECAO:**
  // Encontra a posição inicial da seção
  const regexInicio = new RegExp(`\\*\\*${secao}:\\*\\*`, 'i');
  const matchInicio = texto.match(regexInicio);

  if (matchInicio) {
    const posInicio = texto.indexOf(matchInicio[0]) + matchInicio[0].length;

    // Encontra a próxima seção markdown ou usa o fim do texto
    const restoTexto = texto.substring(posInicio);
    const regexProximaSecao = /\n\*\*[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇA-Z\s/]*:\*\*/i;
    const matchProxima = restoTexto.match(regexProximaSecao);

    if (matchProxima) {
      conteudo = restoTexto.substring(0, matchProxima.index);
    } else {
      // GRUPO é a última seção - pega todo o resto
      conteudo = restoTexto;
    }
    console.log(`[Parser] Encontrado com markdown, conteúdo tem ${conteudo?.length || 0} chars`);
  }

  // Método 2: Busca sem markdown
  if (!conteudo) {
    const regexSemMd = new RegExp(`${secao}:\\s*\\n([\\s\\S]*?)(?=\\n[A-ZÁÉÍÓÚ]+:|$)`, 'i');
    const match = texto.match(regexSemMd);
    if (match) {
      conteudo = match[1];
      console.log(`[Parser] Encontrado sem markdown, conteúdo tem ${conteudo?.length || 0} chars`);
    }
  }

  if (!conteudo) {
    console.log(`[Parser] Seção ${secao} não encontrada no texto`);
    return null;
  }

  // Processa linhas que começam com "-"
  const linhas = conteudo.split('\n').filter(l => l.trim().startsWith('-'));
  console.log(`[Parser] Seção ${secao}: encontradas ${linhas.length} linhas com "-"`);

  const itens = {};
  let total = 0;

  for (const linha of linhas) {
    // Captura "- Nome do Item: 123" (aceita espaços extras e variações)
    const itemMatch = linha.match(/^-\s*(.+?):\s*(\d+)\s*$/);
    if (itemMatch) {
      const nomeItem = itemMatch[1].trim();
      const valor = parseInt(itemMatch[2]);
      itens[nomeItem] = valor;
      total += valor;
      console.log(`[Parser]   -> ${nomeItem}: ${valor}`);
    } else {
      console.log(`[Parser]   -> Linha não parseada: "${linha.trim()}"`);
    }
  }

  console.log(`[Parser] Seção ${secao}: ${Object.keys(itens).length} itens extraídos, total: ${total}`);
  return { itens, total };
}

/**
 * Faz parsing completo de uma mensagem COP REDE INFORMA (formato resumo)
 * @param {string} texto - Texto completo da mensagem
 * @param {Date} dataMensagem - Data/hora da mensagem no Telegram
 * @param {number} messageId - ID da mensagem no Telegram
 * @returns {object} Objeto com campos extraídos
 */
function parseCopRedeInforma(texto, dataMensagem, messageId) {
  // Extrair seções do resumo
  const mercado = extrairSecaoLista(texto, 'MERCADO');
  const tipo = extrairSecaoLista(texto, 'TIPO');
  const natureza = extrairSecaoLista(texto, 'NATUREZA');
  const sintoma = extrairSecaoLista(texto, 'SINTOMA');
  const grupo = extrairSecaoLista(texto, 'GRUPO');

  // Calcular total geral
  const totalGeral = mercado?.total || tipo?.total || 0;

  // Identificar áreas afetadas
  const areasAfetadas = [];
  if (grupo?.itens) {
    for (const [grupoNome, quantidade] of Object.entries(grupo.itens)) {
      const { areaPainel } = mapearGrupoParaArea(grupoNome);
      if (areaPainel && !areasAfetadas.includes(areaPainel)) {
        areasAfetadas.push(areaPainel);
      }
    }
  }

  // Criar descrição resumida
  const descricaoPartes = [];
  if (tipo?.itens) {
    descricaoPartes.push('Tipos: ' + Object.entries(tipo.itens).map(([k, v]) => `${k} (${v})`).join(', '));
  }
  if (sintoma?.itens) {
    descricaoPartes.push('Sintomas: ' + Object.entries(sintoma.itens).map(([k, v]) => `${k} (${v})`).join(', '));
  }

  return {
    id: `cop_${messageId}_${Date.now()}`,
    messageId,
    // Campos para o frontend
    dataRecebimento: dataMensagem.toISOString(),
    empresa: 'Resumo COP',
    grupo: grupo?.itens ? Object.keys(grupo.itens).join(', ') : null,
    areaMapeada: areasAfetadas.length > 0 ? areasAfetadas.join(', ') : null,
    sigla: null,
    descricao: descricaoPartes.join('\n') || null,
    // Dados detalhados do resumo
    resumo: {
      mercado: mercado?.itens || {},
      tipo: tipo?.itens || {},
      natureza: natureza?.itens || {},
      sintoma: sintoma?.itens || {},
      grupo: grupo?.itens || {},
      totalGeral
    },
    areasAfetadas,
    totalEventos: totalGeral,
    mensagemOriginal: texto,
    origem: 'COP_REDE_INFORMA',
    processadoEm: new Date().toISOString()
  };
}

/**
 * Extrai valor de um campo multilinha (como DESCRIÇÃO)
 * @param {string} texto - Texto completo da mensagem
 * @param {string} chave - Nome da chave a buscar
 * @returns {string|null} Valor encontrado ou null
 */
function extrairCampoMultilinha(texto, chave) {
  if (!texto || !chave) return null;

  const linhas = texto.split('\n');
  let encontrou = false;
  let valor = [];

  for (const linha of linhas) {
    // Verifica se esta linha é o início do campo
    const regex = new RegExp(`^\\s*${chave}\\s*:`, 'i');
    if (regex.test(linha)) {
      encontrou = true;
      // Pega o resto da linha após o ":"
      const resto = linha.replace(regex, '').trim();
      if (resto) valor.push(resto);
      continue;
    }

    // Se já encontrou e a linha não é outro campo, adiciona ao valor
    if (encontrou) {
      // Verifica se é outro campo (tem formato "CAMPO:")
      if (/^[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ]+\s*:/i.test(linha.trim())) {
        break; // Chegou em outro campo
      }
      valor.push(linha);
    }
  }

  return valor.length > 0 ? valor.join('\n').trim() : null;
}

/**
 * Extrai campo com emoji do formato "📌 Campo: valor" ou "📌 **Campo:** valor"
 * Suporta múltiplos emojis para o mesmo campo
 * @param {string} texto - Texto completo
 * @param {string|string[]} emojis - Emoji(s) possíveis do campo
 * @param {string} campo - Nome do campo
 * @returns {string|null} Valor extraído
 */
function extrairCampoComEmoji(texto, emojis, campo) {
  if (!texto) return null;

  // Normaliza emojis para array
  const emojiList = Array.isArray(emojis) ? emojis : [emojis];

  for (const emoji of emojiList) {
    // Tenta com emoji e markdown bold
    const regexEmojiBold = new RegExp(`${emoji}\\s*\\*\\*${campo}:\\*\\*\\s*(.+)`, 'i');
    let match = texto.match(regexEmojiBold);
    if (match) return match[1].trim();

    // Tenta com emoji sem bold
    const regexEmoji = new RegExp(`${emoji}\\s*${campo}:\\s*(.+)`, 'i');
    match = texto.match(regexEmoji);
    if (match) return match[1].trim();
  }

  // Tenta sem emoji (com e sem bold)
  const regexBold = new RegExp(`\\*\\*${campo}:\\*\\*\\s*(.+)`, 'im');
  let match = texto.match(regexBold);
  if (match) return match[1].trim();

  const regexSemEmoji = new RegExp(`^\\s*${campo}:\\s*(.+)`, 'im');
  match = texto.match(regexSemEmoji);
  if (match) return match[1].trim();

  return null;
}

/**
 * Faz parsing completo de uma mensagem de Novo Evento/Alerta
 * Formato: 🚨 Novo Evento Detectado! com campos usando emojis
 * @param {string} texto - Texto completo da mensagem
 * @param {Date} dataMensagem - Data/hora da mensagem no Telegram
 * @param {number} messageId - ID da mensagem no Telegram
 * @returns {object} Objeto com campos extraídos
 */
function parseNovoEvento(texto, dataMensagem, messageId) {
  // Extrair campos do formato com emojis (suporta múltiplos emojis por campo)
  const ticket = extrairCampoComEmoji(texto, ['📌', '🎫'], 'Ticket');
  const dataEvento = extrairCampoComEmoji(texto, ['📅', '🗓️', '📆'], 'Data');
  const tipo = extrairCampoComEmoji(texto, ['🔍', '🔎'], 'Tipo');
  const mercado = extrairCampoComEmoji(texto, ['🌍', '🟢', '🟡', '🔴', '⚪', '🏢'], 'Mercado');
  const sintoma = extrairCampoComEmoji(texto, ['⚠️', '⚡', '🔔'], 'Sintoma');
  const cluster = extrairCampoComEmoji(texto, ['📡', '📍', '🗺️', '📌'], 'Cluster');
  const natureza = extrairCampoComEmoji(texto, ['📑', '📄', '📋', '📝'], 'Natureza');

  // O cluster é usado para mapear para a área
  const { areaPainel } = mapearGrupoParaArea(cluster);

  // Criar descrição
  const descricaoParts = [];
  if (tipo) descricaoParts.push(`Tipo: ${tipo}`);
  if (sintoma) descricaoParts.push(`Sintoma: ${sintoma}`);
  if (mercado) descricaoParts.push(`Mercado: ${mercado}`);
  if (natureza) descricaoParts.push(`Natureza: ${natureza}`);

  return {
    id: `alerta_${messageId}_${Date.now()}`,
    messageId,
    // Campos para o frontend
    dataRecebimento: dataMensagem.toISOString(),
    grupo: cluster || null,
    areaPainel: areaPainel || null,
    areaMapeada: areaPainel || null,
    descricao: descricaoParts.join(' | ') || null,
    // Campos específicos do alerta
    ticket,
    dataEvento,
    tipo,
    mercado,
    sintoma,
    natureza,
    mensagemOriginal: texto,
    origem: 'NOVO_EVENTO_DETECTADO',
    statusAlerta: 'novo',
    status: 'novo',
    historicoStatus: [{
      status: 'novo',
      data: new Date().toISOString()
    }],
    processadoEm: new Date().toISOString()
  };
}

/**
 * Extrai detalhes do texto quando não há campo DETALHES explícito
 * @param {string} texto - Texto completo
 * @returns {string} Detalhes extraídos
 */
function extrairDetalhesDoTexto(texto) {
  if (!texto) return '';

  const linhas = texto.split('\n');
  // Remove primeira linha (título) e linhas que são campos conhecidos
  const camposConhecidos = ['TIPO:', 'GRUPO:', 'DIA:', 'DATA:', 'RESPONSAVEL:', 'RESPONSÁVEL:', 'VOLUME:', 'DETALHES:', 'DESCRICAO:', 'DESCRIÇÃO:'];

  const detalhes = linhas
    .slice(1) // Remove título
    .filter(linha => {
      const linhaUpper = linha.toUpperCase().trim();
      return !camposConhecidos.some(campo => linhaUpper.startsWith(campo));
    })
    .join('\n')
    .trim();

  return detalhes || 'Sem detalhes adicionais';
}

/**
 * Formata data para string dd/mm/aaaa
 * @param {Date} data - Objeto Date
 * @returns {string} Data formatada
 */
function formatarData(data) {
  if (!data) return null;
  const d = new Date(data);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const ano = d.getFullYear();
  return `${dia}/${mes}/${ano}`;
}

/**
 * Processa uma mensagem do Telegram e retorna dados estruturados
 * @param {object} message - Objeto de mensagem do Telegram
 * @returns {object|null} Dados processados ou null se mensagem não for relevante
 */
function processarMensagem(message) {
  if (!message || !message.text) {
    return null;
  }

  const texto = message.text;
  const tipoMensagem = identificarTipoMensagem(texto);

  if (!tipoMensagem) {
    return null; // Mensagem não é relevante
  }

  const dataMensagem = new Date(message.date * 1000); // Telegram usa timestamp Unix
  const messageId = message.message_id;

  try {
    if (tipoMensagem === 'COP_REDE_INFORMA') {
      return {
        tipo: 'COP_REDE_INFORMA',
        dados: parseCopRedeInforma(texto, dataMensagem, messageId)
      };
    }

    if (tipoMensagem === 'NOVO_EVENTO') {
      return {
        tipo: 'NOVO_EVENTO',
        dados: parseNovoEvento(texto, dataMensagem, messageId)
      };
    }
  } catch (error) {
    console.error('[Parser] Erro ao processar mensagem:', error);
    return {
      tipo: tipoMensagem,
      dados: {
        id: `erro_${messageId}_${Date.now()}`,
        messageId,
        dataMensagem: dataMensagem.toISOString(),
        textoCompleto: texto,
        status: STATUS_PROCESSAMENTO.ERRO_PARSING,
        erro: error.message,
        processadoEm: new Date().toISOString()
      }
    };
  }

  return null;
}

module.exports = {
  normalizar,
  identificarTipoMensagem,
  extrairCampo,
  extrairCampoMultilinha,
  extrairCampoComEmoji,
  extrairSecaoLista,
  extrairData,
  extrairVolume,
  mapearGrupoParaArea,
  parseCopRedeInforma,
  parseNovoEvento,
  processarMensagem,
  formatarData
};
