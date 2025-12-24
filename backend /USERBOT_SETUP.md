# UserBot Setup - Usando Conta Pessoal do Telegram

Este guia explica como usar sua conta pessoal do Telegram para monitorar mensagens de outros bots no grupo.

## Por que preciso disso?

O Telegram **não permite** que bots recebam mensagens de outros bots. Por isso, mensagens do @mrpralonbot não chegam ao @Copredeinforma_render_bot.

A solução é usar sua conta pessoal (que é um USUÁRIO, não um bot) para monitorar o grupo.

---

## Opção 1: Encaminhamento Manual (Mais Simples)

**Sem necessidade de configuração!**

1. Quando @mrpralonbot enviar uma mensagem no grupo
2. Toque e segure na mensagem
3. Clique em "Encaminhar"
4. Encaminhe para o mesmo grupo

O bot vai receber a mensagem encaminhada porque ela vem de VOCÊ (um usuário).

---

## Opção 2: UserBot Automatizado (Avançado)

### Passo 1: Obter credenciais da API do Telegram

1. Acesse https://my.telegram.org/apps
2. Faça login com seu número de telefone
3. Crie um novo "App" (pode colocar qualquer nome)
4. Anote o **API_ID** e **API_HASH**

### Passo 2: Configurar variáveis de ambiente

Crie um arquivo `.env` no diretório backend (ou configure no sistema):

```env
TELEGRAM_API_ID=seu_api_id_aqui
TELEGRAM_API_HASH=seu_api_hash_aqui
TELEGRAM_GROUP_ID=-1003217044000
```

### Passo 3: Instalar dependências

```bash
cd backend
npm install
```

### Passo 4: Primeira execução (autenticação)

**IMPORTANTE:** A primeira execução precisa ser feita LOCALMENTE (no seu computador), não no Render.

```bash
npm run userbot
```

O script vai pedir:
1. Seu número de telefone (formato internacional: +5511999999999)
2. O código que você receber no Telegram
3. Sua senha 2FA (se tiver)

Após o login, o script vai mostrar uma **SESSION STRING**. Copie essa string!

### Passo 5: Salvar a session

Adicione a session ao seu `.env`:

```env
TELEGRAM_API_ID=seu_api_id
TELEGRAM_API_HASH=seu_api_hash
TELEGRAM_SESSION=sua_session_string_muito_longa_aqui
TELEGRAM_GROUP_ID=-1003217044000
```

### Passo 6: Executar

Agora você pode rodar o userbot sem precisar de login interativo:

```bash
npm run userbot
```

O userbot vai monitorar o grupo e processar todas as mensagens, incluindo as de @mrpralonbot!

---

## Arquitetura

```
┌─────────────────────┐
│   @mrpralonbot      │
│   (Bot N8N)         │
└─────────┬───────────┘
          │ envia mensagem
          ▼
┌─────────────────────┐
│   Grupo Telegram    │
│  -1003217044000     │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐      ┌─────────────────────┐
│  UserBot (sua conta)│      │  Bot API (não       │
│  RECEBE mensagens   │      │  recebe de bots)    │
│  de TODOS           │      │                     │
└─────────┬───────────┘      └─────────────────────┘
          │
          ▼
┌─────────────────────┐
│  Parser + Storage   │
│  Processa e salva   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│  Portal/Dashboard   │
└─────────────────────┘
```

---

## Segurança

- **NUNCA** compartilhe sua SESSION STRING
- A session dá acesso completo à sua conta
- Use uma conta secundária se preferir
- Você pode revogar sessions em Configurações > Privacidade > Sessões Ativas

---

## Troubleshooting

### "API_ID e API_HASH são obrigatórios"
Configure as variáveis de ambiente corretamente.

### "PhoneNumberInvalid"
Use o formato internacional completo: +5511999999999

### "SessionPasswordNeeded"
Você tem autenticação em duas etapas. Digite sua senha quando solicitado.

### "FloodWait"
Telegram está limitando requisições. Aguarde o tempo indicado.
