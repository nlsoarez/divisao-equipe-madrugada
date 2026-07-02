// Service worker da ponte de topologia.
// Recebe do content script uma lista de topologias (nodes/NAPs) dos incidentes
// ativos do portal e verifica se cada uma ainda consta como afetada nos
// monitores internos, usando a sessao autenticada + VPN do navegador.
//
// Estrategia por site (mesma da extensao Claro Outage Monitor):
//   1. fetch com credentials:"include" (rapido, sem abrir aba);
//   2. se o HTML vier vazio/sem dados (pagina renderizada por JS), le o texto
//      das abas ja abertas do site via chrome.scripting (todos os frames).
// Nao cria abas novas: se o site nao estiver acessivel, devolve status "erro".

const SITES = [
  { id: "newmonitor", label: "NewMonitor", url: "https://newmonitor.claro.com.br/user/" },
  { id: "outage", label: "Outage SGO", url: "https://outage.claro.com.br/inc/list" }
];

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "validar-topologias") return false;
  validarTopologias(msg.itens || [])
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, erro: e.message, resultados: [] }));
  return true; // resposta assincrona
});

async function validarTopologias(itens) {
  const testadoEm = Date.now();
  const validos = itens.filter((i) => i && normalizar(i.topologia));
  if (validos.length === 0) {
    return { ok: true, resultados: [], testadoEm };
  }

  // Coleta o texto de cada monitor uma unica vez por ciclo.
  const textos = [];
  const errosSites = [];
  for (const site of SITES) {
    const r = await obterTextoDoSite(site);
    if (r.ok) textos.push({ site: site.label, texto: normalizar(r.texto) });
    else errosSites.push(`${site.label}: ${r.erro}`);
  }

  if (textos.length === 0) {
    return {
      ok: false,
      erro: `Nenhum monitor acessivel (VPN/login?). ${errosSites.join(" | ")}`,
      resultados: [],
      testadoEm
    };
  }

  const resultados = validos.map((item) => {
    const alvo = normalizar(item.topologia);
    const achado = textos.find((t) => contemTopologia(t.texto, alvo));
    return {
      id: item.id || null,
      topologia: item.topologia,
      status: achado ? "confirmado" : "nao_encontrado",
      site: achado ? achado.site : null,
      sitesConsultados: textos.map((t) => t.site),
      testadoEm
    };
  });

  return { ok: true, resultados, avisos: errosSites, testadoEm };
}

async function obterTextoDoSite(site) {
  // 1) fetch direto com a sessao do navegador
  try {
    const resp = await fetch(site.url, { credentials: "include", cache: "no-store" });
    if (resp.ok) {
      const html = await resp.text();
      const texto = htmlParaTexto(html);
      if (texto.length > 200 && !pareceLogin(texto)) {
        return { ok: true, texto };
      }
      if (pareceLogin(texto)) return { ok: false, erro: "sessao expirada" };
    }
  } catch (_) {
    // sem VPN ou rede indisponivel — tenta abas abertas abaixo
  }

  // 2) fallback: texto das abas ja abertas do site (todos os frames)
  try {
    const base = site.url.replace(/\/(user|inc\/list)\/?$/, "");
    const abas = await chrome.tabs.query({ url: base + "/*" });
    for (const aba of abas) {
      try {
        const frames = await chrome.scripting.executeScript({
          target: { tabId: aba.id, allFrames: true },
          func: () => document.body?.innerText || ""
        });
        const texto = frames.map((f) => f.result || "").join("\n");
        if (texto.length > 200 && !pareceLogin(texto)) return { ok: true, texto };
      } catch (_) { /* aba protegida ou descarregada */ }
    }
    return { ok: false, erro: abas.length ? "abas sem conteudo legivel" : "site inacessivel e sem aba aberta" };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

function contemTopologia(textoNormalizado, alvoNormalizado) {
  if (!alvoNormalizado) return false;
  if (textoNormalizado.includes(alvoNormalizado)) return true;
  // fallback: todos os tokens relevantes (>=3 chars alfanumericos) presentes
  const tokens = alvoNormalizado.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.every((t) => textoNormalizado.includes(t));
}

function htmlParaTexto(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pareceLogin(texto) {
  const t = normalizar(texto);
  return t.includes("senha") && (t.includes("login") || t.includes("usuario"));
}

function normalizar(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
