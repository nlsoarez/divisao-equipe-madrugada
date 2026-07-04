/**
 * Helper local para validar nodes no Visium usando a rede/VPN da maquina.
 *
 * Rode na maquina conectada na VPN:
 *   npm run visium-helper
 *
 * O site publico chama http://127.0.0.1:4789, o helper consulta o Visium
 * pela VPN local e registra o resultado no backend central para todos.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = process.env.NODE_TLS_REJECT_UNAUTHORIZED || '0';

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const https = require('https');

const HELPER_VERSION = '2026-07-03-tls-global';
const PORT = Number(process.env.VISIUM_HELPER_PORT || 4789);
const HOST = process.env.VISIUM_HELPER_HOST || '127.0.0.1';
const VISIUM_BASE_URL = process.env.VISIUM_BASE_URL || 'http://201.55.234.76/Consultas_/ConsultaInterfaceNode';
const VISIUM_TIMEOUT_MS = Number(process.env.VISIUM_TIMEOUT_MS || 25000);
const BACKEND_URL_DEFAULT = process.env.CENTRAL_BACKEND_URL || 'https://divisao-equipe-madrugada-production.up.railway.app';
const CENTRAL_BACKEND_TLS_INSEGURO = String(process.env.CENTRAL_BACKEND_TLS_INSEGURO || '1') !== '0';
const ORIGEM_FRONTEND = 'admin-manual-v6';
const ORIGEM_REGISTRO = 'local-helper-v1';
const centralBackendAgent = CENTRAL_BACKEND_TLS_INSEGURO ? new https.Agent({ rejectUnauthorized: false }) : null;

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

function normalizarTexto(valor) {
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
  const t = normalizarTexto(texto);
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

function normalizarOpcao(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairNodesTopologia(valor) {
  const partes = String(valor || '')
    .split(/[,;|]+/)
    .map((parte) => parte.trim())
    .filter(Boolean);
  const origem = partes.length ? partes : [String(valor || '').trim()];
  return Array.from(new Set(origem
    .map((parte) => ({ original: parte, compacto: compactarCodigo(parte) }))
    .filter((node) => node.compacto.length >= 4)
    .map((node) => node.original)));
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

function criarClienteVisium() {
  const cookies = new Map();

  function cookieHeader() {
    return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function armazenarCookies(headers) {
    const setCookie = typeof headers.raw === 'function'
      ? (headers.raw()['set-cookie'] || [])
      : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
    for (const item of setCookie) {
      const partes = String(item || '').split(/,(?=\s*[^;,=\s]+=)/);
      for (const parte of partes) {
        const first = parte.split(';')[0].trim();
        const idx = first.indexOf('=');
        if (idx > 0) cookies.set(first.slice(0, idx), first.slice(idx + 1));
      }
    }
  }

  async function requisitar(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VISIUM_TIMEOUT_MS);
    try {
      const headers = {
        'User-Agent': 'coprede-visium-local-helper/1.0',
        ...(options.headers || {})
      };
      const cookie = cookieHeader();
      if (cookie) headers.Cookie = cookie;
      const response = await fetch(url, { ...options, headers, signal: controller.signal });
      armazenarCookies(response.headers);
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error(`timeout ao acessar Visium (${VISIUM_TIMEOUT_MS}ms)`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { requisitar };
}

function montarUrl(action) {
  if (!action) return VISIUM_BASE_URL;
  try {
    return new URL(action, VISIUM_BASE_URL).toString();
  } catch (_) {
    return VISIUM_BASE_URL;
  }
}

function extrairActionFormulario(html) {
  const form = String(html || '').match(/<form\b[^>]*>/i);
  return form ? extrairAtributoHtml(form[0], 'action') : '';
}

async function postarFormulario(cliente, html, camposExtras) {
  const campos = { ...extrairFormulario(html), ...(camposExtras || {}) };
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(campos)) body.append(key, value == null ? '' : String(value));
  return await cliente.requisitar(montarUrl(extrairActionFormulario(html)), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: VISIUM_BASE_URL
    },
    body: body.toString()
  });
}

function textoCelulaHtml(celula) {
  return decodificarEntidades(String(celula || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function parseCmr(valor) {
  let texto = String(valor || '').trim();
  if (!texto || texto === '-') return null;
  texto = texto.replace(/\./g, '').replace(/,.*/, '').replace(/[^\d-]/g, '');
  if (!texto || texto === '-') return null;
  const numero = parseInt(texto, 10);
  return Number.isNaN(numero) ? null : numero;
}

function localizarIndiceCabecalho(celulas, nomes) {
  const alvos = (nomes || []).map((nome) => normalizarTexto(nome));
  return celulas.findIndex((celula) => {
    const texto = normalizarTexto(celula);
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

async function consultarVisiumNode(cidade, node) {
  const cliente = criarClienteVisium();
  const inicial = await cliente.requisitar(VISIUM_BASE_URL);
  if (!inicial.response.ok) throw new Error(`Visium HTTP ${inicial.response.status}`);
  if (pareceLogin(inicial.text)) throw new Error('Visium exigiu login/sessao');

  const campoCidade = encontrarNomeCampo(inicial.text, 'ddlCidade');
  const campoNodeInicial = encontrarNomeCampo(inicial.text, 'ddlNode');
  if (!campoCidade) throw new Error('campo de cidade do Visium nao encontrado');

  const cidadeOpt = escolherOpcao(extrairOpcoesSelect(inicial.text, 'ddlCidade'), cidade);
  if (!cidadeOpt) throw new Error(`cidade nao encontrada no Visium: ${cidade}`);

  const cidadeResp = await postarFormulario(cliente, inicial.text, {
    [campoCidade]: cidadeOpt.value,
    __EVENTTARGET: campoCidade,
    __EVENTARGUMENT: ''
  });
  if (!cidadeResp.response.ok) throw new Error(`Visium cidade HTTP ${cidadeResp.response.status}`);

  const campoNode = encontrarNomeCampo(cidadeResp.text, 'ddlNode') || campoNodeInicial;
  const nodeOpt = escolherOpcao(extrairOpcoesSelect(cidadeResp.text, 'ddlNode'), node);
  if (!campoNode || !nodeOpt) throw new Error(`node nao encontrado no dropdown do Visium: ${node}`);

  const campoConsultar = encontrarNomeCampo(cidadeResp.text, 'btn_consultar') ||
    encontrarNomeCampo(cidadeResp.text, 'consultar');
  const extras = {
    [campoCidade]: cidadeOpt.value,
    [campoNode]: nodeOpt.value,
    __EVENTTARGET: '',
    __EVENTARGUMENT: ''
  };
  if (campoConsultar) extras[campoConsultar] = 'Consultar';

  const consultaResp = await postarFormulario(cliente, cidadeResp.text, extras);
  if (!consultaResp.response.ok) throw new Error(`Visium consulta HTTP ${consultaResp.response.status}`);
  const tabela = lerTabelaVisium(consultaResp.text);
  if (!tabela.found) throw new Error('tabela de resultado do Visium vazia ou nao encontrada');
  const allUp = tabela.subnodes.every((subnode) => subnode.up);
  return {
    cidade: cidadeOpt.text || cidade,
    node: nodeOpt.text || node,
    status: allUp ? 'up' : 'down',
    up: allUp,
    subnodes: tabela.subnodes,
    rows: tabela.rows,
    sourceUrl: VISIUM_BASE_URL
  };
}

async function validarTopologias(itens) {
  const testadoEm = Date.now();
  const validos = (Array.isArray(itens) ? itens : []).filter((item) => item && normalizarTexto(item.topologia));
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
        site: 'Visium Local',
        sitesConsultados: ['Visium Live via helper local'],
        motivo: 'cidade ausente para consultar o Visium',
        consultas,
        testadoEm
      });
      continue;
    }

    for (const node of nodes) {
      if (falhaGlobalVisium) {
        consultas.push({ node, cidade, status: 'indeterminado', erro: falhaGlobalVisium });
        continue;
      }
      try {
        consultas.push(await consultarVisiumNode(cidade, node));
      } catch (error) {
        const mensagem = error.message || 'erro desconhecido no Visium';
        consultas.push({ node, cidade, status: 'indeterminado', erro: mensagem });
        avisos.push(`${cidade}/${node}: ${mensagem}`);
        if (/timeout|ENOTFOUND|ECONN|EHOST|Visium HTTP|campo de cidade|exigiu login/i.test(mensagem)) {
          falhaGlobalVisium = mensagem;
        }
      }
    }

    const consultasValidas = consultas.filter((consulta) => consulta.status === 'up' || consulta.status === 'down');
    let status = 'indeterminado';
    if (consultasValidas.length > 0 && consultasValidas.length === consultas.length) {
      status = consultasValidas.every((consulta) => consulta.status === 'up') ? 'up' : 'down';
    }

    resultados.push({
      id: item.id || null,
      topologia: item.topologia,
      cidade,
      nodes: nodes.map((node) => compactarCodigo(node)),
      status,
      site: 'Visium Local',
      sitesConsultados: ['Visium Live via helper local'],
      motivo: status === 'indeterminado' ? 'Visium local nao retornou diagnostico completo para todos os nodes' : null,
      consultas,
      testadoEm
    });
  }

  return { ok: true, resultados, avisos, testadoEm };
}

async function registrarNoBackendCentral(backendUrl, validacao) {
  const base = String(backendUrl || BACKEND_URL_DEFAULT).replace(/\/+$/, '');
  const response = await fetch(`${base}/api/topologia-validacao/registrar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ origem: ORIGEM_REGISTRO, validacao }),
    agent: base.startsWith('https://') ? centralBackendAgent : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.sucesso) {
    throw new Error(data.erro || `backend central HTTP ${response.status}`);
  }
  return data;
}

app.get('/health', (req, res) => {
  res.json({
    sucesso: true,
    helper: 'visium-local',
    version: HELPER_VERSION,
    visiumBaseUrl: VISIUM_BASE_URL,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/topologia-validacao/validar', async (req, res) => {
  try {
    if (req.body?.origem !== ORIGEM_FRONTEND) {
      return res.status(400).json({ sucesso: false, erro: 'Origem invalida para helper local.' });
    }
    const validacao = await validarTopologias(req.body?.itens || []);
    const central = await registrarNoBackendCentral(req.body?.backendUrl, validacao);
    res.json({ ...central, origem: 'helper-local-vpn' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[Visium Helper] Versao: ${HELPER_VERSION}`);
  console.log(`[Visium Helper] Online em http://${HOST}:${PORT}`);
  console.log(`[Visium Helper] Visium: ${VISIUM_BASE_URL}`);
  console.log(`[Visium Helper] Backend central: ${BACKEND_URL_DEFAULT}`);
  console.log('[Visium Helper] TLS do backend central: modo compativel com certificado corporativo');
});
