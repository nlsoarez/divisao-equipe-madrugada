# Divisao Equipe Madrugada

Painel operacional estatico com backend Node/Express. A implantacao de producao foi preparada para OCI em uma unica VM, com Docker Compose e Caddy.

## Estado da migracao

- Frontend e API passam a usar o mesmo dominio OCI; nao existe mais URL fixa do Railway.
- Escalas continuam persistidas no JSONBin quando as novas credenciais sao fornecidas ao backend.
- A matriz de ofensores continua usando Supabase/Visium conforme a disponibilidade de rede.
- Evolution API fica desativada na primeira fase (`EVOLUTION_ENABLED=false`). Atualizacao de volume via WhatsApp e sincronizacao da alocacao HUB ficam indisponiveis; leitura do historico HUB so funciona se seu bin for configurado.
- `/health` retorna `degraded` enquanto a Evolution estiver desativada. Isso e esperado e ainda retorna HTTP 200 para manter o container saudavel.

## Execucao local

```powershell
Copy-Item deploy/oci/.env.example deploy/oci/.env
# Edite deploy/oci/.env, use SITE_ADDRESS=http://localhost e configure o hash Basic Auth.
docker compose -f deploy/oci/compose.yaml up -d --build
```

Abra `http://localhost` e valide `http://localhost/health`.

## OCI

O runbook completo esta em [deploy/oci/README.md](deploy/oci/README.md). A infraestrutura Terraform cria uma VCN, subnet publica, regras 80/443/SSH e uma VM Ubuntu preparada para Docker.

## Seguranca

Credenciais JSONBin e Evolution foram historicamente versionadas neste repositorio. Apagar apenas o valor atual nao resolve: o historico Git e forks continuam contendo os segredos. Rotacione todas as chaves antes de implantar na OCI.

O `ADMIN_PIN` ainda e validado no navegador e, portanto, nao e autenticacao real. Na OCI, o Caddy exige Basic Auth no servidor para todo o painel/API, exceto health checks e o webhook da Evolution. Use senha forte e trate o PIN apenas como controle de interface.

## Testes

```powershell
Set-Location backend
npm ci
npm test -- --runInBand
```

O branch recebido ja tinha testes de parser e caminhos de modulos inconsistentes com o codigo atual. A migracao nao altera essas regras de negocio; consulte o runbook para o smoke test especifico do container.
