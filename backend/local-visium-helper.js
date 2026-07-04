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
const path = require('path');

const HELPER_VERSION = '2026-07-04-cookie-isolation';
const PORT = Number(process.env.VISIUM_HELPER_PORT || 4789);
const HOST = process.env.VISIUM_HELPER_HOST || '127.0.0.1';
const VISIUM_BASE_URL = process.env.VISIUM_BASE_URL || 'http://201.55.234.76/Consultas_/ConsultaInterfaceNode';
const VISIUM_LOGIN_URL = process.env.VISIUM_LOGIN_URL || 'http://201.55.234.76/';
const VISIUM_GPON_LOGIN_URL = process.env.VISIUM_GPON_LOGIN_URL || 'http://201.55.234.76:8080/Login';
const VISIUM_GPON_CONSULTA_URL = process.env.VISIUM_GPON_CONSULTA_URL || 'http://201.55.234.76:8080/ConsultasGPON_/ConsultaOntLista';
const VISIUM_TIMEOUT_MS = Number(process.env.VISIUM_TIMEOUT_MS || 60000);
const VISIUM_LOGIN_WAIT_MS = Number(process.env.VISIUM_LOGIN_WAIT_MS || 180000);
const VISIUM_NODE_OPTION_WAIT_MS = Number(process.env.VISIUM_NODE_OPTION_WAIT_MS || 30000);
const VISIUM_AFTER_CITY_WAIT_MS = Number(process.env.VISIUM_AFTER_CITY_WAIT_MS || 1800);
const VISIUM_AFTER_QUERY_WAIT_MS = Number(process.env.VISIUM_AFTER_QUERY_WAIT_MS || 1200);
const VISIUM_NODE_STABLE_MS = Number(process.env.VISIUM_NODE_STABLE_MS || 5000);
const VISIUM_GPON_QUERY_BASE_MS = Number(process.env.VISIUM_GPON_QUERY_BASE_MS || 45000);
const VISIUM_GPON_QUERY_PER_NAP_MS = Number(process.env.VISIUM_GPON_QUERY_PER_NAP_MS || 2500);
const VISIUM_GPON_QUERY_MARGIN_MS = Number(process.env.VISIUM_GPON_QUERY_MARGIN_MS || 120000);
const VISIUM_BROWSER_ENABLED = String(process.env.VISIUM_BROWSER_ENABLED || '1') !== '0';
const VISIUM_BROWSER_PROFILE_BASE = process.env.VISIUM_BROWSER_PROFILE ||
  path.join(process.env.USERPROFILE || process.cwd(), 'visium-helper', 'browser-profile');
const VISIUM_BROWSER_PROFILE_HFC = process.env.VISIUM_BROWSER_PROFILE_HFC ||
  `${VISIUM_BROWSER_PROFILE_BASE}-hfc`;
const VISIUM_BROWSER_PROFILE_GPON = process.env.VISIUM_BROWSER_PROFILE_GPON ||
  `${VISIUM_BROWSER_PROFILE_BASE}-gpon`;
const BACKEND_URL_DEFAULT = process.env.CENTRAL_BACKEND_URL || 'https://divisao-equipe-madrugada-production.up.railway.app';
const CENTRAL_BACKEND_TLS_INSEGURO = String(process.env.CENTRAL_BACKEND_TLS_INSEGURO || '1') !== '0';
const ORIGEM_FRONTEND = 'admin-manual-v6';
const ORIGEM_REGISTRO = 'local-helper-v1';
const centralBackendAgent = CENTRAL_BACKEND_TLS_INSEGURO ? new https.Agent({ rejectUnauthorized: false }) : null;
const browserContextPromises = {
  hfc: null,
  gpon: null
};

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));

// Normalizacao/parsing compartilhados com o backend central (backend/topologia.js)
const {
  normalizarTopologia: normalizarTexto,
  decodificarEntidades,
  pareceLogin,
  compactarCodigo,
  extrairNodesTopologia,
  ehNodeHfcConsultaNode,
  motivoGponPendente,
  erroGlobalVisium,
  extrairFormulario,
  encontrarNomeCampo,
  extrairOpcoesSelect,
  escolherOpcao,
  extrairActionFormulario,
  lerTabelaVisium,
  validarTopologias: validarTopologiasCompartilhado
} = require('./topologia');

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

function normalizarTipoVisium(tipo) {
  return tipo === 'gpon' ? 'gpon' : 'hfc';
}

function perfilBrowserVisium(tipo) {
  return normalizarTipoVisium(tipo) === 'gpon' ? VISIUM_BROWSER_PROFILE_GPON : VISIUM_BROWSER_PROFILE_HFC;
}

async function obterBrowserContext(tipo = 'hfc') {
  const chave = normalizarTipoVisium(tipo);
  if (!VISIUM_BROWSER_ENABLED) throw new Error('modo navegador do helper esta desativado');
  if (browserContextPromises[chave]) {
    try {
      const context = await browserContextPromises[chave];
      context.pages();
      return context;
    } catch (_) {
      browserContextPromises[chave] = null;
    }
  }

  browserContextPromises[chave] = (async () => {
    let chromium;
    try {
      ({ chromium } = require('playwright-core'));
    } catch (error) {
      throw new Error('playwright-core nao instalado. Rode o instalador do helper novamente.');
    }

    const canais = [
      process.env.VISIUM_BROWSER_CHANNEL,
      'msedge',
      'chrome'
    ].filter(Boolean);
    let ultimoErro = null;
    for (const channel of canais) {
      try {
        const context = await chromium.launchPersistentContext(perfilBrowserVisium(chave), {
          channel,
          headless: false,
          viewport: { width: 1200, height: 800 },
          ignoreHTTPSErrors: true,
          args: ['--window-size=1200,800']
        });
        context.on('close', () => {
          browserContextPromises[chave] = null;
        });
        return context;
      } catch (error) {
        ultimoErro = error;
      }
    }
    throw new Error(`nao foi possivel abrir Edge/Chrome via Playwright: ${ultimoErro?.message || 'erro desconhecido'}`);
  })();

  return browserContextPromises[chave];
}

async function obterPaginaVisium() {
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    const context = await obterBrowserContext('hfc');
    try {
      const paginas = context.pages().filter((pagina) => !pagina.isClosed());
      const page = paginas.find((pagina) => {
        const url = String(pagina.url() || '').toLowerCase();
        return url.includes('consultainterfacenode') || (url.includes('201.55.234.76') && !url.includes(':8080'));
      }) || paginas[0] || await context.newPage();
      page.setDefaultTimeout(VISIUM_TIMEOUT_MS);
      return page;
    } catch (error) {
      browserContextPromises.hfc = null;
      if (tentativa === 1) throw error;
    }
  }
  throw new Error('nao foi possivel abrir pagina do navegador local');
}

function paginaEmBranco(pagina) {
  const url = String(pagina?.url?.() || '').toLowerCase();
  return !url || url === 'about:blank';
}

async function obterOuCriarPagina(context, predicado, paginasReservadas = new Set()) {
  const paginas = context.pages().filter((pagina) => !pagina.isClosed() && !paginasReservadas.has(pagina));
  return paginas.find(predicado) ||
    paginas.find((pagina) => paginaEmBranco(pagina)) ||
    await context.newPage();
}

async function resumoPagina(page) {
  return {
    url: page.url(),
    title: await page.title().catch(() => '')
  };
}

async function detalhesPagina(page) {
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    links: await page.evaluate(() => Array.from(document.querySelectorAll('a'))
      .slice(0, 30)
      .map((a) => ({ text: (a.textContent || '').trim(), href: a.href || '' }))
      .filter((a) => a.text || a.href)).catch(() => []),
    forms: await page.evaluate(() => Array.from(document.querySelectorAll('form'))
      .slice(0, 10)
      .map((form) => ({
        action: form.action || '',
        inputs: Array.from(form.querySelectorAll('input, select, button'))
          .slice(0, 30)
          .map((el) => ({
            tag: el.tagName,
            type: el.getAttribute('type') || '',
            id: el.id || '',
            name: el.getAttribute('name') || '',
            text: (el.textContent || el.getAttribute('value') || '').trim()
          }))
      }))).catch(() => [])
  };
}

async function prepararAbasVisium() {
  const hfcContext = await obterBrowserContext('hfc');
  const gponContext = await obterBrowserContext('gpon');
  const hfcReservadas = new Set();
  const gponReservadas = new Set();

  const hfcPage = await obterOuCriarPagina(hfcContext, (pagina) => {
    const url = String(pagina.url() || '').toLowerCase();
    return url.includes('consultainterfacenode') || (url.includes('201.55.234.76') && !url.includes(':8080'));
  }, hfcReservadas);
  hfcReservadas.add(hfcPage);
  hfcPage.setDefaultTimeout(VISIUM_TIMEOUT_MS);
  await hfcPage.goto(VISIUM_BASE_URL, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS }).catch(() => {});

  const gponPage = await obterOuCriarPagina(gponContext, (pagina) => {
    return String(pagina.url() || '').toLowerCase().includes(':8080');
  }, gponReservadas);
  gponReservadas.add(gponPage);
  gponPage.setDefaultTimeout(VISIUM_TIMEOUT_MS);
  const destinoGpon = VISIUM_GPON_CONSULTA_URL || VISIUM_GPON_LOGIN_URL;
  const urlGponAtual = String(gponPage.url() || '').toLowerCase();
  if (!urlGponAtual.includes(':8080') || (VISIUM_GPON_CONSULTA_URL && gponPage.url() !== VISIUM_GPON_CONSULTA_URL)) {
    await gponPage.goto(destinoGpon, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS }).catch(() => {});
  }

  for (const pagina of hfcContext.pages()) {
    if (!pagina.isClosed() && !hfcReservadas.has(pagina) && paginaEmBranco(pagina)) {
      await pagina.close().catch(() => {});
    }
  }

  for (const pagina of gponContext.pages()) {
    if (!pagina.isClosed() && !gponReservadas.has(pagina) && paginaEmBranco(pagina)) {
      await pagina.close().catch(() => {});
    }
  }

  return {
    hfc: await resumoPagina(hfcPage),
    gpon: await resumoPagina(gponPage)
  };
}

async function garantirLoginHfcVisium(hfcPage) {
  const urlHfc = String(hfcPage.url() || '').toLowerCase();
  if (!urlHfc.includes('201.55.234.76') || urlHfc.includes(':8080')) {
    await hfcPage.goto(VISIUM_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS }).catch(() => {});
  }
}

async function abrirAbaGponParaLogin() {
  const context = await obterBrowserContext('gpon');
  const page = await obterOuCriarPagina(context, (pagina) => String(pagina.url() || '').toLowerCase().includes(':8080'));
  page.setDefaultTimeout(VISIUM_TIMEOUT_MS);
  await page.goto(VISIUM_GPON_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS }).catch(() => {});
  return await resumoPagina(page);
}

async function aguardarVisiumLogado(page) {
  const temCidade = async () => await page.locator("select[id*='ddlCidade'], select[name*='ddlCidade']").count().catch(() => 0);
  if (await temCidade()) {
    await garantirLoginHfcVisium(page);
    return;
  }

  console.log(`[Visium Helper] Abrindo login HFC: ${VISIUM_LOGIN_URL}`);
  console.log(`[Visium Helper] Login GPON informado: ${VISIUM_GPON_LOGIN_URL}`);
  console.log('[Visium Helper] HFC e GPON usam perfis separados para isolar cookies, igual ao comportamento esperado da extensao.');
  await garantirLoginHfcVisium(page);

  const limite = Date.now() + VISIUM_LOGIN_WAIT_MS;
  while (Date.now() < limite) {
    if (await temCidade()) {
      await garantirLoginHfcVisium(page);
      return;
    }

    const html = await page.content().catch(() => '');
    const urlAtual = String(page.url() || '').toLowerCase();
    if (!pareceLogin(html) && !urlAtual.includes('/login')) {
      await page.goto(VISIUM_BASE_URL, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS }).catch(() => {});
      if (await temCidade()) {
        await garantirLoginHfcVisium(page);
        return;
      }
    }

    await page.waitForTimeout(2000);
  }

  throw new Error('login no Vision HFC nao concluido dentro do tempo limite');
}

async function escolherSelectBrowser(page, fragmento, alvo) {
  const resultado = await page.evaluate(({ fragmento, alvo }) => {
    const compactar = (v) => String(v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const normalizar = (v) => String(v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
    const frag = String(fragmento || '').toLowerCase();
    const select = Array.from(document.querySelectorAll('select')).find((sel) => {
      return String(sel.id || '').toLowerCase().includes(frag) ||
        String(sel.name || '').toLowerCase().includes(frag);
    });
    if (!select) return { ok: false, erro: `select ${fragmento} nao encontrado` };

    const alvoNorm = normalizar(alvo);
    const alvoCompacto = compactar(alvo);
    const opcoes = Array.from(select.options).filter((opcao) => {
      const texto = normalizar(opcao.textContent || opcao.value);
      return texto && !texto.includes('SELECIONE') && !texto.includes('ESCOLHA');
    });
    const opt = opcoes.find((opcao) => normalizar(opcao.textContent) === alvoNorm) ||
      opcoes.find((opcao) => compactar(opcao.textContent) === alvoCompacto) ||
      opcoes.find((opcao) => {
        const texto = normalizar(opcao.textContent);
        return texto.includes(alvoNorm) || alvoNorm.includes(texto);
      }) ||
      opcoes.find((opcao) => {
        const texto = compactar(opcao.textContent);
        return texto.includes(alvoCompacto) || alvoCompacto.includes(texto);
      });
    if (!opt) return { ok: false, erro: `${fragmento} nao encontrado: ${alvo}` };

    select.value = opt.value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      if (typeof select.onchange === 'function') select.onchange();
    } catch (_) {}

    return { ok: true, value: opt.value, text: (opt.textContent || opt.value).trim() };
  }, { fragmento, alvo });

  if (!resultado.ok) throw new Error(resultado.erro);
  return resultado;
}

async function aguardarOpcoesNode(page) {
  await page.waitForFunction(() => {
    const sel = Array.from(document.querySelectorAll('select')).find((item) => {
      return String(item.id || '').toLowerCase().includes('ddlnode') ||
        String(item.name || '').toLowerCase().includes('ddlnode');
    });
    return !!sel && Array.from(sel.options).some((opcao) => {
      const texto = String(opcao.textContent || opcao.value || '').trim().toUpperCase();
      return texto && !texto.includes('SELECIONE') && !texto.includes('ESCOLHA');
    });
  }, null, { timeout: VISIUM_TIMEOUT_MS });
}

async function aguardarOpcaoNodeAlvo(page, node) {
  const inicio = Date.now();
  let ultimo = null;
  let assinaturaAnterior = '';
  let estavelDesde = 0;

  while (Date.now() - inicio < VISIUM_NODE_OPTION_WAIT_MS) {
    ultimo = await page.evaluate((alvo) => {
      const compactar = (v) => String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const normalizar = (v) => String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();
      const select = Array.from(document.querySelectorAll('select')).find((sel) => {
        return String(sel.id || '').toLowerCase().includes('ddlnode') ||
          String(sel.name || '').toLowerCase().includes('ddlnode');
      });
      if (!select) return { temSelect: false, count: 0, encontrado: false, amostra: [] };

      const alvoNorm = normalizar(alvo);
      const alvoCompacto = compactar(alvo);
      const opcoes = Array.from(select.options)
        .map((opcao) => ({
          text: normalizar(opcao.textContent || opcao.value),
          compact: compactar(opcao.textContent || opcao.value)
        }))
        .filter((opcao) => opcao.text && !opcao.text.includes('SELECIONE') && !opcao.text.includes('ESCOLHA'));
      const encontrado = opcoes.some((opcao) => {
        return opcao.text === alvoNorm ||
          opcao.compact === alvoCompacto ||
          opcao.text.includes(alvoNorm) ||
          alvoNorm.includes(opcao.text) ||
          opcao.compact.includes(alvoCompacto) ||
          alvoCompacto.includes(opcao.compact);
      });
      return {
        temSelect: true,
        count: opcoes.length,
        encontrado,
        assinatura: opcoes.map((opcao) => opcao.compact).join('|'),
        amostra: opcoes.slice(0, 5).map((opcao) => opcao.text)
      };
    }, node).catch(() => null);

    if (ultimo?.encontrado) return ultimo;
    if (ultimo?.count > 0) {
      if (ultimo.assinatura === assinaturaAnterior) {
        estavelDesde = estavelDesde || Date.now();
        if (Date.now() - estavelDesde >= VISIUM_NODE_STABLE_MS) break;
      } else {
        assinaturaAnterior = ultimo.assinatura;
        estavelDesde = Date.now();
      }
    }
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1000);
  }

  const qtd = ultimo?.count || 0;
  const amostra = ultimo?.amostra?.length ? `; primeiras opcoes: ${ultimo.amostra.join(', ')}` : '';
  throw new Error(`ddlNode nao encontrou ${node} apos aguardar lista carregar (${qtd} opcoes${amostra})`);
}

async function consultarVisiumNodeBrowserUmaVez(cidade, node) {
  const page = await obterPaginaVisium();
  await page.goto(VISIUM_BASE_URL, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS });
  await aguardarVisiumLogado(page);
  if (!(await page.locator("select[id*='ddlCidade'], select[name*='ddlCidade']").count().catch(() => 0))) {
    await page.goto(VISIUM_BASE_URL, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS });
    await aguardarVisiumLogado(page);
  }

  const cidadeOpt = await escolherSelectBrowser(page, 'ddlCidade', cidade);
  await page.waitForLoadState('networkidle', { timeout: VISIUM_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(VISIUM_AFTER_CITY_WAIT_MS);
  await aguardarOpcoesNode(page);

  let nodeOpt;
  try {
    await aguardarOpcaoNodeAlvo(page, node);
    nodeOpt = await escolherSelectBrowser(page, 'ddlNode', node);
  } catch (error) {
    if (/ddlNode nao encontr/i.test(error.message || '')) {
      throw new Error(`node nao encontrado no HFC/ConsultaInterfaceNode: ${node}. Se for GPON, o motor GPON ainda nao esta implementado.`);
    }
    throw error;
  }
  await page.evaluate(() => {
    const chk = document.querySelector("input[id*='ckbPontual'], input[name*='ckbPontual']");
    if (chk && chk.checked) {
      chk.checked = false;
      chk.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  const consultou = await page.evaluate(() => {
    const btn = document.querySelector("input[id*='btn_consultar'], button[id*='btn_consultar'], input[name*='btn_consultar'], button[name*='btn_consultar']") ||
      Array.from(document.querySelectorAll('input[type=submit], button')).find((item) => /consultar/i.test(item.value || item.textContent || ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!consultou) throw new Error('botao Consultar do Visium nao encontrado');

  const inicio = Date.now();
  let tabela = { found: false, subnodes: [], rows: 0 };
  while (Date.now() - inicio < VISIUM_TIMEOUT_MS) {
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(VISIUM_AFTER_QUERY_WAIT_MS);
    tabela = lerTabelaVisium(await page.content());
    if (tabela.found) break;
  }
  if (!tabela.found) throw new Error('tabela de resultado do Visium vazia ou nao encontrada');

  const allUp = tabela.subnodes.every((subnode) => subnode.up);
  return {
    cidade: cidadeOpt.text || cidade,
    node: nodeOpt.text || node,
    status: allUp ? 'up' : 'down',
    up: allUp,
    subnodes: tabela.subnodes,
    rows: tabela.rows,
    sourceUrl: VISIUM_BASE_URL,
    modo: 'browser'
  };
}

async function consultarVisiumNodeBrowser(cidade, node) {
  let ultimoErro = null;
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    try {
      return await consultarVisiumNodeBrowserUmaVez(cidade, node);
    } catch (error) {
      ultimoErro = error;
      const mensagem = error.message || '';
      if (!/Target page|context or browser has been closed|browser has been closed|crashed/i.test(mensagem)) {
        throw error;
      }
      browserContextPromises.hfc = null;
    }
  }
  throw ultimoErro;
}

async function consultarVisiumNode(cidade, node) {
  const cliente = criarClienteVisium();
  const inicial = await cliente.requisitar(VISIUM_BASE_URL);
  if (!inicial.response.ok) throw new Error(`Visium HTTP ${inicial.response.status}`);
  if (pareceLogin(inicial.text)) return await consultarVisiumNodeBrowser(cidade, node);

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
  if (!campoNode || !nodeOpt) {
    throw new Error(`node nao encontrado no HFC/ConsultaInterfaceNode: ${node}. Se for GPON, o motor GPON ainda nao esta implementado.`);
  }

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

async function obterPaginaGpon() {
  const context = await obterBrowserContext('gpon');
  const page = await obterOuCriarPagina(context, (pagina) => {
    return String(pagina.url() || '').toLowerCase().includes(':8080');
  });
  page.setDefaultTimeout(VISIUM_TIMEOUT_MS);
  await page.goto(VISIUM_GPON_CONSULTA_URL, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS }).catch(() => {});
  return page;
}

async function aguardarGponLogado(page) {
  const temCidade = async () => await page.locator("#selectCidade, select[id*='cidade' i]").count().catch(() => 0);
  if (await temCidade()) return;

  const limite = Date.now() + VISIUM_LOGIN_WAIT_MS;
  while (Date.now() < limite) {
    if (await temCidade()) return;
    const html = await page.content().catch(() => '');
    const urlAtual = String(page.url() || '').toLowerCase();
    if (!pareceLogin(html) && !urlAtual.includes('/login') && !urlAtual.includes('consultaontlista')) {
      await page.goto(VISIUM_GPON_CONSULTA_URL, { waitUntil: 'domcontentloaded', timeout: VISIUM_TIMEOUT_MS }).catch(() => {});
      if (await temCidade()) return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error('login no Vision GPON nao concluido dentro do tempo limite');
}

async function prepararConsultaGpon(page, cidade, naps) {
  const cidadeOpt = await escolherSelectBrowser(page, 'cidade', cidade);
  await page.waitForLoadState('networkidle', { timeout: VISIUM_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(1500);

  const preparado = await page.evaluate((textoNaps) => {
    const pick = (sels) => {
      for (const sel of sels) {
        try {
          const el = document.querySelector(sel);
          if (el) return el;
        } catch (_) {}
      }
      return null;
    };
    const setNativeValue = (el, value) => {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
        el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const radioNap = pick(["#ContentWithMenuLeft_MainContent_rdbContrato", "input[value='rdbContrato']"]);
    if (!radioNap) return { ok: false, erro: 'radio de consulta por NAP nao encontrado' };
    radioNap.checked = true;
    radioNap.dispatchEvent(new Event('click', { bubbles: true }));
    radioNap.dispatchEvent(new Event('change', { bubbles: true }));

    const textarea = pick(["#ContentWithMenuLeft_MainContent_txt_lista_mac", "textarea[name$='txt_lista_mac']", "textarea.form-control"]);
    if (!textarea) return { ok: false, erro: 'textarea de NAPs nao encontrada' };
    setNativeValue(textarea, textoNaps || '');

    const btn = pick(["#ContentWithMenuLeft_MainContent_btn_Consultar", "input[name$='btn_Consultar']", "input[type='submit'][value*='Consultar' i]"]);
    if (!btn) return { ok: false, erro: 'botao Consultar GPON nao encontrado' };
    btn.click();
    return { ok: true };
  }, (naps || []).join('\n'));

  if (!preparado.ok) throw new Error(preparado.erro || 'falha ao preparar consulta GPON');
  return cidadeOpt;
}

async function aguardarResultadoGpon(page, quantidadeNaps) {
  const esperado = VISIUM_GPON_QUERY_BASE_MS + VISIUM_GPON_QUERY_PER_NAP_MS * Math.max(1, quantidadeNaps || 1);
  const maxWait = esperado + VISIUM_GPON_QUERY_MARGIN_MS;
  const inicio = Date.now();
  let estado = 'timeout';

  while (Date.now() - inicio < maxWait) {
    estado = await page.evaluate(() => {
      const visivel = (el) => !!(el && el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0);
      const proc = document.querySelector("#tableModemAssinante_processing, .dataTables_processing");
      if (visivel(proc)) return 'loading';
      const table = document.querySelector("#tableModemAssinante, table[id*='ModemAssinante'], table.display");
      if (!table) return 'waiting';
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const dataRows = rows.filter((tr) => tr.querySelectorAll('td').length > 1 && !tr.querySelector('.dataTables_empty'));
      if (dataRows.length) return 'data';
      const txt = (table.textContent || '').toLowerCase();
      if (/no data available|nenhum registro|sem registros/.test(txt)) return 'empty';
      return 'waiting';
    }).catch(() => 'waiting');

    if (estado === 'data') break;
    if (estado === 'empty' && Date.now() - inicio > Math.min(esperado, 40000)) break;
    await page.waitForTimeout(700);
  }

  await page.evaluate(() => {
    try {
      if (window.jQuery && jQuery.fn && jQuery.fn.dataTable && jQuery.fn.dataTable.isDataTable('#tableModemAssinante')) {
        jQuery('#tableModemAssinante').DataTable().page.len(-1).draw(false);
      }
    } catch (_) {}
  }).catch(() => {});
  await page.waitForTimeout(900);

  return { estado, waitMs: Date.now() - inicio, esperado };
}

async function lerResultadoGpon(page) {
  return await page.evaluate(() => {
    const norm = (s) => String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const pick = (sels) => {
      for (const sel of sels) {
        try {
          const el = document.querySelector(sel);
          if (el) return el;
        } catch (_) {}
      }
      return null;
    };
    const localizar = (headers, nomes) => {
      const alvos = nomes.map(norm);
      return headers.findIndex((h) => alvos.some((a) => norm(h) === a || norm(h).includes(a)));
    };
    const online = (status) => {
      const s = norm(status);
      if (['offline', 'down'].some((v) => s === v || s.includes(v))) return false;
      if (['online', 'up', 'working'].some((v) => s === v || s.includes(v))) return true;
      return null;
    };

    const table = pick(["#tableModemAssinante", "table[id*='ModemAssinante']", "table.display"]);
    if (!table) return { found: false, naps: [], rows: 0 };
    const headRow = table.querySelector('thead tr') || table.querySelector('tr');
    const headers = headRow ? Array.from(headRow.querySelectorAll('th,td')).map((c) => c.textContent || '') : [];
    const napIdx = localizar(headers, ['NAP']);
    const statusIdx = localizar(headers, ['STATUS']);
    if (napIdx < 0 || statusIdx < 0) return { found: false, naps: [], rows: 0, erro: 'colunas NAP/STATUS nao encontradas' };

    const groups = {};
    let rows = 0;
    for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (cells.length <= Math.max(napIdx, statusIdx)) continue;
      const nap = (cells[napIdx].textContent || '').trim();
      if (!nap) continue;
      const state = online(cells[statusIdx].textContent || '');
      rows += 1;
      const g = groups[nap] = groups[nap] || { nap, total: 0, online: 0, offline: 0, unknown: 0 };
      g.total += 1;
      if (state === true) g.online += 1;
      else if (state === false) g.offline += 1;
      else g.unknown += 1;
    }

    const naps = Object.keys(groups).sort().map((nap) => {
      const g = groups[nap];
      const ratio = g.total ? g.online / g.total : 0;
      return { ...g, ratio, up: g.total > 0 && ratio >= 0.5 };
    });
    return { found: naps.length > 0, naps, rows };
  });
}

async function consultarGponNaps(cidade, naps) {
  const lista = Array.from(new Set((naps || []).map((nap) => String(nap || '').trim()).filter(Boolean)));
  if (!lista.length) return { cidade, naps: [], rows: 0, sourceUrl: VISIUM_GPON_CONSULTA_URL, modo: 'browser-gpon' };

  const page = await obterPaginaGpon();
  await aguardarGponLogado(page);
  const cidadeOpt = await prepararConsultaGpon(page, cidade, lista);
  const espera = await aguardarResultadoGpon(page, lista.length);
  const resultado = await lerResultadoGpon(page);
  if (!resultado.found) {
    throw new Error(resultado.erro || `consulta GPON sem dados (${espera.estado}, ${Math.round(espera.waitMs / 1000)}s)`);
  }

  return {
    cidade: cidadeOpt.text || cidade,
    naps: resultado.naps,
    rows: resultado.rows,
    sourceUrl: VISIUM_GPON_CONSULTA_URL,
    modo: 'browser-gpon',
    waitMs: espera.waitMs,
    settled: espera.estado
  };
}

async function validarTopologias(itens) {
  // Ciclo compartilhado com o backend central: mesmo filtro GPON e mesma
  // regra de status (qualquer node DOWN => down).
  let abas = null;
  let abasErro = null;
  try {
    abas = await prepararAbasVisium();
  } catch (error) {
    abasErro = error.message || 'erro ao preparar abas Visium';
  }

  return await validarTopologiasCompartilhado(itens, {
    consultarNode: consultarVisiumNode,
    consultarGpon: consultarGponNaps,
    site: 'Visium Local',
    sitesConsultados: ['Visium Live via helper local'],
    onGponPendente: async () => {
      if (!abas && !abasErro) {
        try {
          abas = await prepararAbasVisium();
        } catch (error) {
          abasErro = error.message || 'erro ao preparar abas Visium';
        }
      }
      if (abas?.gpon) {
        return {
          mensagem: `Aba GPON aberta: ${abas.gpon.url || VISIUM_GPON_LOGIN_URL}.`,
          consulta: { gponAba: abas.gpon, hfcAba: abas.hfc }
        };
      }
      return {
        mensagem: `Falha ao preparar abas Visium: ${abasErro || 'erro desconhecido'}.`
      };
    }
  });
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
    visiumLoginUrl: VISIUM_LOGIN_URL,
    visiumGponLoginUrl: VISIUM_GPON_LOGIN_URL,
    visiumGponConsultaUrl: VISIUM_GPON_CONSULTA_URL || null,
    browserProfiles: {
      hfc: VISIUM_BROWSER_PROFILE_HFC,
      gpon: VISIUM_BROWSER_PROFILE_GPON
    },
    timeoutMs: VISIUM_TIMEOUT_MS,
    nodeOptionWaitMs: VISIUM_NODE_OPTION_WAIT_MS,
    nodeStableMs: VISIUM_NODE_STABLE_MS,
    afterCityWaitMs: VISIUM_AFTER_CITY_WAIT_MS,
    afterQueryWaitMs: VISIUM_AFTER_QUERY_WAIT_MS,
    timestamp: new Date().toISOString()
  });
});

app.get('/debug/visium-pages', async (req, res) => {
  try {
    const abas = await prepararAbasVisium();
    const hfcContext = await obterBrowserContext('hfc');
    const gponContext = await obterBrowserContext('gpon');
    const hfcPage = hfcContext.pages().find((pagina) => !pagina.isClosed() && pagina.url() === abas.hfc.url);
    const gponPage = gponContext.pages().find((pagina) => !pagina.isClosed() && pagina.url() === abas.gpon.url);
    res.json({
      sucesso: true,
      version: HELPER_VERSION,
      browserProfiles: {
        hfc: VISIUM_BROWSER_PROFILE_HFC,
        gpon: VISIUM_BROWSER_PROFILE_GPON
      },
      hfc: hfcPage ? await detalhesPagina(hfcPage) : abas.hfc,
      gpon: gponPage ? await detalhesPagina(gponPage) : abas.gpon
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/topologia-validacao/validar', async (req, res) => {
  try {
    if (req.body?.origem !== ORIGEM_FRONTEND) {
      return res.status(400).json({ sucesso: false, erro: 'Origem invalida para helper local.' });
    }
    const validacao = await validarTopologias(req.body?.itens || []);
    const central = await registrarNoBackendCentral(req.body?.backendUrl, validacao);
    res.json({ ...central, falhaGlobalVisium: validacao.falhaGlobalVisium || null, origem: 'helper-local-vpn' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`[Visium Helper] Versao: ${HELPER_VERSION}`);
  console.log(`[Visium Helper] Online em http://${HOST}:${PORT}`);
  console.log(`[Visium Helper] HFC: ${VISIUM_BASE_URL}`);
  console.log(`[Visium Helper] GPON login: ${VISIUM_GPON_LOGIN_URL}`);
  console.log(`[Visium Helper] Perfil HFC: ${VISIUM_BROWSER_PROFILE_HFC}`);
  console.log(`[Visium Helper] Perfil GPON: ${VISIUM_BROWSER_PROFILE_GPON}`);
  console.log(`[Visium Helper] Backend central: ${BACKEND_URL_DEFAULT}`);
  console.log('[Visium Helper] TLS do backend central: modo compativel com certificado corporativo');
});
