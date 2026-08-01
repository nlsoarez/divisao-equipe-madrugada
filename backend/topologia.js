/**
 * Normalização, parsing e classificação compartilhados da validação de
 * topologia no Visium.
 *
 * Usado pelo backend central (server.js) e pelo helper local
 * (local-visium-helper.js) para garantir que as duas pontas apliquem
 * exatamente as mesmas regras de normalização de incidentes.
 */

function normalizarTopologia(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function decodificarEntidades(texto) {
  return String(texto || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");
}

function pareceLogin(texto) {
  const t = normalizarTopologia(texto);
  return (
    t.includes('senha') &&
    (t.includes('login') || t.includes('usuario') || t.includes('autenticacao'))
  ) || t.includes('sign in');
}

function compactarCodigo(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizarNapGponConsulta(valor) {
  const texto = String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
  const matchSeparado = texto.match(/^([A-Z]{2,3})[^A-Z0-9]*([A-Z]{2})[^A-Z0-9]*(\d{3})[^A-Z0-9]*00[^A-Z0-9]*(\d{2,3})$/);
  if (matchSeparado) return `${matchSeparado[1]}${matchSeparado[2]}${matchSeparado[3]}M${matchSeparado[4]}`;

  const compacto = compactarCodigo(texto);
  const matchCompacto = compacto.match(/^([A-Z]{4,5}\d{3})00(\d{2,3})$/);
  if (matchCompacto) return `${matchCompacto[1]}M${matchCompacto[2]}`;
  return compacto;
}

function normalizarOpcao(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairNodesTopologia(valor) {
  const texto = String(valor || '').replace(/([A-Z]{2,3}\s*[^A-Z0-9]\s*[A-Z]{2}\s*[^A-Z0-9]\s*\d{3}\s*[^A-Z0-9]\s*00)\s*,\s*(\d{2,3})(?=$|[\s,;|])/gi, '$1.$2');
  const partes = texto
    .split(/[,;|]+/)
    .map((parte) => parte.trim())
    .filter(Boolean);
  const origem = partes.length ? partes : [String(valor || '').trim()];
  return Array.from(new Set(origem
    .map((parte) => ({ original: parte, compacto: compactarCodigo(parte) }))
    .filter((node) => node.compacto.length >= 4)
    .map((node) => node.original)));
}

/**
 * Nodes HFC são códigos alfanuméricos sem separadores. Alguns nodes reais
 * ultrapassam oito caracteres (ex.: GRTABB1RP), portanto o tamanho não pode
 * ser usado para classificá-los como GPON. NAPs GPON chegam com separadores.
 */
function ehNodeHfcConsultaNode(valor) {
  const bruto = String(valor || '').trim();
  const compacto = compactarCodigo(bruto);
  return compacto.length >= 4 &&
    compacto.length <= 16 &&
    /^[A-Z0-9]+$/i.test(bruto);
}

/**
 * A topologia pode trazer o node-base junto de derivações que o Visium já
 * devolve dentro da mesma consulta (GRTABA + GRTABA1/GRTABA2, por exemplo).
 * Consultar as derivações novamente provoca correspondência parcial e leitura
 * repetida da tabela do node-base. Remove somente sufixos conhecidos quando o
 * código-base também está presente, preservando nodes independentes.
 */
function reduzirNodesHfcRedundantes(nodes) {
  const unicos = Array.from(new Map((nodes || [])
    .map((node) => [compactarCodigo(node), node])
    .filter(([codigo]) => codigo)).values());

  return unicos.filter((node) => {
    const codigo = compactarCodigo(node);
    return !unicos.some((candidatoBase) => {
      const base = compactarCodigo(candidatoBase);
      if (base === codigo || base.length < 4 || !codigo.startsWith(base)) return false;
      const sufixo = codigo.slice(base.length);
      return /^\d{1,2}$/.test(sufixo) || /^\d{1,2}R[A-Z]{1,2}$/.test(sufixo);
    });
  });
}

/**
 * Impede que uma consulta sequencial aceite a tabela deixada pelo node
 * anterior. Subnodes retornados pelo Visium normalmente acrescentam um sufixo
 * ao código solicitado (AC1J -> AC1J-1), nunca trocam o código-base.
 */
function tabelaCorrespondeNode(tabela, node) {
  const alvo = compactarCodigo(node);
  if (!alvo || !tabela?.found || !Array.isArray(tabela.subnodes)) return false;
  return tabela.subnodes.some((subnode) => {
    const retornado = compactarCodigo(subnode?.name);
    return retornado === alvo || retornado.startsWith(alvo);
  });
}

function motivoGponPendente(node) {
  return `NAP/GPON pendente: ${node} nao deve ser pesquisado na tela HFC ConsultaInterfaceNode.`;
}

/**
 * Erros que indicam falha de acesso ao Visium como um todo (VPN, login,
 * timeout) — não vale a pena insistir nos próximos nodes do ciclo.
 */
function erroGlobalVisium(mensagem) {
  return /timeout|ENOTFOUND|ECONN|EHOST|Visium HTTP|campo de cidade|exigiu login|login no Vision HFC/i.test(mensagem || '');
}

function extrairAtributoHtml(tag, nome) {
  const re = new RegExp(`${nome}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = String(tag || '').match(re);
  return match ? decodificarEntidades(match[2] || match[3] || match[4] || '') : '';
}

function extrairFormulario(html) {
  const campos = {};
  const formMatch = String(html || '').match(/<form\b[\s\S]*?<\/form>/i);
  const formHtml = formMatch ? formMatch[0] : String(html || '');

  for (const match of formHtml.matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const name = extrairAtributoHtml(tag, 'name');
    if (!name) continue;
    const type = extrairAtributoHtml(tag, 'type').toLowerCase();
    if ((type === 'checkbox' || type === 'radio') && !/\schecked\b/i.test(tag)) continue;
    campos[name] = extrairAtributoHtml(tag, 'value');
  }

  for (const match of formHtml.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)) {
    const selectHtml = match[0];
    const name = extrairAtributoHtml(selectHtml, 'name');
    if (!name) continue;
    const selected = selectHtml.match(/<option\b[^>]*selected[^>]*>/i);
    const first = selected ? selected[0] : (selectHtml.match(/<option\b[^>]*>/i) || [''])[0];
    campos[name] = extrairAtributoHtml(first, 'value');
  }

  return campos;
}

function encontrarNomeCampo(html, fragmento) {
  const normalizado = fragmento.toLowerCase();
  for (const match of String(html || '').matchAll(/<(?:select|input|button)\b[^>]*>/gi)) {
    const tag = match[0];
    const id = extrairAtributoHtml(tag, 'id').toLowerCase();
    const name = extrairAtributoHtml(tag, 'name');
    if (id.includes(normalizado) || name.toLowerCase().includes(normalizado)) return name || id;
  }
  return '';
}

function extrairOpcoesSelect(html, fragmento) {
  const normalizado = fragmento.toLowerCase();
  for (const match of String(html || '').matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)) {
    const selectHtml = match[0];
    const id = extrairAtributoHtml(selectHtml, 'id').toLowerCase();
    const name = extrairAtributoHtml(selectHtml, 'name').toLowerCase();
    if (!id.includes(normalizado) && !name.includes(normalizado)) continue;
    return Array.from(selectHtml.matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/gi)).map((optionMatch) => {
      const tag = optionMatch[0];
      const value = extrairAtributoHtml(tag, 'value');
      const text = decodificarEntidades(tag.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
      return { value, text };
    }).filter((option) => option.value || option.text);
  }
  return [];
}

function escolherOpcao(opcoes, alvo) {
  const alvoNorm = normalizarOpcao(alvo);
  const alvoCompacto = compactarCodigo(alvo);
  const candidatas = (opcoes || []).filter((opcao) => {
    const texto = normalizarOpcao(opcao.text || opcao.value);
    return texto && !texto.includes('SELECIONE') && !texto.includes('ESCOLHA');
  });
  return candidatas.find((opcao) => normalizarOpcao(opcao.text) === alvoNorm) ||
    candidatas.find((opcao) => compactarCodigo(opcao.text) === alvoCompacto) ||
    candidatas.find((opcao) => {
      const texto = normalizarOpcao(opcao.text);
      return texto.includes(alvoNorm) || alvoNorm.includes(texto);
    }) ||
    candidatas.find((opcao) => {
      const texto = compactarCodigo(opcao.text);
      return texto.includes(alvoCompacto) || alvoCompacto.includes(texto);
    }) ||
    null;
}

function extrairActionFormulario(html) {
  const form = String(html || '').match(/<form\b[^>]*>/i);
  return form ? extrairAtributoHtml(form[0], 'action') : '';
}

function textoCelulaHtml(celula) {
  return decodificarEntidades(String(celula || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseCmr(valor) {
  let texto = String(valor || '').trim();
  if (!texto || texto === '-' || texto === '—') return null;
  texto = texto.replace(/\./g, '').replace(/,.*/, '').replace(/[^\d-]/g, '');
  if (!texto || texto === '-') return null;
  const numero = parseInt(texto, 10);
  return Number.isNaN(numero) ? null : numero;
}

function localizarIndiceCabecalho(celulas, nomes) {
  const alvos = (nomes || []).map((nome) => normalizarTopologia(nome));
  return celulas.findIndex((celula) => {
    const texto = normalizarTopologia(celula);
    return alvos.some((alvo) => texto === alvo || texto.includes(alvo));
  });
}

function lerTabelaVisium(html) {
  for (const tableMatch of String(html || '').matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
    const table = tableMatch[0];
    const rows = Array.from(table.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)).map((rowMatch) => rowMatch[0]);
    if (!rows.length) continue;

    const headerCells = Array.from(rows[0].matchAll(/<t[hd]\b[\s\S]*?<\/t[hd]>/gi)).map((m) => textoCelulaHtml(m[0]));
    let nodeIdx = localizarIndiceCabecalho(headerCells, ['NODE']);
    let cmrIdx = localizarIndiceCabecalho(headerCells, ['CM-R', 'CMR', 'CM R', 'CM-REG', 'CM REG']);
    if (nodeIdx < 0 || cmrIdx < 0) {
      nodeIdx = 3;
      cmrIdx = 9;
    }

    const grupos = {};
    let linhasDados = 0;
    for (const row of rows.slice(1)) {
      const cells = Array.from(row.matchAll(/<td\b[\s\S]*?<\/td>/gi)).map((m) => textoCelulaHtml(m[0]));
      if (cells.length <= Math.max(nodeIdx, cmrIdx)) continue;
      const nodeName = cells[nodeIdx];
      const cmr = parseCmr(cells[cmrIdx]);
      if (!nodeName || cmr == null) continue;
      linhasDados += 1;
      if (!grupos[nodeName]) grupos[nodeName] = [];
      grupos[nodeName].push(cmr);
    }

    const subnodes = Object.keys(grupos).sort().map((name) => {
      const cmrs = grupos[name];
      const up = cmrs.length > 0 && cmrs.every((cmr) => cmr !== 0);
      return {
        name,
        up,
        rows: cmrs.length,
        downRows: cmrs.filter((cmr) => cmr === 0).length,
        cmrs
      };
    });
    if (subnodes.length) return { found: true, subnodes, rows: linhasDados };
  }
  return { found: false, subnodes: [], rows: 0 };
}

/**
 * Regra única de status de uma topologia a partir das consultas dos nodes:
 * - qualquer node DOWN confirmado => 'down'
 * - todos os nodes consultados e UP => 'up'
 * - qualquer outra combinação => 'indeterminado' (com motivo)
 */
function classificarStatusConsultas(consultas) {
  const lista = Array.isArray(consultas) ? consultas : [];
  const validas = lista.filter((c) => c.status === 'up' || c.status === 'down');
  const gponPendentes = lista.filter((c) => c.tipo === 'gpon-pendente');
  if (validas.some((c) => c.status === 'down')) return { status: 'down', motivo: null };
  if (validas.length > 0 && validas.length === lista.length) return { status: 'up', motivo: null };
  return {
    status: 'indeterminado',
    motivo: gponPendentes.length
      ? 'NAP/GPON nao foi consultado no HFC; motor GPON pendente'
      : 'Visium nao retornou diagnostico completo para todos os nodes'
  };
}

/**
 * Ciclo de validação compartilhado: recebe os itens do frontend e uma
 * função consultarNode(cidade, node) específica de cada ambiente
 * (HTTP direto no backend central, HTTP+navegador no helper local).
 *
 * Retorna também `falhaGlobalVisium` para o frontend saber quando o
 * ciclo inteiro falhou (ex.: backend central sem VPN) e não anunciar
 * falso sucesso.
 */
async function validarTopologias(itens, opcoes) {
  const {
    consultarNode,
    consultarGpon,
    site = 'Visium',
    sitesConsultados = ['Visium Live'],
    onGponPendente
  } = opcoes || {};
  if (typeof consultarNode !== 'function') throw new Error('consultarNode obrigatorio para validar topologias');

  const testadoEm = Date.now();
  const validos = (Array.isArray(itens) ? itens : []).filter((item) => item && normalizarTopologia(item.topologia));
  const resultados = [];
  const avisos = [];
  let falhaGlobalVisium = null;

  for (const item of validos) {
    const nodes = extrairNodesTopologia(item.topologia);
    const cidade = item.cidade || item.nm_cidade || '';
    const consultas = [];

    if (!cidade) {
      resultados.push({
        id: item.id || null,
        topologia: item.topologia,
        cidade,
        nodes: nodes.map((node) => compactarCodigo(node)),
        status: 'indeterminado',
        site,
        sitesConsultados,
        motivo: 'cidade ausente para consultar o Visium',
        consultas,
        testadoEm
      });
      continue;
    }

    const hfcNodes = reduzirNodesHfcRedundantes(nodes.filter((node) => ehNodeHfcConsultaNode(node)));
    const gponNodes = nodes.filter((node) => !ehNodeHfcConsultaNode(node));

    if (gponNodes.length) {
      if (typeof consultarGpon === 'function') {
        try {
          const retorno = await consultarGpon(cidade, gponNodes, item);
          const porNap = {};
          for (const nap of retorno?.naps || []) {
            porNap[compactarCodigo(nap.nap)] = nap;
            porNap[normalizarNapGponConsulta(nap.nap)] = nap;
          }
          for (const node of gponNodes) {
            const encontrado = porNap[compactarCodigo(node)] || porNap[normalizarNapGponConsulta(node)];
            if (!encontrado) {
              const mensagem = `NAP nao retornada na consulta GPON: ${node}`;
              consultas.push({ node, cidade, status: 'indeterminado', erro: mensagem, tipo: 'gpon' });
              avisos.push(`${cidade}/${node}: ${mensagem}`);
              continue;
            }
            consultas.push({
              node,
              cidade,
              status: encontrado.up ? 'up' : 'down',
              tipo: 'gpon',
              nap: encontrado.nap,
              total: encontrado.total,
              online: encontrado.online,
              offline: encontrado.offline,
              unknown: encontrado.unknown,
              ratio: encontrado.ratio,
              rows: retorno.rows,
              sourceUrl: retorno.sourceUrl,
              modo: retorno.modo
            });
          }
        } catch (error) {
          const mensagem = error.message || 'erro desconhecido no GPON';
          for (const node of gponNodes) {
            consultas.push({ node, cidade, status: 'indeterminado', erro: mensagem, tipo: 'gpon' });
            avisos.push(`${cidade}/${node}: ${mensagem}`);
          }
        }
      } else {
        for (const node of gponNodes) {
          let retornoGpon = null;
          let erroGpon = null;
          if (typeof onGponPendente === 'function') {
            try {
              retornoGpon = await onGponPendente({ item, node, cidade });
            } catch (error) {
              erroGpon = error.message || 'erro ao preparar GPON';
            }
          }
          const complemento = retornoGpon?.mensagem
            ? ` ${retornoGpon.mensagem}`
            : (erroGpon ? ` Falha ao preparar GPON: ${erroGpon}.` : '');
          const mensagem = `${motivoGponPendente(node)}${complemento}`;
          consultas.push({
            node,
            cidade,
            status: 'indeterminado',
            erro: mensagem,
            tipo: 'gpon-pendente',
            ...(retornoGpon?.consulta || {})
          });
          avisos.push(`${cidade}/${node}: ${mensagem}`);
        }
      }
    }

    for (const node of hfcNodes) {
      if (falhaGlobalVisium) {
        consultas.push({ node, cidade, status: 'indeterminado', erro: falhaGlobalVisium });
        continue;
      }
      try {
        consultas.push(await consultarNode(cidade, node));
      } catch (error) {
        const mensagem = error.message || 'erro desconhecido no Visium';
        consultas.push({ node, cidade, status: 'indeterminado', erro: mensagem });
        avisos.push(`${cidade}/${node}: ${mensagem}`);
        if (erroGlobalVisium(mensagem)) falhaGlobalVisium = mensagem;
      }
    }

    const { status, motivo } = classificarStatusConsultas(consultas);
    resultados.push({
      id: item.id || null,
      topologia: item.topologia,
      cidade,
      nodes: nodes.map((node) => compactarCodigo(node)),
      status,
      site,
      sitesConsultados,
      motivo,
      consultas,
      testadoEm
    });
  }

  return { ok: true, resultados, avisos, testadoEm, falhaGlobalVisium };
}

module.exports = {
  normalizarTopologia,
  decodificarEntidades,
  pareceLogin,
  compactarCodigo,
  normalizarNapGponConsulta,
  normalizarOpcao,
  extrairNodesTopologia,
  ehNodeHfcConsultaNode,
  reduzirNodesHfcRedundantes,
  tabelaCorrespondeNode,
  motivoGponPendente,
  erroGlobalVisium,
  extrairAtributoHtml,
  extrairFormulario,
  encontrarNomeCampo,
  extrairOpcoesSelect,
  escolherOpcao,
  extrairActionFormulario,
  textoCelulaHtml,
  parseCmr,
  localizarIndiceCabecalho,
  lerTabelaVisium,
  classificarStatusConsultas,
  validarTopologias
};
