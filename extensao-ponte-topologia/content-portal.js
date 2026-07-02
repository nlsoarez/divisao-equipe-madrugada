// Ponte entre a pagina do portal e o service worker da extensao.
// A pagina nao consegue chamar os monitores internos por CORS; este script
// repassa as solicitacoes para o background, que tem host_permissions.
(function () {
  const FONTE_PORTAL = "coprede-portal";
  const FONTE_PONTE = "coprede-ponte";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== FONTE_PORTAL) return;

    if (msg.type === "ping") {
      window.postMessage({ source: FONTE_PONTE, type: "pong", versao: chrome.runtime.getManifest().version }, "*");
      return;
    }

    if (msg.type === "validar-topologias") {
      chrome.runtime.sendMessage(
        { type: "validar-topologias", itens: msg.itens || [] },
        (resposta) => {
          const erro = chrome.runtime.lastError?.message;
          window.postMessage({
            source: FONTE_PONTE,
            type: "resultado-validacao",
            reqId: msg.reqId,
            ok: !erro && !!resposta?.ok,
            erro: erro || resposta?.erro || null,
            resultados: resposta?.resultados || [],
            testadoEm: resposta?.testadoEm || Date.now()
          }, "*");
        }
      );
    }
  });

  // Anuncia a presenca da ponte assim que a pagina carrega.
  window.postMessage({ source: FONTE_PONTE, type: "pong", versao: chrome.runtime.getManifest().version }, "*");
})();
