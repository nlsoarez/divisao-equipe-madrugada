/**
 * Servidor Express para API do COP REDE INFORMA
 * Expõe endpoints REST para o frontend do painel ADM
 */

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { SERVER_CONFIG, EVOLUTION_CONFIG } = require('./config');
const storage = require('./storage');
const whatsapp = require('./whatsapp');

const app = express();

// Middlewares
app.use(cors({
  origin: SERVER_CONFIG.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

/**
 * Diagnóstico - Ver estrutura dos dados salvos
 * Útil para debugar problemas com volumetria
 */
app.get('/api/diagnostico/dados', async (req, res) => {
  try {
    const dados = await storage.obterCopRedeInforma({}, true);

    // Ordenar por data (mais recente primeiro)
    dados.sort((a, b) => new Date(b.dataRecebimento) - new Date(a.dataRecebimento));

    // Analisar estrutura dos dados
    const diagnostico = {
      totalMensagens: dados.length,
      mensagensComResumoGrupo: dados.filter(d => d.resumo?.grupo && Object.keys(d.resumo.grupo).length > 0).length,
      mensagensSemResumoGrupo: dados.filter(d => !d.resumo?.grupo || Object.keys(d.resumo.grupo).length === 0).length,
      ultimaMensagem: dados.length > 0 ? {
        id: dados[0].id,
        dataRecebimento: dados[0].dataRecebimento,
        temResumoGrupo: !!(dados[0].resumo?.grupo && Object.keys(dados[0].resumo.grupo).length > 0),
        resumoGrupo: dados[0].resumo?.grupo || {},
        resumoCompleto: dados[0].resumo || {},
        areaMapeada: dados[0].areaMapeada,
        totalEventos: dados[0].totalEventos,
        volumePorArea: dados[0].volumePorArea || {},
        mensagemOriginal: dados[0].mensagemOriginal ? dados[0].mensagemOriginal.substring(0, 800) : null
      } : null,
      primeiras5: dados.slice(0, 5).map(d => ({
        id: d.id,
        dataRecebimento: d.dataRecebimento,
        temResumoGrupo: !!(d.resumo?.grupo && Object.keys(d.resumo.grupo).length > 0),
        clusters: d.resumo?.grupo ? Object.keys(d.resumo.grupo) : [],
        totalGrupo: d.resumo?.grupo ? Object.values(d.resumo.grupo).reduce((a, b) => a + b, 0) : 0,
        primeiraLinha: d.mensagemOriginal ? d.mensagemOriginal.split('\n')[0].substring(0, 100) : null
      }))
    };

    res.json({ sucesso: true, diagnostico });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Reprocessar todas as mensagens do histórico
 * Útil após correções no parser
 */
app.post('/api/diagnostico/reprocessar', async (req, res) => {
  try {
    console.log('[Diagnóstico] Iniciando reprocessamento do histórico...');
    const resultado = await whatsapp.buscarHistorico(200);
    res.json({
      sucesso: true,
      mensagem: 'Histórico reprocessado',
      resultado
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// ROTAS DE STATUS E HEALTH
// ============================================

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    whatsapp: whatsapp.obterStatus()
  });
});

// Alias para /api/health
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    whatsapp: whatsapp.obterStatus()
  });
});

/**
 * Estatísticas gerais
 */
app.get('/api/estatisticas', async (req, res) => {
  try {
    const stats = await storage.obterEstatisticas();

    res.json({
      sucesso: true,
      dados: {
        ...stats,
        whatsapp: whatsapp.obterStatus()
      }
    });
  } catch (error) {
    console.error('[API] Erro ao obter estatísticas:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// ROTAS LEGADAS (mantidas para compatibilidade do frontend)
// Telegram foi substituído por WhatsApp
// ============================================

/**
 * Sincronizar mensagens COP REDE INFORMA manualmente
 * Rota legada mantida para compatibilidade - usa WhatsApp
 */
app.post('/api/telegram/sincronizar', async (req, res) => {
  try {
    console.log('[Sync] Sincronizando via WhatsApp (Evolution API)...');
    const resultado = await whatsapp.buscarHistorico(100);

    res.json({
      sucesso: !resultado.erro,
      fonte: 'whatsapp',
      mensagem: resultado.erro || 'Histórico COP REDE INFORMA sincronizado via WhatsApp',
      copRedeInforma: resultado.copRedeInforma || 0
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// ROTAS DO WHATSAPP (Evolution API)
// ============================================

/**
 * Status da conexão WhatsApp
 */
app.get('/api/whatsapp/status', async (req, res) => {
  try {
    const status = await whatsapp.verificarConexao();
    res.json({
      sucesso: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Listar chats do WhatsApp (para descobrir o ID do grupo)
 */
app.get('/api/whatsapp/chats', async (req, res) => {
  try {
    const chats = await whatsapp.listarChats();
    res.json({
      sucesso: true,
      total: Array.isArray(chats) ? chats.length : 0,
      chats: chats
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Sincronizar histórico do WhatsApp
 */
app.post('/api/whatsapp/sincronizar', async (req, res) => {
  try {
    const limite = req.body.limite || 100;
    const resultado = await whatsapp.buscarHistorico(limite);
    res.json({
      sucesso: !resultado.erro,
      ...resultado
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Webhook da Evolution API para receber mensagens em tempo real
 * Configure este URL na Evolution API: POST /api/whatsapp/webhook
 */
app.post('/api/whatsapp/webhook', async (req, res) => {
  try {
    console.log('[WhatsApp Webhook] Recebido:', JSON.stringify(req.body).substring(0, 200));

    // Verificar se é evento de mensagem
    const event = req.body.event || req.body.type;
    if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') {
      console.log('[WhatsApp Webhook] Ignorando evento:', event);
      return res.json({ sucesso: true, ignorado: true });
    }

    const resultado = await whatsapp.processarWebhook(req.body);

    res.json({
      sucesso: true,
      processado: resultado !== null,
      tipo: resultado?.tipo || null
    });
  } catch (error) {
    console.error('[WhatsApp Webhook] Erro:', error.message);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Configurar webhook na Evolution API
 */
app.post('/api/whatsapp/configurar-webhook', async (req, res) => {
  try {
    const { webhookUrl } = req.body;
    if (!webhookUrl) {
      return res.status(400).json({ sucesso: false, erro: 'webhookUrl é obrigatório' });
    }

    const resultado = await whatsapp.configurarWebhook(webhookUrl);
    res.json({
      sucesso: true,
      resultado
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// WEBHOOK PARA RECEBER MENSAGENS DIRETAMENTE
// WEBHOOK PARA RECEBER MENSAGENS DIRETAMENTE
// ============================================

/**
 * Recebe mensagens diretamente via HTTP POST
 * Use isso quando bots não conseguem ver mensagens de outros bots
 *
 * Exemplo de payload:
 * {
 *   "texto": "COP REDE INFORMA\n...",
 *   "remetente": "mrpralonbot"
 * }
 */
app.post('/api/webhook/mensagem', async (req, res) => {
  try {
    const { texto, remetente } = req.body;

    if (!texto) {
      return res.status(400).json({ sucesso: false, erro: 'Campo "texto" é obrigatório' });
    }

    console.log('[Webhook] =====================================');
    console.log('[Webhook] 📨 MENSAGEM RECEBIDA VIA WEBHOOK');
    console.log('[Webhook] Remetente:', remetente || 'desconhecido');
    console.log('[Webhook] Texto:', texto.substring(0, 80));

    // Criar objeto de mensagem fake para o parser
    const msgFake = {
      message_id: Date.now(),
      date: Math.floor(Date.now() / 1000),
      text: texto,
      from: { username: remetente || 'webhook', is_bot: true }
    };

    const { processarMensagem } = require('./parser');
    const resultado = processarMensagem(msgFake);

    if (!resultado) {
      console.log('[Webhook] ⚠️ Mensagem não reconhecida');
      return res.status(400).json({
        sucesso: false,
        erro: 'Mensagem não reconhecida. Deve começar com "COP REDE INFORMA" ou "🚨 Novo Evento Detectado!"'
      });
    }

    console.log('[Webhook] ✅ Tipo:', resultado.tipo);

    if (resultado.tipo === 'COP_REDE_INFORMA') {
      await storage.adicionarCopRedeInforma(resultado.dados);
      console.log('[Webhook] 💾 COP REDE INFORMA salvo!');
    } else if (resultado.tipo === 'NOVO_EVENTO') {
      await storage.adicionarAlerta(resultado.dados);
      console.log('[Webhook] 💾 Alerta salvo!');
    }

    console.log('[Webhook] =====================================');

    res.json({
      sucesso: true,
      tipo: resultado.tipo,
      mensagem: 'Mensagem processada com sucesso'
    });

  } catch (error) {
    console.error('[Webhook] Erro:', error.message);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// ROTAS COP REDE INFORMA
// ============================================

/**
 * Listar mensagens COP REDE INFORMA
 * Query params: dataInicio, dataFim, areaPainel, grupo, responsavel, tipo, refresh
 */
app.get('/api/cop-rede-informa', async (req, res) => {
  try {
    const filtros = {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      areaPainel: req.query.areaPainel,
      grupo: req.query.grupo,
      responsavel: req.query.responsavel,
      tipo: req.query.tipo
    };

    // Remover filtros vazios
    Object.keys(filtros).forEach(key => {
      if (!filtros[key]) delete filtros[key];
    });

    // Forçar atualização do cache se refresh=true
    const forcarAtualizacao = req.query.refresh === 'true';

    const mensagens = await storage.obterCopRedeInforma(filtros, forcarAtualizacao);

    res.json({
      sucesso: true,
      total: mensagens.length,
      dados: mensagens,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Erro ao listar COP REDE INFORMA:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Obter uma mensagem COP REDE INFORMA por ID
 */
app.get('/api/cop-rede-informa/:id', async (req, res) => {
  try {
    const mensagens = await storage.obterCopRedeInforma({});
    const mensagem = mensagens.find(m => m.id === req.params.id);

    if (!mensagem) {
      return res.status(404).json({ sucesso: false, erro: 'Mensagem não encontrada' });
    }

    res.json({ sucesso: true, dados: mensagem });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Resumo por área (volume por área no período)
 */
app.get('/api/cop-rede-informa/resumo/areas', async (req, res) => {
  try {
    const filtros = {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim
    };

    const mensagens = await storage.obterCopRedeInforma(filtros);

    // Agrupar por área
    const resumo = {};
    mensagens.forEach(m => {
      if (!resumo[m.areaPainel]) {
        resumo[m.areaPainel] = {
          area: m.areaPainel,
          quantidade: 0,
          volumeTotal: 0
        };
      }
      resumo[m.areaPainel].quantidade++;
      resumo[m.areaPainel].volumeTotal += m.volume || 1;
    });

    res.json({
      sucesso: true,
      dados: Object.values(resumo)
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// ROTAS DE ALERTAS
// ============================================

/**
 * Listar alertas
 * Query params: dataInicio, dataFim, areaPainel, statusAlerta, grupo
 */
app.get('/api/alertas', async (req, res) => {
  try {
    const filtros = {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      areaPainel: req.query.areaPainel,
      statusAlerta: req.query.statusAlerta,
      grupo: req.query.grupo
    };

    // Remover filtros vazios
    Object.keys(filtros).forEach(key => {
      if (!filtros[key]) delete filtros[key];
    });

    const alertas = await storage.obterAlertas(filtros);

    res.json({
      sucesso: true,
      total: alertas.length,
      dados: alertas
    });
  } catch (error) {
    console.error('[API] Erro ao listar alertas:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Obter um alerta por ID
 */
app.get('/api/alertas/:id', async (req, res) => {
  try {
    const alertas = await storage.obterAlertas({});
    const alerta = alertas.find(a => a.id === req.params.id);

    if (!alerta) {
      return res.status(404).json({ sucesso: false, erro: 'Alerta não encontrado' });
    }

    res.json({ sucesso: true, dados: alerta });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Atualizar status de um alerta
 */
app.put('/api/alertas/:id/status', async (req, res) => {
  try {
    const { status } = req.body;

    if (!['novo', 'em_analise', 'tratado'].includes(status)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Status inválido. Use: novo, em_analise ou tratado'
      });
    }

    const sucesso = await storage.atualizarStatusAlerta(req.params.id, status);

    if (!sucesso) {
      return res.status(404).json({ sucesso: false, erro: 'Alerta não encontrado' });
    }

    res.json({ sucesso: true, mensagem: 'Status atualizado' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Excluir um alerta
 */
app.delete('/api/alertas/:id', async (req, res) => {
  try {
    const sucesso = await storage.excluirAlerta(req.params.id);

    if (!sucesso) {
      return res.status(404).json({ sucesso: false, erro: 'Alerta não encontrado' });
    }

    res.json({ sucesso: true, mensagem: 'Alerta excluído com sucesso' });
  } catch (error) {
    console.error('[API] Erro ao excluir alerta:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Excluir todos os alertas
 */
app.delete('/api/alertas/todos', async (req, res) => {
  try {
    const sucesso = await storage.excluirTodosAlertas();
    res.json({ sucesso: true, mensagem: 'Todos os alertas foram excluídos' });
  } catch (error) {
    console.error('[API] Erro ao excluir todos os alertas:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Resumo de alertas por status
 */
app.get('/api/alertas/resumo/status', async (req, res) => {
  try {
    const alertas = await storage.obterAlertas({});

    const resumo = {
      novo: alertas.filter(a => a.statusAlerta === 'novo').length,
      em_analise: alertas.filter(a => a.statusAlerta === 'em_analise').length,
      tratado: alertas.filter(a => a.statusAlerta === 'tratado').length,
      total: alertas.length
    };

    res.json({ sucesso: true, dados: resumo });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// ROTA DE CONFIGURAÇÃO
// ============================================

/**
 * Configurar Bin ID do WhatsApp (para persistência)
 */
app.post('/api/config/bin-id', async (req, res) => {
  try {
    const { binId } = req.body;

    if (!binId) {
      return res.status(400).json({ sucesso: false, erro: 'binId é obrigatório' });
    }

    storage.setBinId(binId);

    res.json({ sucesso: true, mensagem: 'Bin ID configurado' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Criar novo bin para armazenamento
 */
app.post('/api/config/criar-bin', async (req, res) => {
  try {
    const binId = await storage.criarBin();
    res.json({ sucesso: true, binId });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Limpar cache do backend
 * Usado ao fazer login para garantir dados frescos
 */
app.post('/api/cache/limpar', async (req, res) => {
  try {
    storage.limparCache();
    res.json({ sucesso: true, mensagem: 'Cache limpo com sucesso' });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================

app.listen(SERVER_CONFIG.PORT, async () => {
  console.log('============================================');
  console.log('   COP REDE INFORMA - Backend');
  console.log('============================================');
  console.log(`Servidor rodando na porta ${SERVER_CONFIG.PORT}`);
  console.log(`CORS permitido: ${SERVER_CONFIG.CORS_ORIGIN}`);
  console.log('');

  // WhatsApp (Evolution API) - ÚNICA FONTE DE DADOS
  if (EVOLUTION_CONFIG.API_KEY && EVOLUTION_CONFIG.INSTANCE_NAME) {
    console.log('📱 Verificando WhatsApp (Evolution API)...');
    console.log(`   Instância: ${EVOLUTION_CONFIG.INSTANCE_NAME}`);
    console.log(`   SOURCE_CHAT_ID: ${EVOLUTION_CONFIG.SOURCE_CHAT_ID || 'NÃO CONFIGURADO'}`);
    try {
      const status = await whatsapp.verificarConexao();
      if (status.conectado) {
        console.log('✅ WhatsApp conectado!');
        console.log('');
        console.log('   Para receber mensagens em TEMPO REAL, configure o webhook:');
        console.log('   URL: https://seu-backend.railway.app/api/whatsapp/webhook');
        console.log('   Eventos: MESSAGES_UPSERT');
      } else {
        console.log('⚠️  WhatsApp não conectado:', status.estado || status.erro);
      }
    } catch (error) {
      console.log('⚠️  Erro ao verificar WhatsApp:', error.message);
    }
  } else {
    console.log('❌ WhatsApp não configurado!');
    console.log('   Configure as variáveis:');
    console.log('   - EVOLUTION_API_URL');
    console.log('   - EVOLUTION_API_KEY');
    console.log('   - EVOLUTION_INSTANCE_NAME');
    console.log('   - EVOLUTION_SOURCE_CHAT_ID');
  }

  console.log('');
  console.log('Endpoints disponíveis:');
  console.log('  GET  /health');
  console.log('  GET  /api/estatisticas');
  console.log('');
  console.log('  WhatsApp (Evolution API):');
  console.log('  GET  /api/whatsapp/status');
  console.log('  GET  /api/whatsapp/chats');
  console.log('  POST /api/whatsapp/sincronizar');
  console.log('  POST /api/whatsapp/webhook');
  console.log('');
  console.log('  Dados:');
  console.log('  GET  /api/cop-rede-informa');
  console.log('  GET  /api/alertas');
  console.log('============================================');
});

module.exports = app;
