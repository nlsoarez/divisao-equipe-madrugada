# Migracao JSONBin para Supabase

O destino e um projeto Supabase dedicado na regiao `sa-east-1`. O navegador nao acessa as tabelas: somente o backend OCI usa a secret key.

## 1. Criar o esquema

Aplique, na ordem, os arquivos de `supabase/migrations`. A migration cria:

- escala normalizada em calendario, dias e trocas;
- uma linha por mensagem COP;
- uma linha por alerta;
- uma linha por alocacao do HUB;
- RLS habilitado sem politicas para `anon` e `authenticated`;
- grants somente para `service_role`;
- funcoes atomicas para gravar e reconstruir a escala.

Depois da aplicacao, execute os advisors de seguranca e desempenho.

## 2. Configurar o backend

No `deploy/oci/.env`:

```dotenv
SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_SUBSTITUA
SUPABASE_SCHEMA=public
```

Nao use chave anon/publishable para as operacoes do backend e nunca coloque a secret key em `index.html`, `js/config.js` ou GitHub Actions sem secret protegido.

## 3. Exportar e importar

O importador faz somente `GET` no JSONBin, salva um snapshot local ignorado pelo Git, executa upserts e valida todos os IDs no destino.

Primeiro rode sem escrever no Supabase:

```powershell
Set-Location backend
$env:JSONBIN_MASTER_KEY='CHAVE_ANTIGA'
$env:JSONBIN_ACCESS_KEY='ACCESS_ANTIGA'
$env:SCALE_BIN_ID='ID_ESCALA'
$env:WHATSAPP_BIN_ID='ID_MENSAGENS'
$env:ALOCACAO_HUB_BIN_ID='ID_HUB_SE_EXISTIR'
npm run migrate:jsonbin -- --dry-run
```

Se o JSONBin responder `403/429 Requests exhausted`, nao tente contornar a cota criando novos bins. Aguarde a renovacao ou regularize a conta e repita o dry-run.

## Recuperacao de uma escala salva apenas no navegador

Quando a publicacao remota falha, o frontend grava a escala em `escala_backup` e marca
`escala_pendente_publicacao=true`. O aviso "Dados salvos APENAS localmente" so e exibido
depois que essa copia local e concluida.

Antes de trocar o dominio GitHub Pages pelo dominio OCI:

1. use o mesmo navegador, perfil e endereco em que a planilha foi enviada;
2. nao limpe os dados do site;
3. entre como administrador e use o botao de download para guardar o backup JSON;
4. depois que o backend OCI/Supabase estiver ativo, use o botao de republicacao;
5. confirme em outro navegador que a escala foi carregada do Supabase.

O armazenamento local pertence ao dominio. O backup do GitHub Pages nao aparece
automaticamente no dominio OCI. Se a virada de DNS ocorrer antes da republicacao,
importe novamente a planilha original ou preserve o arquivo JSON baixado.

Depois configure `SUPABASE_URL` e `SUPABASE_SECRET_KEY` no terminal e execute:

```powershell
npm run migrate:jsonbin
```

O script falha se a contagem de dias divergir ou se qualquer mensagem, alerta ou alocacao de origem nao existir no destino.

## 4. Cutover

1. Pare escritas no painel antigo.
2. Rode a importacao final.
3. Confira o registro em `data_migration_runs`.
4. Suba o backend OCI com as variaveis Supabase.
5. Teste `GET /health`, `GET /api/escala` e um `PUT /api/escala` nao critico.
6. Mantenha os bins sem escrita por sete dias.
7. Revogue as chaves JSONBin expostas no historico.

## 5. Rollback

Durante os sete dias, preserve o snapshot em `backend/data-migration` fora do Git e nao apague os bins. Para rollback, restaure a versao anterior do backend e as credenciais antigas somente no servidor. Toda escrita realizada depois do cutover precisa ser reconciliada manualmente; por isso o rollback deve ser decidido antes de reabrir edicoes no painel.

## Limitacao independente

A troca de banco nao cria dados que nao chegaram. A ingestao COP/WhatsApp e a sincronizacao do HUB permanecem indisponiveis enquanto a Evolution API nao for migrada ou reconectada. A volumetria por area continua funcionando porque consulta os incidentes do portal CopRede por uma integracao independente.
