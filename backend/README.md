# Backend COP Rede Informa

API Node/Express que persiste escalas, consulta matriz/topologia e integra mensagens WhatsApp pela Evolution API.

Requer Node.js 20 ou superior.

## Desenvolvimento

```powershell
Copy-Item .env.example .env
npm ci
npm start
```

Sem `EVOLUTION_ENABLED=true`, o servidor inicia normalmente em modo degradado. Isso e o comportamento esperado durante a primeira fase da migracao OCI.

## Endpoints operacionais

| Metodo | Rota | Uso |
|---|---|---|
| GET | `/health` | Saude e capacidades ativas |
| GET | `/api/capacidades` | Flags de funcionalidades |
| GET/PUT | `/api/escala` | Leitura e persistencia da escala |
| GET | `/api/matriz-ofensores` | Matriz via Supabase |
| GET | `/api/alocacao-hub/ultima` | Ultimo HUB persistido |
| POST | `/api/alocacao-hub/sincronizar` | Requer Evolution API |
| POST | `/api/whatsapp/webhook` | Webhook Evolution |

## Producao

Use o [runbook OCI](../deploy/oci/README.md). Nao inclua segredos em arquivos versionados. As chaves antigas do repositorio devem ser consideradas comprometidas e rotacionadas.
