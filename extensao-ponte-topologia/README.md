# Portal Coprede — Ponte de Topologia

Extensão mínima (Chrome/Edge, MV3) que permite ao portal validar automaticamente,
de hora em hora, as **topologias (nodes/NAPs) dos incidentes ativos** contra os
monitores internos (`newmonitor.claro.com.br` e `outage.claro.com.br`), usando a
sessão já autenticada + VPN do navegador do analista.

Por que ela é necessária: uma página web comum não consegue chamar os monitores
internos diretamente — o navegador bloqueia por CORS. Extensões com
`host_permissions` conseguem. Esta ponte faz **só** isso: recebe do portal a lista
de topologias e responde se cada uma ainda consta como afetada nos monitores.

Não pede login, não guarda senha, não envia dados para nenhum serviço externo e
não contém chaves/tokens. Toda a lógica de agendamento e exibição fica no portal.

## Instalação (uma vez por máquina)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo de desenvolvedor**.
3. Clique em **"Carregar sem compactação"** e selecione a pasta `extensao-ponte-topologia`.
4. Pronto. Abra o portal logado na VPN — a validação roda sozinha a cada hora.

## Como funciona

1. O portal (página) envia via `window.postMessage` a lista de topologias dos
   incidentes ativos (que vêm do `/api/matriz-ofensores`).
2. O content script repassa ao service worker da extensão.
3. O service worker consulta os monitores internos:
   - primeiro `fetch` com `credentials: "include"`;
   - se a página for renderizada por JS, lê o texto das abas já abertas do site
     (todos os frames). **Não cria abas novas.**
4. Para cada topologia, responde:
   - `confirmado` — a topologia ainda aparece em um dos monitores (outage segue ativo);
   - `nao_encontrado` — não consta mais (possível normalização, conferir);
   - erro geral — VPN desconectada ou sessão expirada.
5. O portal exibe o resultado como badge ao lado de cada incidente e agenda o
   próximo ciclo (1 h).

## Limites conhecidos

- O teste v1 é uma **verificação de presença** nos monitores, não um diagnóstico
  de sinal do node/NAP. Se existir uma API interna de diagnóstico, ela pode
  substituir a sonda em `background.js` (`obterTextoDoSite`/`contemTopologia`)
  sem mudar nada no portal.
- Se os monitores exigirem estado de UI (fila selecionada) que não existe na URL
  base, mantenha uma aba do monitor aberta na fila desejada — a ponte lê abas
  abertas como fallback.
- Funciona apenas com o navegador aberto no portal, na VPN e com sessão válida
  nos monitores.
