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

  // COP REDE - INFORMA (novo formato)
  if (primeiraLinha.includes('📢 COP REDE - INFORMA') ||
      primeiraLinha.includes('COP REDE - INFORMA')) {
    return 'COP_REDE_INFORMA';
  }

  // COP REDE INFORMA (formato antigo)
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
 * Suporta múltiplos formatos:
 * - **SECAO:**\n- item: valor (markdown bold)
 * - ## SECAO\n- item: valor (markdown heading)
 * - SECAO:\n- item: valor (plain text)
 * @param {string} texto - Texto completo
 * @param {string} secao - Nome da seção
 * @returns {object} Objeto com itens e valores
 */
function extrairSecaoLista(texto, secao) {
  if (!texto || !secao) return null;

  console.log(`[Parser] Buscando seção: ${secao}`);

  let conteudo = null;

  // Método 0: Busca por emoji + nome da seção (ex: "🏢 Totais por Cluster:")
  const emojisSecao = {
    'Totais por Cluster': ['🏢', '📍', '🗺️'],
    'Cluster': ['🏢', '📍', '🗺️'],
    'CLUSTER': ['🏢', '📍', '🗺️'],
    'Por Cluster': ['🏢', '📍', '🗺️'],
    'Totais por Status': ['📌', '📊', '✅'],
    'Status': ['📌', '📊', '✅'],
    'Totais por Sintoma': ['🧪', '⚠️', '🔍'],
    'Sintoma': ['🧪', '⚠️', '🔍']
  };

  const emojisParaSecao = emojisSecao[secao] || [];
  for (const emoji of emojisParaSecao) {
    // Busca: emoji + texto da seção + ":" + nova linha
    const regexEmoji = new RegExp(`${emoji}\\s*[^\\n]*${secao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*:\\s*\\n`, 'i');
    const matchEmoji = texto.match(regexEmoji);

    if (matchEmoji) {
      const posInicio = texto.indexOf(matchEmoji[0]) + matchEmoji[0].length;
      const restoTexto = texto.substring(posInicio);
      // Encontra próxima seção (emoji + texto + dois pontos)
      const regexProxima = /\n[📊🏢📂🍃🔍📍🗓️🚨📌🧪⚠️✅]+\s*[^\n:]+:/;
      const matchProxima = restoTexto.match(regexProxima);

      if (matchProxima) {
        conteudo = restoTexto.substring(0, matchProxima.index);
      } else {
        conteudo = restoTexto;
      }
      console.log(`[Parser] Encontrado com emoji ${emoji}, conteúdo tem ${conteudo?.length || 0} chars`);
      break;
    }
  }

  // Método 1: Busca por seção markdown **SECAO:**
  if (!conteudo) {
    const regexBold = new RegExp(`\\*\\*${secao}:\\*\\*`, 'i');
    const matchBold = texto.match(regexBold);

    if (matchBold) {
      const posInicio = texto.indexOf(matchBold[0]) + matchBold[0].length;
      const restoTexto = texto.substring(posInicio);
      const regexProximaSecao = /\n\*\*[A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇ][A-ZÁÉÍÓÚÂÊÎÔÛÃÕÇA-Z\s/]*:\*\*/i;
      const matchProxima = restoTexto.match(regexProximaSecao);

      if (matchProxima) {
        conteudo = restoTexto.substring(0, matchProxima.index);
      } else {
        conteudo = restoTexto;
      }
      console.log(`[Parser] Encontrado com markdown bold, conteúdo tem ${conteudo?.length || 0} chars`);
    }
  }

  // Método 2: Busca por markdown heading ## SECAO ou ### SECAO
  if (!conteudo) {
    const regexHeading = new RegExp(`#+\\s*${secao}:?\\s*\\n`, 'i');
    const matchHeading = texto.match(regexHeading);

    if (matchHeading) {
      const posInicio = texto.indexOf(matchHeading[0]) + matchHeading[0].length;
      const restoTexto = texto.substring(posInicio);
      // Encontra próxima seção (heading ou bold)
      const regexProxima = /\n(?:#+\s*[A-ZÁÉÍÓÚ]|\*\*[A-ZÁÉÍÓÚ])/i;
      const matchProxima = restoTexto.match(regexProxima);

      if (matchProxima) {
        conteudo = restoTexto.substring(0, matchProxima.index);
      } else {
        conteudo = restoTexto;
      }
      console.log(`[Parser] Encontrado com markdown heading, conteúdo tem ${conteudo?.length || 0} chars`);
    }
  }

  // Método 3: Busca plain text SECAO:
  if (!conteudo) {
    const regexSemMd = new RegExp(`^${secao}:\\s*\\n([\\s\\S]*?)(?=\\n[A-ZÁÉÍÓÚ]+:|$)`, 'im');
    const match = texto.match(regexSemMd);
    if (match) {
      conteudo = match[1];
      console.log(`[Parser] Encontrado plain text, conteúdo tem ${conteudo?.length || 0} chars`);
    }
  }

  // Método 4: Busca por linha que começa com SECAO (sem dois pontos)
  if (!conteudo) {
    const linhas = texto.split('\n');
    let inicioSecao = -1;

    for (let i = 0; i < linhas.length; i++) {
      const linhaLimpa = linhas[i].replace(/[#*]/g, '').trim().toUpperCase();
      if (linhaLimpa === secao || linhaLimpa === secao + ':') {
        inicioSecao = i + 1;
        break;
      }
    }

    if (inicioSecao > 0 && inicioSecao < linhas.length) {
      const linhasSecao = [];
      for (let i = inicioSecao; i < linhas.length; i++) {
        const linha = linhas[i];
        // Para quando encontra outra seção
        const linhaLimpa = linha.replace(/[#*]/g, '').trim().toUpperCase();
        if (linhaLimpa.match(/^[A-ZÁÉÍÓÚ]+:?$/) && !linha.trim().startsWith('-')) {
          break;
        }
        linhasSecao.push(linha);
      }
      if (linhasSecao.length > 0) {
        conteudo = linhasSecao.join('\n');
        console.log(`[Parser] Encontrado por linha, conteúdo tem ${conteudo?.length || 0} chars`);
      }
    }
  }

  if (!conteudo) {
    console.log(`[Parser] Seção ${secao} não encontrada no texto`);
    return null;
  }

  // Processa TODAS as linhas que contêm "nome: valor" ou "nome - valor"
  // Aceita linhas com "-", "•", números, OU emojis no início
  const linhas = conteudo.split('\n').filter(l => {
    const trimmed = l.trim();
    if (!trimmed) return false;
    // Aceita linhas começando com: -, •, número, ou emoji
    // Também aceita linhas que contenham ": número" em qualquer lugar
    return trimmed.startsWith('-') ||
           trimmed.startsWith('•') ||
           trimmed.match(/^\d+\./) ||
           trimmed.match(/:\s*\d+\s*$/) || // Qualquer linha terminando em ": número"
           trimmed.match(/^[^\w\sÀ-ÿ]/) || // Começa com emoji ou caractere especial
           trimmed.match(/-\s*\d+\s*$/);   // Qualquer linha terminando em "- número"
  });
  console.log(`[Parser] Seção ${secao}: encontradas ${linhas.length} linhas candidatas`);

  const itens = {};
  let total = 0;

  for (const linha of linhas) {
    const linhaOriginal = linha.trim();
    // Remove emojis e caracteres especiais do início da linha para facilitar parsing
    const linhaSemEmoji = linhaOriginal.replace(/^[^\w\sÀ-ÿ]+\s*/, '').trim();

    // Captura múltiplos formatos:
    // "- Nome do Item: 123"
    // "• Nome do Item: 123"
    // "1. Nome do Item: 123"
    // "- Nome do Item - 123"
    // "☕ Minas Gerais: 12" (emoji no início)
    // "Nome do Item: 123" (sem marcador)
    let itemMatch = linhaOriginal.match(/^[-•]\s*(.+?):\s*(\d+)\s*$/);
    if (!itemMatch) {
      itemMatch = linhaOriginal.match(/^\d+\.\s*(.+?):\s*(\d+)\s*$/);
    }
    if (!itemMatch) {
      itemMatch = linhaOriginal.match(/^[-•]\s*(.+?)\s*-\s*(\d+)\s*$/);
    }
    // Tenta formato "- Nome do Item (123)"
    if (!itemMatch) {
      itemMatch = linhaOriginal.match(/^[-•]\s*(.+?)\s*\((\d+)\)\s*$/);
    }
    // Tenta formato com emoji: "☕ Nome do Item: 123"
    if (!itemMatch) {
      itemMatch = linhaSemEmoji.match(/^(.+?):\s*(\d+)\s*$/);
    }
    // Tenta formato com emoji e hífen: "☕ Nome do Item - 123"
    if (!itemMatch) {
      itemMatch = linhaSemEmoji.match(/^(.+?)\s*-\s*(\d+)\s*$/);
    }

    if (itemMatch) {
      // Remove qualquer emoji restante do nome do item
      const nomeItem = itemMatch[1].replace(/^[^\w\sÀ-ÿ]+\s*/, '').trim();
      const valor = parseInt(itemMatch[2]);
      if (nomeItem && valor > 0) {
        itens[nomeItem] = valor;
        total += valor;
        console.log(`[Parser]   -> ${nomeItem}: ${valor}`);
      }
    } else {
      console.log(`[Parser]   -> Linha não parseada: "${linhaOriginal}"`);
    }
  }

  console.log(`[Parser] Seção ${secao}: ${Object.keys(itens).length} itens extraídos, total: ${total}`);
  return { itens, total };
}

/**
 * Parser para novo formato COP REDE - INFORMA (2026)
 * Formato:
 * 📢 COP REDE - INFORMA
 * 🏷️ TIPO: OTG FIBRA HFC - GPON
 * 🕒 Horário de envio: 24/01/2026 00:00:25
 * 📊 Volume Total: 45
 * 🏢 Totais por Cluster: ...
 * 📌 Totais por Status: ...
 * 🧪 Totais por Sintoma: ...
 */
function parseCopRedeInformaNovoFormato(texto, dataMensagem, messageId) {
  console.log('[Parser] Parsing NOVO formato COP REDE - INFORMA (2026)...');
  console.log('[Parser] Texto recebido (500 chars):', texto.substring(0, 500));

  // Extrair campos principais - tentar múltiplos emojis/nomes
  const tipo = extrairCampoComEmoji(texto, ['🏷️', '🏷'], 'TIPO') ||
               extrairCampoComEmoji(texto, ['🏷️', '🏷'], 'Tipo');
  const horarioEnvio = extrairCampoComEmoji(texto, ['🕒', '⏰', '🕐'], 'Horário de envio') ||
                       extrairCampoComEmoji(texto, ['🕒', '⏰', '🕐'], 'Horario de envio') ||
                       extrairCampoComEmoji(texto, ['🕒', '⏰', '🕐'], 'Data');
  const volumeTotal = extrairCampoComEmoji(texto, ['📊', '📈'], 'Volume Total') ||
                      extrairCampoComEmoji(texto, ['📊', '📈'], 'Total');

  console.log('[Parser] Tipo extraído:', tipo);
  console.log('[Parser] Horário extraído:', horarioEnvio);
  console.log('[Parser] Volume total extraído:', volumeTotal);

  // Extrair seções com listas - tentar múltiplos nomes de seção
  let cluster = extrairSecaoLista(texto, 'Totais por Cluster');
  if (!cluster || Object.keys(cluster.itens || {}).length === 0) {
    cluster = extrairSecaoLista(texto, 'Cluster');
  }
  if (!cluster || Object.keys(cluster.itens || {}).length === 0) {
    cluster = extrairSecaoLista(texto, 'CLUSTER');
  }
  if (!cluster || Object.keys(cluster.itens || {}).length === 0) {
    cluster = extrairSecaoLista(texto, 'Por Cluster');
  }

  let status = extrairSecaoLista(texto, 'Totais por Status');
  if (!status || Object.keys(status.itens || {}).length === 0) {
    status = extrairSecaoLista(texto, 'Status');
  }

  let sintoma = extrairSecaoLista(texto, 'Totais por Sintoma');
  if (!sintoma || Object.keys(sintoma.itens || {}).length === 0) {
    sintoma = extrairSecaoLista(texto, 'Sintoma');
  }

  const incidentes24h = extrairSecaoLista(texto, 'Incidentes >24h por Cluster') ||
                        extrairSecaoLista(texto, 'Incidentes 24h');

  // FALLBACK: Se não encontrou clusters, tentar extrair diretamente do texto
  // Busca padrões como "Minas Gerais: 12" ou "☕ Rio de Janeiro: 8"
  if (!cluster || Object.keys(cluster.itens || {}).length === 0) {
    console.log('[Parser] Tentando FALLBACK para extrair clusters diretamente...');
    const clustersFallback = {};
    let totalFallback = 0;

    // Lista de nomes de regiões conhecidas
    const regioesConhecidas = [
      'Minas Gerais', 'Rio de Janeiro', 'Rio', 'Bahia', 'Sergipe', 'Bahia / Sergipe',
      'Espirito Santo', 'Espírito Santo', 'Vitoria', 'Vitória', 'Centro Oeste',
      'Centro-Oeste', 'Norte', 'Nordeste', 'Goias', 'Goiás', 'Amazonas', 'Para', 'Pará',
      'Rio / Espirito Santo', 'Rio / Espírito Santo', 'Grande Rio', 'Rio Capital'
    ];

    // Buscar cada região no texto com seu valor
    for (const regiao of regioesConhecidas) {
      // Padrão: "região: número" ou "emoji região: número"
      const regex = new RegExp(`[^\\w]?${regiao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:\\-]\\s*(\\d+)`, 'gi');
      const matches = texto.matchAll(regex);
      for (const match of matches) {
        const valor = parseInt(match[1]);
        if (valor > 0) {
          // Normalizar nome da região
          const nomeNormalizado = regiao.trim();
          if (!clustersFallback[nomeNormalizado]) {
            clustersFallback[nomeNormalizado] = 0;
          }
          clustersFallback[nomeNormalizado] += valor;
          totalFallback += valor;
          console.log(`[Parser] FALLBACK encontrou: ${nomeNormalizado}: ${valor}`);
        }
      }
    }

    if (Object.keys(clustersFallback).length > 0) {
      cluster = { itens: clustersFallback, total: totalFallback };
      console.log('[Parser] FALLBACK clusters extraídos:', cluster);
    }
  }

  console.log('[Parser] Clusters extraídos:', cluster);
  console.log('[Parser] Status extraídos:', status);
  console.log('[Parser] Sintomas extraídos:', sintoma);

  // Calcular total (usar volumeTotal se disponível, senão somar clusters)
  let totalGeral = volumeTotal ? parseInt(volumeTotal) : 0;
  if (!totalGeral && cluster?.total) {
    totalGeral = cluster.total;
  }

  // Identificar áreas afetadas e calcular volume por área
  const areasAfetadas = [];
  const volumePorArea = {};

  if (cluster?.itens) {
    for (const [clusterNome, quantidade] of Object.entries(cluster.itens)) {
      const { areaPainel } = mapearGrupoParaArea(clusterNome);
      if (areaPainel) {
        if (!areasAfetadas.includes(areaPainel)) {
          areasAfetadas.push(areaPainel);
        }
        volumePorArea[areaPainel] = (volumePorArea[areaPainel] || 0) + quantidade;
      }
    }
  }

  // Criar descrição resumida
  const descricaoPartes = [];
  if (tipo) descricaoPartes.push(`Tipo: ${tipo}`);
  if (sintoma?.itens) {
    descricaoPartes.push('Sintomas: ' + Object.entries(sintoma.itens).map(([k, v]) => `${k} (${v})`).join(', '));
  }
  if (status?.itens) {
    descricaoPartes.push('Status: ' + Object.entries(status.itens).map(([k, v]) => `${k} (${v})`).join(', '));
  }

  return {
    id: `cop_${messageId}_${Date.now()}`,
    messageId,
    dataRecebimento: dataMensagem.toISOString(),
    dataGeracao: horarioEnvio,
    empresa: 'Resumo COP',
    grupo: cluster?.itens ? Object.keys(cluster.itens).join(', ') : null,
    areaMapeada: areasAfetadas.length > 0 ? areasAfetadas.join(', ') : null,
    sigla: null,
    descricao: descricaoPartes.join('\n') || null,
    resumo: {
      mercado: {}, // Não tem mercado no novo formato
      tipo: tipo ? { [tipo]: totalGeral } : {},
      natureza: {}, // Não tem natureza no novo formato
      sintoma: sintoma?.itens || {},
      grupo: cluster?.itens || {}, // Usa clusters como grupos
      status: status?.itens || {},
      incidentes24h: incidentes24h?.itens || {},
      totalGeral
    },
    volumePorArea,
    areasAfetadas,
    totalEventos: totalGeral,
    mensagemOriginal: texto,
    origem: 'COP_REDE_INFORMA',
    processadoEm: new Date().toISOString()
  };
}

/**
 * Faz parsing completo de uma mensagem COP REDE INFORMA (formato resumo)
 * @param {string} texto - Texto completo da mensagem
 * @param {Date} dataMensagem - Data/hora da mensagem no Telegram
 * @param {number} messageId - ID da mensagem no Telegram
 * @returns {object} Objeto com campos extraídos
 */
function parseCopRedeInforma(texto, dataMensagem, messageId) {
  // Debug: mostrar texto completo para entender o formato
  console.log('[Parser] ========== PARSING COP REDE INFORMA ==========');
  console.log('[Parser] Texto completo (primeiros 800 chars):');
  console.log(texto.substring(0, 800));
  console.log('[Parser] ================================================');

  // Detectar NOVO formato 2026 (📢 COP REDE - INFORMA)
  if (texto.includes('📢 COP REDE - INFORMA') || texto.includes('Totais por Cluster')) {
    console.log('[Parser] Detectado NOVO formato 2026');
    return parseCopRedeInformaNovoFormato(texto, dataMensagem, messageId);
  }

  // Detectar tipo de formato
  // Formato 1: Resumo com seções (📊 COP REDE INFORMA 📊 + 🏢 MERCADO + 📍 GRUPO)
  const temFormatoResumo = texto.includes('📊') || texto.includes('🏢') || texto.includes('📍') ||
                           texto.includes('📂') || texto.includes('🍃') || texto.includes('🔍');

  // Formato 2: Incidente individual (🔴 + 📝 + ⚠ + 💥)
  const temFormatoIncidente = texto.includes('🔴') || texto.includes('📝') ||
                              (texto.includes('⚠') && texto.includes('Grupo:'));

  if (temFormatoResumo) {
    // FORMATO RESUMO: Com seções MERCADO/TIPO/NATUREZA/SINTOMA/GRUPO com emojis
    console.log('[Parser] Detectado formato resumo com emojis');
    return parseCopRedeInformaResumo(texto, dataMensagem, messageId);
  }

  if (temFormatoIncidente) {
    // FORMATO INCIDENTE: Com emojis de incidente individual
    console.log('[Parser] Detectado formato incidente com emojis');
    return parseCopRedeInformaEmoji(texto, dataMensagem, messageId);
  }

  // FORMATO ANTIGO: Com seções plain text
  console.log('[Parser] Tentando formato antigo com seções plain text');
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
    dataRecebimento: dataMensagem.toISOString(),
    empresa: 'Resumo COP',
    grupo: grupo?.itens ? Object.keys(grupo.itens).join(', ') : null,
    areaMapeada: areasAfetadas.length > 0 ? areasAfetadas.join(', ') : null,
    sigla: null,
    descricao: descricaoPartes.join('\n') || null,
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
 * Parser para formato COP REDE INFORMA com emojis (WhatsApp)
 * Formato:
 * COP REDE INFORMA:
 * 🔴 TITULO DO EVENTO
 * 📝REC/RAL (Referência): XXX
 * ⚠Grupo: CLUSTER XX
 * 🕒Horário de Abertura: dd/mm/aaaa - HH:MM
 * 🌎Cidade: NOME
 * ⏳Horário de Recebimento: dd/mm/aaaa - HH:MM
 * 💥Impacto: REC X RAL Y
 * 📜Status: TEXTO
 */
function parseCopRedeInformaEmoji(texto, dataMensagem, messageId) {
  console.log('[Parser] Parsing formato emoji...');

  // Extrair campos com emojis
  const extrairCampoEmoji = (emoji, nomesCampo) => {
    // nomesCampo pode ser string ou array de strings
    const nomes = Array.isArray(nomesCampo) ? nomesCampo : [nomesCampo];

    for (const nome of nomes) {
      // Tenta encontrar "emoji + nome + : + valor" ou "emoji + nome + valor"
      const regexComDoisPontos = new RegExp(`${emoji}\\s*${nome}[:\\s]+(.+?)(?:\\n|$)`, 'i');
      const matchComDoisPontos = texto.match(regexComDoisPontos);
      if (matchComDoisPontos) {
        return matchComDoisPontos[1].trim();
      }
    }

    // Tenta apenas com emoji no início da linha
    const regexSoEmoji = new RegExp(`${emoji}\\s*(.+?)(?:\\n|$)`, 'i');
    const matchSoEmoji = texto.match(regexSoEmoji);
    if (matchSoEmoji) {
      return matchSoEmoji[1].trim();
    }

    return null;
  };

  // Extrair título (linha após COP REDE INFORMA ou com emoji 🔴)
  let titulo = extrairCampoEmoji('🔴', '');
  if (!titulo) {
    const linhas = texto.split('\n');
    for (let i = 0; i < linhas.length; i++) {
      if (linhas[i].includes('COP REDE INFORMA') && i + 1 < linhas.length) {
        titulo = linhas[i + 1].replace(/^[🔴🟠🟡🟢⚪\s*]+/, '').trim();
        break;
      }
    }
  }

  // Extrair campos específicos
  const recRal = extrairCampoEmoji('📝', ['REC/RAL', 'RAL', 'REC']);
  const grupo = extrairCampoEmoji('⚠', ['Grupo', 'Cluster']);
  const horarioAbertura = extrairCampoEmoji('🕒', ['Horário de Abertura', 'Horario de Abertura', 'Abertura']);
  const cidade = extrairCampoEmoji('🌎', ['Cidade', 'Local']);
  const horarioRecebimento = extrairCampoEmoji('⏳', ['Horário de Recebimento', 'Recebimento']);
  const designacao = extrairCampoEmoji('✍', ['Designação', 'Designacao']);
  const motivoPrejuizo = extrairCampoEmoji('✍', ['Motivo do Prejuízo', 'Motivo', 'Prejuízo']);
  const impacto = extrairCampoEmoji('💥', ['Impacto']);
  const status = extrairCampoEmoji('📜', ['Status']);

  // Mapear grupo para área
  const { areaPainel } = mapearGrupoParaArea(grupo);

  // Extrair valores de impacto (REC X RAL Y)
  let impactoRec = 0, impactoRal = 0;
  if (impacto) {
    const matchRec = impacto.match(/REC\s*(\d+)/i);
    const matchRal = impacto.match(/RAL\s*(\d+)/i);
    if (matchRec) impactoRec = parseInt(matchRec[1]);
    if (matchRal) impactoRal = parseInt(matchRal[1]);
  }

  // Criar descrição
  const descricaoPartes = [];
  if (titulo) descricaoPartes.push(titulo);
  if (status) descricaoPartes.push(`Status: ${status}`);
  if (impacto) descricaoPartes.push(`Impacto: ${impacto}`);

  console.log('[Parser] Campos extraídos:');
  console.log(`  - Título: ${titulo}`);
  console.log(`  - Grupo: ${grupo}`);
  console.log(`  - Cidade: ${cidade}`);
  console.log(`  - Impacto: ${impacto} (REC: ${impactoRec}, RAL: ${impactoRal})`);
  console.log(`  - Status: ${status}`);

  return {
    id: `cop_${messageId}_${Date.now()}`,
    messageId,
    dataRecebimento: dataMensagem.toISOString(),
    empresa: 'COP REDE',
    grupo: grupo || null,
    areaMapeada: areaPainel || grupo || null,
    sigla: recRal || null,
    descricao: descricaoPartes.join(' | ') || titulo || null,
    // Dados específicos do formato emoji
    detalhes: {
      titulo,
      recRal,
      grupo,
      horarioAbertura,
      cidade,
      horarioRecebimento,
      designacao,
      motivoPrejuizo,
      impacto,
      impactoRec,
      impactoRal,
      status
    },
    // Para compatibilidade com frontend
    resumo: {
      mercado: cidade ? { [cidade]: 1 } : {},
      tipo: titulo ? { [titulo.substring(0, 50)]: 1 } : {},
      natureza: {},
      sintoma: {},
      grupo: grupo ? { [grupo]: 1 } : {},
      totalGeral: impactoRec + impactoRal || 1
    },
    areasAfetadas: areaPainel ? [areaPainel] : [],
    totalEventos: impactoRec + impactoRal || 1,
    mensagemOriginal: texto,
    origem: 'COP_REDE_INFORMA',
    processadoEm: new Date().toISOString()
  };
}

/**
 * Parser para formato COP REDE INFORMA resumo com emojis
 * Formato:
 * 📊 COP REDE INFORMA 📊
 * 🗓️ Gerado em: dd/mm/aaaa às HH:MM
 * 🏢 MERCADO:
 * 🔹 residencial: 47
 * 📂 TIPO:
 * 📡 OTG HFC Fibra: 4
 * 📍 GRUPO / CLUSTER:
 * ☕ Minas Gerais: 12
 */
function parseCopRedeInformaResumo(texto, dataMensagem, messageId) {
  console.log('[Parser] Parsing formato resumo com emojis...');

  // Remover marcadores de bold (*) e itálico (_) para facilitar o parsing
  const textoLimpo = texto.replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1');
  console.log('[Parser] Texto limpo (sem bold/italic):', textoLimpo.substring(0, 300));

  /**
   * Extrai uma seção do formato com emoji no cabeçalho
   * @param {string} nomeSecao - Nome da seção (ex: 'MERCADO', 'GRUPO')
   */
  const extrairSecaoEmoji = (nomeSecao) => {
    // Procura por padrões como "🏢 MERCADO:", "📍 GRUPO / CLUSTER:", etc.
    const regexSecao = new RegExp(`[📊🏢📂🍃🔍📍🗓️🚨]+\\s*${nomeSecao}[^:\\n]*:\\s*\\n`, 'i');
    const matchSecao = textoLimpo.match(regexSecao);

    if (!matchSecao) {
      console.log(`[Parser] Seção ${nomeSecao} não encontrada`);
      return null;
    }

    const posInicio = textoLimpo.indexOf(matchSecao[0]) + matchSecao[0].length;
    const restoTexto = textoLimpo.substring(posInicio);

    // Encontra a próxima seção (linha com emoji de seção ou linha de separação)
    const regexProxima = /\n[📊🏢📂🍃🔍📍🗓️🚨────]+\s*[A-ZÁÉÍÓÚ]/;
    const matchProxima = restoTexto.match(regexProxima);

    let conteudo;
    if (matchProxima) {
      conteudo = restoTexto.substring(0, matchProxima.index);
    } else {
      conteudo = restoTexto;
    }

    console.log(`[Parser] Seção ${nomeSecao} encontrada, ${conteudo.length} chars`);

    // Extrair itens - cada linha com emoji seguido de "nome: valor"
    const itens = {};
    let total = 0;

    const linhas = conteudo.split('\n');
    for (const linha of linhas) {
      const linhaLimpa = linha.trim();
      if (!linhaLimpa) continue;

      // Remove emojis do início da linha
      const semEmoji = linhaLimpa.replace(/^[^\w\sÀ-ÿ]+\s*/, '').trim();

      // Tenta extrair "nome: valor"
      const match = semEmoji.match(/^(.+?):\s*(\d+)\s*$/);
      if (match) {
        const nome = match[1].trim();
        const valor = parseInt(match[2]);
        itens[nome] = valor;
        total += valor;
        console.log(`[Parser]   -> ${nome}: ${valor}`);
      }
    }

    return { itens, total };
  };

  // Extrair data de geração (pode ter _itálico_ ou *bold*)
  const matchData = textoLimpo.match(/🗓️\s*Gerado em:\s*(\d{2}\/\d{2}\/\d{4})\s*às?\s*(\d{2}:\d{2})/i);
  const dataGeracao = matchData ? `${matchData[1]} ${matchData[2]}` : null;
  console.log(`[Parser] Data de geração: ${dataGeracao}`);

  // Extrair seções
  const mercado = extrairSecaoEmoji('MERCADO');
  const tipo = extrairSecaoEmoji('TIPO');
  const natureza = extrairSecaoEmoji('NATUREZA');
  const sintoma = extrairSecaoEmoji('SINTOMA');
  const grupo = extrairSecaoEmoji('GRUPO');

  // Calcular total geral
  const totalGeral = grupo?.total || mercado?.total || tipo?.total || 0;

  // Identificar áreas afetadas e calcular volume por área
  const areasAfetadas = [];
  const volumePorArea = {};

  if (grupo?.itens) {
    for (const [grupoNome, quantidade] of Object.entries(grupo.itens)) {
      const { areaPainel } = mapearGrupoParaArea(grupoNome);
      if (areaPainel) {
        if (!areasAfetadas.includes(areaPainel)) {
          areasAfetadas.push(areaPainel);
        }
        volumePorArea[areaPainel] = (volumePorArea[areaPainel] || 0) + quantidade;
      }
    }
  }

  console.log('[Parser] Volume por área:', volumePorArea);

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
    dataRecebimento: dataMensagem.toISOString(),
    dataGeracao,
    empresa: 'Resumo COP',
    grupo: grupo?.itens ? Object.keys(grupo.itens).join(', ') : null,
    areaMapeada: areasAfetadas.length > 0 ? areasAfetadas.join(', ') : null,
    sigla: null,
    descricao: descricaoPartes.join('\n') || null,
    resumo: {
      mercado: mercado?.itens || {},
      tipo: tipo?.itens || {},
      natureza: natureza?.itens || {},
      sintoma: sintoma?.itens || {},
      grupo: grupo?.itens || {},
      totalGeral
    },
    volumePorArea,
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
