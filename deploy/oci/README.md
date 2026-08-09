# Runbook de migracao para OCI

## Topologia

Uma VM Ubuntu `VM.Standard.A1.Flex` executa dois containers:

- `app`: Node/Express, frontend estatico e API na porta interna 3001;
- `caddy`: entrada publica 80/443, HTTPS automatico quando ha dominio e Basic Auth para o painel/API.

A porta 3001 nao e aberta na VCN. O volume Docker `app-data` preserva caches em reinicios de container. JSONBin continua sendo a persistencia autoritativa; o volume local nao substitui backup.

Esta topologia e intencionalmente de uma replica. O polling e os timestamps da Evolution vivem na memoria do processo; escalar horizontalmente agora duplicaria leitura/processamento.

## 1. Pre-requisitos

- tenancy e compartment OCI;
- Terraform 1.5+ local ou OCI Resource Manager;
- chave publica SSH;
- seu IP publico em CIDR `/32` para liberar SSH;
- dominio recomendado para HTTPS;
- novas credenciais JSONBin. As credenciais antigas estao comprometidas porque foram publicadas no Git.

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

Preencha `SITE_ADDRESS` e `CORS_ORIGIN` com o dominio HTTPS. Configure os novos segredos JSONBin. Mantenha na fase 1:

Gere a senha do proxy antes do deploy:

```powershell
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'SUA-SENHA-FORTE'
```

Grave o usuario em `BASIC_AUTH_USER` e o hash em `BASIC_AUTH_HASH`. No arquivo `.env` do Compose, cada `$` do hash precisa ser escrito como `$$` para nao ser interpretado como interpolacao.

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

## 5. Validar

```bash
curl -fsS https://SEU_DOMINIO/health
curl -fsS -u USUARIO:SENHA https://SEU_DOMINIO/api/capacidades
```

Resultado esperado na fase 1:

- HTTP 200;
- `status: "degraded"`;
- `escala: true` se JSONBin estiver configurado;
- `volumeWhatsappTempoReal: false`;
- `alocacaoHubTempoReal: false`;
- POST `/api/alocacao-hub/sincronizar` retorna HTTP 503 com `EVOLUTION_API_INDISPONIVEL`.

Tambem valide escrita e leitura de uma escala nao critica antes de encerrar o servico antigo.

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
- O `ADMIN_PIN` esta no JavaScript e nao protege sozinho; a barreira real na OCI e o Basic Auth do Caddy.
- O webhook da Evolution permanece publico por necessidade de integracao. Adicione validacao de assinatura/token quando a Evolution for migrada.
- O volume Docker preserva cache, nao alta disponibilidade. A VM e um ponto unico de falha.
