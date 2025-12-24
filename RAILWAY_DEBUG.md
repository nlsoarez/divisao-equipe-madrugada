# Guia de Debug - Railway Deploy

## Status Atual

✅ **Configurações realizadas:**
- [x] Diretórios `backend` e `js` corrigidos (removidos espaços)
- [x] URL do backend atualizada para: `https://divisao-equipe-madrugada-production.up.railway.app`
- [x] Variáveis de ambiente configuradas no Railway
- [x] Arquivos `nixpacks.toml` e `railway.json` configurados

## Como Verificar se o Backend Está Funcionando

### 1. Verificar Logs do Deploy no Railway

1. Acesse o projeto no Railway
2. Clique na aba **"Deployments"**
3. Verifique se o último deploy foi bem-sucedido (deve mostrar status verde)
4. Clique no deploy para ver os logs completos
5. Procure por mensagens de erro, especialmente:
   - Erros de `npm install`
   - Erros de inicialização do servidor
   - Mensagens de `Servidor rodando na porta XXXX`

### 2. Testar o Endpoint de Health

Abra uma nova aba no navegador e acesse:
```
https://divisao-equipe-madrugada-production.up.railway.app/health
```

**Resposta esperada:**
```json
{
  "status": "ok",
  "timestamp": "2025-12-24T17:20:22.000Z",
  "telegram": { ... }
}
```

Se retornar erro 404 ou Connection Refused, significa que o servidor não está rodando.

### 3. Verificar Console do Navegador

1. Abra a página do frontend: `https://nlsoarez.github.io/divisao-equipe-madrugada/`
2. Pressione F12 para abrir o DevTools
3. Vá na aba **Console**
4. Procure por erros relacionados a:
   - `CORS` - indica problema de permissões cross-origin
   - `Failed to fetch` - indica que o backend não está respondendo
   - `404 Not Found` - indica que o endpoint não existe
   - `ERR_CONNECTION_REFUSED` - indica que o servidor não está rodando

### 4. Verificar Aba Network (Rede)

1. No DevTools, vá na aba **Network** (Rede)
2. Recarregue a página (F5)
3. Procure por requisições para a URL do Railway
4. Clique na requisição e veja:
   - **Status**: deve ser 200 (OK)
   - **Response**: veja a resposta do servidor
   - **Headers**: verifique se CORS está configurado

## Problemas Comuns e Soluções

### ❌ Problema: Backend retorna 404

**Causa**: O servidor não está rodando ou o deploy falhou

**Solução**:
1. Verifique os logs do Railway
2. Verifique se as dependências foram instaladas corretamente
3. Force um novo deploy no Railway

### ❌ Problema: CORS Error

**Causa**: Backend bloqueando requisições do frontend

**Solução**:
- A configuração já está como `CORS_ORIGIN=*` no código
- Verifique se não há uma variável `CORS_ORIGIN` configurada no Railway que esteja sobrescrevendo

### ❌ Problema: Connection Refused / ERR_CONNECTION_REFUSED

**Causa**: Servidor não está rodando ou Railway não expôs a porta

**Solução**:
1. Verifique se o Railway gerou uma URL pública para o serviço
2. Verifique os logs para ver se o servidor iniciou
3. Verifique se a variável `PORT` está sendo lida corretamente

### ❌ Problema: Página carrega mas não mostra dados

**Causa**: Frontend não consegue se conectar ao backend

**Solução**:
1. Abra o console (F12)
2. Veja os erros específicos
3. Teste o endpoint `/health` manualmente
4. Verifique se a URL do backend está correta no `index.html`

## Variáveis de Ambiente Necessárias no Railway

Certifique-se de que essas variáveis estão configuradas:

```
JSONBIN_ACCESS_KEY=$2a$10$oo.QiJ4MvOeVCqfzC19p7OcJgzUVEU7eWINJO1EZefPScNpfBIRKC
JSONBIN_MASTER_KEY=$2a$10$dQyAV006kSDh2CvPh8cBCu2yspqnkCb4Dpm.A7wby6q.tZAKQHNce
TELEGRAM_BOT_TOKEN=8450919829:AAFbu6mgwWSj_SCSryS0e-6FHRGQvkHrVRM
TELEGRAM_GROUP_ID=-1003217044000
PORT=3001
```

**IMPORTANTE**: O Railway injeta automaticamente a variável `PORT`, mas você pode sobrescrever se necessário.

## Próximos Passos

1. ✅ Verificar logs do Railway
2. ✅ Testar endpoint `/health`
3. ✅ Verificar console do navegador
4. ✅ Se o backend não estiver rodando, force um novo deploy
5. ✅ Se persistir, compartilhe os logs do Railway para análise

## Comandos Úteis para Debug Local

Se quiser testar localmente antes de fazer deploy:

```bash
# Entrar na pasta do backend
cd backend

# Instalar dependências
npm install

# Criar arquivo .env com as variáveis
cp .env.example .env
# Edite o .env com suas credenciais

# Rodar o servidor
npm start

# Testar o health check
curl http://localhost:3001/health
```

## Estrutura de Arquivos

```
.
├── backend/           # API Node.js + Express
│   ├── server.js      # Servidor principal
│   ├── config.js      # Configurações
│   ├── package.json   # Dependências
│   └── .env          # Variáveis de ambiente (não commitado)
├── js/               # Scripts do frontend
│   ├── config.js     # Configurações do frontend
│   └── api.js        # Funções de API
├── index.html        # Página principal
├── nixpacks.toml     # Configuração Nixpacks
└── railway.json      # Configuração Railway
```
