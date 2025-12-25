# Análise de Viabilidade: Migração Telegram → WhatsApp (Evolution API)

## 📋 Sumário Executivo

**Objetivo**: Avaliar a viabilidade técnica de migrar o sistema COP Rede Informa de Telegram para WhatsApp usando Evolution API.

**Conclusão**: **VIÁVEL** ✅

A migração é tecnicamente viável com **baixa complexidade**, aproveitando 80% da arquitetura existente. O sistema atual já possui webhook HTTP que pode receber mensagens de qualquer fonte, facilitando a integração.

---

## 🏗️ Arquitetura Atual (Telegram)

### Componentes Backend

```
┌─────────────────────────────────────────────┐
│          Frontend (GitHub Pages)            │
│         index.html + JavaScript             │
└──────────────┬──────────────────────────────┘
               │ HTTP REST API
┌──────────────▼──────────────────────────────┐
│         Backend (Node.js/Express)           │
│              Railway Deploy                 │
│                                             │
│  ┌──────────────┐  ┌────────────────┐      │
│  │  server.js   │  │   storage.js   │      │
│  │  (API REST)  │  │   (JSONBin)    │      │
│  └──────┬───────┘  └────────────────┘      │
│         │                                    │
│  ┌──────▼───────┐  ┌────────────────┐      │
│  │  parser.js   │  │   config.js    │      │
│  │ (Extrator)   │  │  (Mapeamentos) │      │
│  └──────────────┘  └────────────────┘      │
│                                             │
│  ┌──────────────┐  ┌────────────────┐      │
│  │ telegram.js  │  │  userbot.js    │      │
│  │  (Bot API)   │  │   (MTProto)    │      │
│  └──────┬───────┘  └────┬───────────┘      │
└─────────┼────────────────┼──────────────────┘
          │                │
          ▼                ▼
    ┌─────────────────────────┐
    │    Telegram Server      │
    │  Grupo: -1003217044000  │
    └─────────────────────────┘
```

### Fluxo de Dados Atual

1. **Mensagem chega no grupo Telegram**
2. **UserBot (MTProto)** monitora em tempo real
3. **Parser** extrai campos estruturados
4. **Storage** salva no JSONBin
5. **Frontend** consulta via API REST


### Endpoints Existentes

```javascript
// Endpoints principais
GET  /health                          // Health check
GET  /api/telegram/status             // Status conexão
POST /api/telegram/sincronizar        // Sincronizar mensagens
GET  /api/cop-rede-informa            // Listar COP
GET  /api/alertas                     // Listar alertas
POST /api/webhook/mensagem            // ⭐ WEBHOOK GENÉRICO
```

### 🎯 Ponto Chave: Webhook Genérico

**O sistema JÁ possui um webhook HTTP** (`/api/webhook/mensagem`) que aceita mensagens de qualquer fonte:

```javascript
// Payload aceito:
{
  "texto": "COP REDE INFORMA\n...",
  "remetente": "nome_do_bot"
}
```

Este endpoint:
- ✅ Não depende do Telegram
- ✅ Já integra com parser
- ✅ Já salva no storage
- ✅ Pode receber de WhatsApp, SMS, email, etc.

---

## 📱 Evolution API - Estrutura

### O Que É

Evolution API é uma **API open-source** para integração com WhatsApp, baseada na biblioteca Baileys (sem WhatsApp Business oficial necessário).

### Arquitetura Proposta

```
┌─────────────────────────────────────────────┐
│          Frontend (GitHub Pages)            │
│         index.html + JavaScript             │
└──────────────┬──────────────────────────────┘
               │ HTTP REST API (SEM MUDANÇAS)
┌──────────────▼──────────────────────────────┐
│         Backend (Node.js/Express)           │
│              Railway Deploy                 │
│                                             │
│  ┌──────────────┐  ┌────────────────┐      │
│  │  server.js   │  │   storage.js   │      │
│  │  (API REST)  │  │   (JSONBin)    │      │
│  └──────┬───────┘  └────────────────┘      │
│         │                                    │
│  ┌──────▼───────┐  ┌────────────────┐      │
│  │  parser.js   │  │   config.js    │      │
│  │ (MANTIDO)    │  │  (MANTIDO)     │      │
│  └──────────────┘  └────────────────┘      │
│                                             │
│  ┌──────────────────────────────────┐      │
│  │   /api/webhook/mensagem         │      │
│  │      (WEBHOOK EXISTENTE)         │      │
│  └────────────▲─────────────────────┘      │
└───────────────┼──────────────────────────────┘
                │ HTTP POST
┌───────────────▼──────────────────────────────┐
│         Evolution API (WhatsApp)            │
│         (Servidor separado/Cloud)           │
│                                             │
│  - Webhook: MESSAGES_UPSERT                 │
│  - Endpoint: https://backend/webhook        │
│  - Autenticação: API Key                    │
└──────────────┬──────────────────────────────┘
               │ WhatsApp Connection
               ▼
         ┌──────────────┐
         │   WhatsApp   │
         │  Seu número  │
         └──────────────┘
```

### Webhook Evolution API

**Evento**: `MESSAGES_UPSERT`

**Payload recebido**:
```json
{
  "event": "messages.upsert",
  "data": {
    "key": {
      "remoteJid": "55119XXXXXXXX@s.whatsapp.net",
      "fromMe": false
    },
    "message": {
      "conversation": "COP REDE INFORMA\nTIPO: Volume..."
    },
    "messageTimestamp": "1672531200",
    "pushName": "Contato Nome"
  }
}
```

---

## 🔄 Pontos de Mudança

### ❌ O Que REMOVER

1. **telegram.js** - Integração Bot API (2 arquivos)
2. **userbot.js** - Integração MTProto UserBot
3. **Variáveis de ambiente Telegram**:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_API_ID`
   - `TELEGRAM_API_HASH`
   - `TELEGRAM_SESSION`

### ➕ O Que ADICIONAR

1. **whatsapp.js** - Novo adaptador Evolution API (1 arquivo)
2. **Variáveis de ambiente WhatsApp**:
   - `EVOLUTION_API_URL` (https://api.evolution.com.br)
   - `EVOLUTION_API_KEY` (token autenticação)
   - `EVOLUTION_INSTANCE_NAME` (nome da instância)

### 🔧 O Que MANTER (80% do código)

- ✅ **parser.js** - Extração de campos (ZERO mudanças)
- ✅ **storage.js** - JSONBin (ZERO mudanças)
- ✅ **config.js** - Mapeamentos de áreas (ZERO mudanças)
- ✅ **server.js** - API REST (pequenas mudanças)
- ✅ **Frontend** - index.html (ZERO mudanças)
- ✅ **Webhook `/api/webhook/mensagem`** - JÁ EXISTE!

---

## 💻 Implementação Proposta

### 1. Arquivo: `backend/whatsapp.js`

```javascript
/**
 * Adaptador Evolution API para WhatsApp
 * Converte webhook do Evolution para formato do parser
 */

const express = require('express');
const { processarMensagem } = require('./parser');
const storage = require('./storage');

// Configurações
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

/**
 * Processa webhook do Evolution API
 */
async function processarWebhookEvolution(payload) {
  // Extrair mensagem do payload Evolution
  const { event, data } = payload;

  // Apenas processar mensagens recebidas (não enviadas por nós)
  if (data.key.fromMe) {
    console.log('[WhatsApp] Mensagem enviada por nós, ignorando');
    return null;
  }

  // Extrair texto da mensagem
  const texto = data.message?.conversation ||
                data.message?.extendedTextMessage?.text || '';

  if (!texto) {
    console.log('[WhatsApp] Mensagem sem texto');
    return null;
  }

  console.log('[WhatsApp] Mensagem recebida:', texto.substring(0, 50));

  // Criar objeto compatível com o parser
  const msgFormatada = {
    message_id: data.key.id,
    date: parseInt(data.messageTimestamp),
    text: texto,
    from: {
      username: data.pushName || 'whatsapp',
      is_bot: false
    }
  };

  // Usar parser existente (ZERO mudanças no parser!)
  const resultado = processarMensagem(msgFormatada);

  if (!resultado) {
    console.log('[WhatsApp] Mensagem não reconhecida pelo parser');
    return null;
  }

  // Salvar no storage
  if (resultado.tipo === 'COP_REDE_INFORMA') {
    await storage.adicionarCopRedeInforma(resultado.dados);
    console.log('[WhatsApp] ✅ COP REDE INFORMA salvo');
  } else if (resultado.tipo === 'NOVO_EVENTO') {
    await storage.adicionarAlerta(resultado.dados);
    console.log('[WhatsApp] ✅ Alerta salvo');
  }

  return resultado;
}

module.exports = {
  processarWebhookEvolution
};
```

### 2. Atualizar `server.js`

```javascript
// Adicionar rota específica para Evolution API
const whatsapp = require('./whatsapp');

app.post('/api/webhook/evolution', async (req, res) => {
  try {
    const payload = req.body;

    // Validar API Key (segurança)
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== process.env.EVOLUTION_WEBHOOK_SECRET) {
      return res.status(401).json({ erro: 'API Key inválida' });
    }

    // Processar webhook
    const resultado = await whatsapp.processarWebhookEvolution(payload);

    res.json({
      sucesso: true,
      processado: !!resultado,
      tipo: resultado?.tipo
    });
  } catch (error) {
    console.error('[Webhook Evolution] Erro:', error);
    res.status(500).json({ erro: error.message });
  }
});
```

### 3. Configurar Evolution API

**No painel Evolution API**:

1. Criar instância WhatsApp
2. Conectar seu número (QR Code)
3. Configurar webhook:
   ```json
   {
     "url": "https://seu-backend.railway.app/api/webhook/evolution",
     "events": ["MESSAGES_UPSERT"],
     "webhook_by_events": false,
     "webhook_base64": false
   }
   ```

4. Adicionar header customizado:
   ```
   x-api-key: SEU_WEBHOOK_SECRET_AQUI
   ```

---

## 📊 Comparação Detalhada

| Aspecto | Telegram (Atual) | WhatsApp (Proposto) |
|---------|------------------|---------------------|
| **API Usada** | Bot API + MTProto | Evolution API |
| **Autenticação** | Bot Token + Session | API Key + QR Code |
| **Tipo de Conta** | Bot Telegram | Número WhatsApp pessoal |
| **Recepção Mensagens** | Polling + Webhook | Webhook Evolution |
| **Parser de Mensagens** | ✅ MANTIDO | ✅ MANTIDO (ZERO mudanças) |
| **Storage JSONBin** | ✅ MANTIDO | ✅ MANTIDO (ZERO mudanças) |
| **Frontend** | ✅ MANTIDO | ✅ MANTIDO (ZERO mudanças) |
| **Complexidade Setup** | Alta (API ID, Hash, Session) | Média (QR Code scan) |
| **Custo** | Gratuito | Gratuito (self-hosted) |
| **Deploy** | Railway | Railway (sem mudanças) |
| **Linhas de código alteradas** | - | ~150 linhas (novo adaptador) |
| **Risco de quebra** | Baixo | Muito baixo |

---

## ✅ Vantagens da Migração

1. **Mensagens mais detalhadas**: Você recebe versões completas no WhatsApp pessoal
2. **Notificações nativas**: WhatsApp notifica automaticamente
3. **Sem limitações de Bot**: Bots Telegram têm restrições para ler mensagens
4. **Código limpo**: Remove dependências complexas (MTProto, Session string)
5. **Mantém arquitetura**: 80% do código permanece inalterado
6. **Webhook já existe**: Sistema já preparado para receber de qualquer fonte

---

## ⚠️ Desvantagens / Riscos

1. **Dependência externa**: Evolution API é um servidor separado
   - **Mitigação**: Pode hospedar próprio servidor Evolution (Docker)

2. **Estabilidade WhatsApp**: WhatsApp pode banir números que usam APIs não oficiais
   - **Mitigação**: Evolution API usa Baileys (amplamente testado)
   - **Alternativa**: Usar WhatsApp Business API oficial (pago)

3. **Setup inicial**: Precisa escanear QR Code periodicamente
   - **Mitigação**: Evolution API mantém sessão por longo tempo

4. **Rate limits**: WhatsApp pode limitar número de mensagens
   - **Mitigação**: Sistema atual já tem controle de taxa (10s intervalo)

---

## 🛠️ Plano de Implementação

### Fase 1: Preparação (1-2 horas)
- [ ] Instalar Evolution API (Docker local ou cloud)
- [ ] Conectar número WhatsApp via QR Code
- [ ] Testar envio/recebimento de mensagens

### Fase 2: Desenvolvimento (2-3 horas)
- [ ] Criar `backend/whatsapp.js`
- [ ] Adicionar rota `/api/webhook/evolution` no `server.js`
- [ ] Configurar variáveis de ambiente
- [ ] Testar webhook localmente (ngrok/Railway preview)

### Fase 3: Testes (1-2 horas)
- [ ] Enviar mensagem COP REDE INFORMA de teste
- [ ] Verificar parsing e salvamento
- [ ] Testar alertas
- [ ] Validar frontend (sem mudanças necessárias)

### Fase 4: Deploy (1 hora)
- [ ] Configurar webhook Evolution → Railway
- [ ] Desativar Telegram (opcional: manter em paralelo)
- [ ] Monitorar logs primeira mensagem real
- [ ] Remover código Telegram se tudo funcionar

**Tempo total estimado**: 5-8 horas

---

## 📁 Estrutura de Arquivos Pós-Migração

```
backend/
├── config.js           ✅ MANTIDO (só renomear variáveis)
├── parser.js           ✅ MANTIDO (ZERO mudanças)
├── storage.js          ✅ MANTIDO (ZERO mudanças)
├── server.js           🔧 MODIFICADO (adicionar rota webhook)
├── whatsapp.js         ➕ NOVO (adaptador Evolution API)
├── telegram.js         ❌ REMOVIDO (ou manter para transição)
├── userbot.js          ❌ REMOVIDO (ou manter para transição)
└── package.json        🔧 MODIFICADO (remover deps Telegram)
```

---

## 🔐 Variáveis de Ambiente

### Remover (Telegram)
```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
TELEGRAM_SESSION=...
TELEGRAM_GROUP_ID=...
```

### Adicionar (WhatsApp)
```env
# Evolution API
EVOLUTION_API_URL=https://api.evolution.com.br
EVOLUTION_API_KEY=sua-api-key-aqui
EVOLUTION_INSTANCE_NAME=cop-rede-informa
EVOLUTION_WEBHOOK_SECRET=senha-segura-para-validar-webhook

# Manter existentes
JSONBIN_MASTER_KEY=...
JSONBIN_ACCESS_KEY=...
PORT=3001
```

---

## 📚 Referências Técnicas

### Evolution API Documentation
- [Webhooks Configuration](https://doc.evolution-api.com/v2/en/configuration/webhooks)
- [GitHub Repository](https://github.com/EvolutionAPI/evolution-api)
- [Set Webhook Endpoint](https://docs.evolution-api.com/docs/04-Webhooks/00-set-webhook/)

### Webhook Event Types
- [MESSAGES_UPSERT Issue Discussion](https://github.com/EvolutionAPI/evolution-api/issues/1340)
- [WhatsApp Cloud API Integration](https://doc.evolution-api.com/v2/en/integrations/cloudapi)

### Implementation Examples
- [Real-time Chat with Evolution API (Portuguese)](https://medium.com/@araujo_89059/implementando-um-chat-realtime-com-evolution-api-whatsapp-e-modelos-de-intelig%C3%AAncia-artificial-95ba13092c82)
- [n8n Workflow Integration](https://n8n.io/workflows/6544-forward-chatwoot-messages-to-whatsapp-via-evolution-api-with-media-support/)

---

## 🎯 Recomendação Final

### ✅ **RECOMENDO MIGRAR**

**Justificativa**:
1. Arquitetura atual **JÁ** está preparada (webhook genérico)
2. Aproveitamento de **80% do código existente**
3. Implementação **simples e rápida** (5-8 horas)
4. **Baixo risco**: Parser e Storage não mudam
5. **Benefícios claros**: Mensagens mais detalhadas, notificações nativas
6. **Reversível**: Pode manter Telegram em paralelo durante transição

### 🚀 Próximos Passos Sugeridos

1. **Testar Evolution API** em ambiente local (Docker)
2. **Criar branch** `feature/whatsapp-migration`
3. **Implementar adaptador** `whatsapp.js`
4. **Configurar webhook** Evolution → Railway
5. **Executar testes** com mensagens reais
6. **Monitorar** por 1 semana em paralelo com Telegram
7. **Remover Telegram** se tudo estável

---

## 📞 Suporte

**Em caso de dúvidas ou problemas durante implementação**:
- Evolution API GitHub Issues: https://github.com/EvolutionAPI/evolution-api/issues
- Evolution API Documentation: https://doc.evolution-api.com/v2/
- Community Support: Telegram/Discord da Evolution API

---

**Documento criado em**: 2025-12-25
**Versão**: 1.0
**Status**: Análise Completa ✅
