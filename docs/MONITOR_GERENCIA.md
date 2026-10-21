# Monitoramento da Gerência (preparação, sem ativação)

Escopo: o coordenador decide manualmente quando abrir o monitor do grupo de gestão.
A funcionalidade é **desligada por padrão**. Não há consulta de mensagens antigas.
O código desta funcionalidade vive em branch isolada, aguardando ID do grupo e segredos privados.

## Como funciona

- Uma nova aba **Monitoramento da Gerência** aparece somente no modo `/admin`.
- Somente quem tiver sessão administrativa **e** informar a **senha exclusiva** pode ler as mensagens ou ativar/desativar o monitor. Não existe função de resposta.
- A senha exclusiva é diferente da senha administrativa compartilhada; o desbloqueio dura 15 minutos e fica vinculado à sessão administrativa atual. Ao expirar ou bloquear, as mensagens deixam de ser entregues ao navegador.
- É possível armar antes das 21h, mas somente mensagens novas recebidas de **21:00 até 06:59:59**, horário de Brasília, entram na lista.
- A ativação termina automaticamente às **07:00** da manhã seguinte (ou da manhã corrente se ativado após meia-noite); desativar antes limpa imediatamente as mensagens.
- O máximo é de 80 mensagens em **memória do servidor**. Não há armazenamento em Supabase, localStorage ou histórico. Reinícios do servidor desligam o monitor (*fail closed*).
- Aviso sonoro toca no navegador depois de o supervisor clicar uma vez em **Ativar som neste navegador**; isso é exigido pelas políticas de autoplay dos navegadores. É necessário manter a página aberta e autenticada.
- `GET /api/gerencia/estado` exige a sessão administrativa atual e só inclui mensagens quando a sessão também possui o desbloqueio exclusivo. As rotas de controle aplicam a mesma exigência.
- O backend só aceita mensagens do chat ID permitido e mensagens publicadas depois da ativação, via `messages.upsert`, autenticadas pelo token do webhook. Nunca faz `findMessages` nem lê histórico.

## Configuração pendente

No arquivo **privado** `deploy/oci/.env` em produção (nunca no repositório):

```dotenv
GERENCIA_GROUP_CHAT_ID=5521993571609-1390687807@g.us
GERENCIA_CONTROL_PASSWORD_HASH=
GERENCIA_WEBHOOK_TOKEN=
```

1. ID confirmado: `5521993571609-1390687807@g.us`. Aplicar no `.env` privado da implantação; estar no exemplo do Git não configura o servidor.
2. Gerar um hash **bcrypt** (custo 12 recomendado) de uma senha **nova, conhecida somente pelo coordenador**. Salvar em `GERENCIA_CONTROL_PASSWORD_HASH` no servidor. O login /admin existente continua inalterado. Nunca enviar a senha por chat nem versionar seu texto ou hash.
3. Gerar um token aleatório com pelo menos 32 caracteres e armazenar em `GERENCIA_WEBHOOK_TOKEN`.
4. A instância em uso respondeu como **Evolution API 2.3.7**. O código oficial dessa versão aceita `webhook.headers` na configuração por instância e os envia nas chamadas. Faça leitura-modificação-gravação da configuração existente: preserve URL, eventos, `byEvents` e `base64`, acrescentando `X-Gerencia-Webhook-Token`. A instância possui um único webhook por instância; portanto, não crie um segundo nem apague o webhook que atende HUB/escala. Webhooks globais do ambiente não aplicam esses headers.
5. Reiniciar/atualizar o backend depois de atualizar as variáveis. Até que **ID + hash + token** estejam configurados, o botão de habilitação permanecerá bloqueado.
6. Fazer ensaio com grupo de teste e usuário autorizado, validando recebimento, som, bloqueio de histórico, 07h, reinício e casos de autenticação.

**Atenção**: o endpoint existente `/api/whatsapp/webhook` continua com comportamento legado para os demais grupos. A autenticação adicional protege somente a ingestão de mensagens do grupo gerencial. Faça auditoria independente do endpoint legado antes de expor mais dados.

## Código

- `backend/gerencia-monitor.js` — filtro, estado temporário e sessão exclusiva.
- `backend/server.js` — rotas novas e interceptação do webhook no grupo configurado.
- `js/gerencia-monitor.js` e `index.html` — aba, alerta sonoro e controle.
- `backend/__tests__/gerencia-monitor.test.js` — testes preparados com Jest (precisam ser executados em ambiente com dependências: `cd backend && npm ci && npm test -- --runInBand`).

**Não publicar em produção antes de testar os segredos, o webhook e a compatibilidade da instância Evolution ativa.**

## Verificação de integração pendente

- Verificação somente de leitura em 21/10/2026: a API pública respondeu como **2.3.7**. O webhook da instância estava habilitado, apontando para `https://divisao.163-176-155-119.sslip.io/api/whatsapp/webhook`, com apenas `MESSAGES_UPSERT`, `byEvents=false`, `base64=false` e **sem headers personalizados**.
- O container de produção ainda não possui `GERENCIA_GROUP_CHAT_ID`, `GERENCIA_CONTROL_PASSWORD_HASH` nem `GERENCIA_WEBHOOK_TOKEN`. Isso é um bloqueio intencional: a função não pode ser habilitada no estado atual.
- Depois de implantar esta branch e instalar os três valores privados, acrescente o header pela configuração por instância. Valide por leitura que URL, evento e demais campos acima foram preservados. Sem o header, o monitor descarta as mensagens do grupo gerencial, mesmo que a instância esteja conectada.
- Não alterar webhooks de HUB/escala para testar; primeiro validar em homologação e conferir se o outro endpoint `/api/webhook/mensagem` pode receber conteúdo do grupo gerencial.
- Senha exclusiva e token devem ser gerados e instalados **somente no servidor**, nunca no Git ou nesta conversa.

Referências verificadas: [release 2.3.7](https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7), [schema de webhook 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.schema.ts) e [envio dos headers 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/event/webhook/webhook.controller.ts).
