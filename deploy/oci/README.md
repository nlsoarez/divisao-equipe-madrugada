# Runbook de migracao para OCI

## Topologia

Uma VM Ubuntu `VM.Standard.A1.Flex` executa dois containers:

- `app`: Node/Express, frontend estatico e API na porta interna 3001;
- `caddy`: entrada publica 80/443 e HTTPS automatico quando ha dominio. A autenticacao administrativa e validada pelo backend.

A porta 3001 nao e aberta na VCN. O volume Docker `app-data` preserva apenas caches em reinicios de container. O Supabase e a persistencia autoritativa.

Esta topologia e intencionalmente de uma replica. O polling e os timestamps da Evolution vivem na memoria do processo; escalar horizontalmente agora duplicaria leitura/processamento.

## 1. Pre-requisitos

- tenancy e compartment OCI;
- Terraform 1.5+ local ou OCI Resource Manager;
- chave publica SSH;
- seu IP publico em CIDR `/32` para liberar SSH;
- dominio recomendado para HTTPS;
- projeto Supabase com a migration de `supabase/migrations` aplicada;
- secret key do Supabase, armazenada somente no ambiente do backend.

## 2. Criar a infraestrutura

```powershell
Set-Location deploy/oci/terraform
Copy-Item terraform.tfvars.example terraform.tfvars
# Preencha region, tenancy_ocid, compartment_ocid, ssh_authorized_key e ssh_ingress_cidr.
terraform init
terraform plan -out tfplan
terraform apply tfplan
terraform output public_ip
```

O mesmo diretorio pode ser enviado como stack ao OCI Resource Manager. Nao coloque segredos da aplicacao em `terraform.tfvars` nem no state.

Se `VM.Standard.A1.Flex` estiver sem capacidade no AD, tente outro Availability Domain. Trocar de shape sem revisar `shape_config` nao e uma correcao segura.

## 3. DNS e ambiente

Crie um registro `A` do dominio para o `public_ip`. Depois:

```powershell
Copy-Item deploy/oci/.env.example deploy/oci/.env
```

Preencha `SITE_ADDRESS`, `CORS_ORIGIN`, `SUPABASE_URL` e `SUPABASE_SECRET_KEY`. Na fase 1, mantenha `EVOLUTION_ENABLED=false`.

Gere o hash da senha administrativa antes do deploy:

```powershell
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'SUA-SENHA-FORTE'
```

Grave o hash em `ADMIN_PASSWORD_HASH` e gere um `ADMIN_SESSION_SECRET` aleatorio com pelo menos 32 caracteres. No arquivo `.env` do Compose, cada `$` do hash precisa ser escrito como `$$` para nao ser interpretado como interpolacao.

```dotenv
EVOLUTION_ENABLED=false
WHATSAPP_POLLING_DISABLED=true
```

Para uma validacao sem DNS, use `SITE_ADDRESS=http://IP_PUBLICO` e o mesmo valor em `CORS_ORIGIN`. Isso nao oferece TLS e deve ser temporario.

## 4. Implantar

O script envia somente o commit atual, instala o `.env` remoto com modo 600, constroi a imagem na VM e valida o health check:

```powershell
.\deploy\oci\deploy.ps1 `
  -HostIp (terraform -chdir=deploy/oci/terraform output -raw public_ip) `
  -KeyFile C:\caminho\oci_ed25519 `
  -EnvironmentFile .\deploy\oci\.env
```

O primeiro build pode demorar. O `cloud-init` tambem precisa terminar; na VM, acompanhe com:

```bash
cloud-init status --wait
```

### VM OCI compartilhada ja existente

Na VM `163.176.155.119`, o dashboard existente ja ocupa as portas 80/443. Nao suba um segundo Caddy. Use o instalador dedicado, que conecta a aplicacao a rede Docker existente e acrescenta uma rota isolada ao Caddy atual:

```powershell
.\deploy\oci\configure-existing-vm.ps1
```

O instalador pede a Supabase Secret key e a senha administrativa em campos ocultos. Os segredos seguem pelo stdin do SSH, ficam fora dos argumentos de processo e nao sao gravados no Git. Em uma nova tentativa, quando o arquivo de ambiente seguro e o hash da senha ja existirem na VM, use:

```powershell
.\deploy\oci\configure-existing-vm.ps1 -ReuseExistingSupabaseConfig -ReuseExistingAdminPassword
```

O script valida a configuracao do Caddy, espera o health check do novo container e testa HTTPS. A raiz, `GET /api/escala` e a tela `/admin` devem responder sem autenticacao HTTP; `GET /api/admin/session` e `PUT /api/escala` devem responder HTTP 401 sem uma sessao administrativa. Em caso de falha antes do reload, restaura o Caddyfile anterior.

Se a Secret key informada pertencer a outro projeto ou for rejeitada, corrija somente a credencial sem alterar a senha/Caddy:

```powershell
.\deploy\oci\update-supabase-secret.ps1
```

Esse atualizador reinicia apenas o container da aplicacao e restaura o `.env` anterior automaticamente se a leitura real de `/api/escala` falhar.

Para trocar apenas a senha administrativa, sem alterar Supabase ou Caddy:

```powershell
.\deploy\oci\update-admin-password.ps1
```

O script pede a nova senha duas vezes em campos ocultos, gera o hash na VM, invalida sessoes antigas, recria o container e restaura a configuracao anterior se a validacao falhar. Nunca envie a senha pelo chat nem grave a senha em texto puro no repositorio.

## 5. Validar

```bash
curl -fsS https://SEU_DOMINIO/health
curl -fsS https://SEU_DOMINIO/api/capacidades
curl -fsS https://SEU_DOMINIO/admin
```

Resultado esperado na fase 1:

- HTTP 200;
- `status: "degraded"`;
- `persistencia.configurada: true`;
- `escala: true` se o Supabase estiver configurado;
- `volumetriaPortal: true`, independentemente da Evolution API;
- `volumeWhatsappTempoReal: false`;
- `alocacaoHubTempoReal: false`;
- POST `/api/alocacao-hub/sincronizar` retorna HTTP 503 com `EVOLUTION_API_INDISPONIVEL`.

Tambem valide escrita e leitura de uma escala nao critica antes de encerrar o servico antigo.
Siga [docs/MIGRACAO_SUPABASE.md](../../docs/MIGRACAO_SUPABASE.md) para importar e conferir os bins antigos.

## 6. Migrar a Evolution API depois

Somente apos a instancia Evolution estar acessivel pela VM OCI:

1. preencha `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE_NAME` e os chat IDs;
2. altere `EVOLUTION_ENABLED=true`;
3. mantenha polling desativado se o webhook estiver confirmado;
4. configure o webhook `https://SEU_DOMINIO/api/whatsapp/webhook` para `MESSAGES_UPSERT`;
5. rode o deploy novamente e confirme `/api/whatsapp/status`;
6. so entao teste a sincronizacao do HUB.

Nao aponte o backend OCI para a URL Railway antiga da Evolution: a dependencia apenas mudaria de nome, sem ter sido migrada.

## Limites e riscos conhecidos

- O Railway antigo responde `Application not found`; hoje o GitHub Pages carrega, mas as chamadas ao backend falham.
- O endpoint Visium usa HTTP e pode depender de VPN/allowlist. Saida da OCI precisa ser testada separadamente.
- A consulta da escala e publica. `/admin` mostra um formulario com apenas a senha; todas as mutacoes da API exigem a sessao segura criada pelo backend.
- O webhook da Evolution permanece publico por necessidade de integracao. Adicione validacao de assinatura/token quando a Evolution for migrada.
- O volume Docker preserva cache, nao alta disponibilidade. A VM e um ponto unico de falha.
