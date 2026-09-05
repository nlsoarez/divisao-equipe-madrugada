# Supabase Egress Optimization

## Causa raiz

O backend relia `operational_messages`, `operational_alerts` e parte do histórico de HUB em operações frequentes. Como `operational_messages` já possui milhares de linhas, o polling do frontend podia fazer o backend transferir repetidamente dezenas de megabytes do Supabase.

## Mudanças

- Leituras operacionais usam `operational_page`, com página inicial limitada e suporte a cursor incremental e histórico por cursor.
- O caminho padrão mantém uma página viva em memória. Depois da primeira leitura, novas mensagens/alertas gravados pelo próprio backend atualizam essa página diretamente, evitando nova leitura do Supabase a cada polling do frontend legado.
- Consultas filtradas usam cache curto e single-flight para impedir consultas idênticas concorrentes.
- `operational_messages` e `operational_alerts` não compartilham mais uma leitura integral no caminho normal.
- `obterUltimoTimestamp()` usa `ORDER BY event_at DESC LIMIT 1`.
- HUB usa consultas limitadas para página, alocação atual e estatísticas.
- `upsert` usa `return=minimal` por padrão.
- HTTP 402 abre um circuit breaker de cinco minutos; erros não transitórios não entram em retry.
- Estatísticas e resumos são calculados no PostgreSQL por RPC, sem baixar o histórico para o Node.

## Migration

Aplicar antes do deploy da aplicação:

`supabase/migrations/20260905011834_optimize_operational_egress.sql`

A migration cria:

- `app_private.operational_revision`
- `app_private.operational_changes`
- triggers compactos de revisão/tombstone
- `app_private.operational_feed`
- índices de histórico
- RPCs `operational_page`, `operational_statistics`, `operational_area_summary`, `hub_statistics` e `operational_diagnostic_counts`

As funções operacionais ficam acessíveis apenas à `service_role`; `anon` e `authenticated` não recebem execução.

## Compatibilidade

Os exports antigos de `storage.js` e `storageHub.js` foram preservados. Rotas existentes que chamam `obterCopRedeInforma`, `obterAlertas`, `obterCopRedeEmpresarial` e `obterAlocacoes` continuam recebendo arrays. Os novos métodos de página/cursor ficam disponíveis para evolução posterior do frontend.

## Leituras integrais restantes

`selectAll()` permanece apenas em exportações/rotinas administrativas explícitas (`carregarDados`) e na própria implementação genérica do cliente. Não deve ser usado em polling normal.

## Deploy

1. Fazer backup lógico ou confirmar backup recente.
2. Aplicar a migration em produção.
3. Publicar backend com os arquivos desta alteração.
4. Confirmar `/health` e funções operacionais.
5. Abrir o portal e validar COP REDE INFORMA, alertas, Empresarial e HUB.
6. Acompanhar Organization > Usage > Egress no Supabase nas horas seguintes.

Não publicar o backend antes da migration, porque as leituras normais passam a depender dos novos RPCs.

## O que monitorar

- Egress por projeto e por hora.
- Logs com `[Supabase] ... rows durationMs=...`.
- ocorrência de `SUPABASE_QUOTA_COOLDOWN`/HTTP 402.
- crescimento de `app_private.operational_changes`.
- latência do RPC `operational_page`.

## Expectativa

Antes, uma atualização podia reler milhares de mensagens e centenas de alertas. Depois, a primeira carga traz apenas uma página limitada; enquanto o backend permanece ativo, o polling legado é servido pela página viva em memória e as gravações atualizam essa página sem reler o Supabase. Consultas filtradas e administrativas continuam disponíveis sob demanda.

A redução real deve ser confirmada no Usage após deploy; não se deve tratar uma estimativa como medição de produção.
