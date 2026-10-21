# Monitoramento da Gerência (preparação, sem ativação)

Escopo: o coordenador decide manualmente quando abrir o monitor do grupo de gestão.
A funcionalidade é **desligada por padrão**. Não há consulta de mensagens antigas.
O código desta funcionalidade vive em branch isolada, aguardando ID do grupo e segredos privados.

## Como funciona

- Uma nova aba **Monitoramento da Gerência** aparece somente no modo `/admin`.
- Todos os atuais operadores com sessão administrativa podem **ler** as mensagens *se* a função estiver ativada. Não podem responder.
- Somente quem souber a **senha exclusiva**, diferente da senha administrativa compartilhada, pode ativar ou desativar; o desbloqueio dura 15 minutos e fica vinculado à sessão administrativa atual.
- É possível armar antes das 21h, mas somente mensagens novas recebidas de **21:00 até 06:59:59**, horário de Brasília, entram na lista.
- A ativação termina automaticamente às **07:00** da manhã seguinte (ou da manhã corrente se ativado após meia-noite); desativar antes limpa imediatamente as mensagens.
- O máximo é de 80 mensagens em **memória do servidor**. Não há armazenamento em Supabase, localStorage ou histórico. Reinícios do servidor desligam o monitor (*fail closed*).
- Aviso sonoro toca no navegador depois de o supervisor clicar uma vez em **Ativar som neste navegador**; isso é exigido pelas políticas de autoplay dos navegadores. É necessário manter a página aberta e autenticada.
- `GET /api/gerencia/estado` exige a sessão administrativa atual; as rotas de controle exigem **também** o desbloqueio exclusivo.
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
4. Configurar a **instância Evolution que já entrega os eventos ao portal** para encaminhar o cabeçalho customizado `X-Gerencia-Webhook-Token` com exatamente o mesmo token. A Evolution v2 possui suporte a cabeçalhos personalizados em **webhook por instância**, mas é preciso confirmar a versão e o mecanismo atualmente em uso. **Não sobrescrever o webhook do HUB**. Webhooks globais configurados somente no ambiente podem não suportar cabeçalhos customizados. Verificar antes de mudar qualquer endpoint.
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

- A URL fornecida do Evolution Manager identifica a instância `49f9bd72-66b4-4318-884f-3d59977d46ca`, mas não comprova a versão nem a configuração efetiva do webhook.
- Confirmar que o webhook existente envia `messages.upsert` ao endpoint `/api/whatsapp/webhook` e suporta o header `X-Gerencia-Webhook-Token`. Sem o header, o monitor descarta as mensagens, mesmo que a instância esteja conectada.
- Não alterar webhooks de HUB/escala para testar; primeiro validar em homologação e conferir se o outro endpoint `/api/webhook/mensagem` pode receber conteúdo do grupo gerencial.
- Senha exclusiva e token devem ser gerados e instalados **somente no servidor**, nunca no Git ou nesta conversa.

