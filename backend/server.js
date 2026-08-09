/**
 * Servidor Express para API do COP REDE INFORMA
 * Expõe endpoints REST para o frontend do painel ADM
 */

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { SERVER_CONFIG, EVOLUTION_CONFIG, ALOCACAO_HUB_CONFIG, COP_REDE_EMPRESARIAL_CONFIG } = require('./config');
const { client: supabase } = require('./supabase');
const storage = require('./storage');
const storageHub = require('./storageHub');
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
    // Buscar dados JÁ ORDENADOS pelo storage (usa a nova lógica de ordenação)
    const dados = await storage.obterCopRedeInforma({}, true);

    // Filtrar apenas mensagens com cluster (mesma lógica do frontend)
    const mensagensComCluster = dados.filter(d => d.resumo?.grupo && Object.keys(d.resumo.grupo).length > 0);

    // Analisar estrutura dos dados
    const diagnostico = {
      totalMensagens: dados.length,
      mensagensComResumoGrupo: mensagensComCluster.length,
      mensagensSemResumoGrupo: dados.length - mensagensComCluster.length,

      // A mensagem que DEVERIA ser exibida (primeira com cluster após ordenação)
      mensagemQueDeveSerExibida: mensagensComCluster.length > 0 ? {
        id: mensagensComCluster[0].id,
        messageId: mensagensComCluster[0].messageId,
        dataGeracao: mensagensComCluster[0].dataGeracao || 'NÃO TEM',
        dataRecebimento: mensagensComCluster[0].dataRecebimento,
        resumoGrupo: mensagensComCluster[0].resumo?.grupo || {},
        totalEventos: mensagensComCluster[0].totalEventos,
        primeiraLinha: mensagensComCluster[0].mensagemOriginal ? mensagensComCluster[0].mensagemOriginal.split('\n')[0].substring(0, 100) : null
      } : null,

      // Top 10 mensagens com cluster para debug (JÁ ORDENADAS)
      top10ComCluster: mensagensComCluster.slice(0, 10).map(d => ({
        id: d.id,
        messageId: d.messageId,
        dataGeracao: d.dataGeracao || 'NÃO TEM',
        dataRecebimento: d.dataRecebimento,
        clusters: d.resumo?.grupo ? Object.keys(d.resumo.grupo) : [],
        totalGrupo: d.resumo?.grupo ? Object.values(d.resumo.grupo).reduce((a, b) => a + b, 0) : 0,
        primeiraLinha: d.mensagemOriginal ? d.mensagemOriginal.split('\n')[0].substring(0, 80) : null
      })),

      // Top 5 mensagens SEM cluster (para ver se a mais recente está sendo filtrada)
      top5SemCluster: dados.filter(d => !d.resumo?.grupo || Object.keys(d.resumo.grupo).length === 0).slice(0, 5).map(d => ({
        id: d.id,
        messageId: d.messageId,
        dataGeracao: d.dataGeracao || 'NÃO TEM',
        dataRecebimento: d.dataRecebimento,
        origem: d.origem,
        primeiraLinha: d.mensagemOriginal ? d.mensagemOriginal.split('\n')[0].substring(0, 80) : null
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

/**
 * Reprocessar histórico completo com limite maior
 * Busca as últimas 500 mensagens para recuperar dados perdidos
 */
app.post('/api/diagnostico/reprocessar-completo', async (req, res) => {
  try {
    const limite = parseInt(req.body?.limite || 500);
    console.log(`[Diagnóstico] Reprocessamento completo com limite ${limite}...`);
    const resultado = await whatsapp.buscarHistorico(limite);
    res.json({
      sucesso: true,
      mensagem: `Histórico reprocessado (${limite} mensagens)`,
      resultado
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Status do polling e storage
 * Mostra timestamp atual, bin ID, estado da conexão
 */
app.get('/api/diagnostico/polling-status', async (req, res) => {
  try {
    const whatsappStatus = whatsapp.obterStatus();

    res.json({
      sucesso: true,
      polling: {
        ativo: whatsappStatus.pollingAtivo,
        lastMessageTimestamp: whatsappStatus.lastMessageTimestamp,
        lastMessageDate: whatsappStatus.lastMessageDate,
        intervalo: `${whatsappStatus.pollingIntervalo / 1000}s`
      },
      storage: {
        provedor: 'supabase',
        configurado: supabase.isConfigured()
      },
      whatsapp: {
        conectado: whatsappStatus.conectado,
        instancia: whatsappStatus.instancia,
        sourceChatId: whatsappStatus.sourceChatId
      }
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Resetar timestamp do polling para reprocessar mensagens antigas
 * Útil quando o timestamp ficou dessincronizado
 */
app.post('/api/diagnostico/resetar-polling', async (req, res) => {
  try {
    const diasAtras = parseInt(req.body?.diasAtras || 30);
    console.log(`[Diagnóstico] Resetando polling timestamp para ${diasAtras} dias atrás...`);

    const resultado = whatsapp.resetarPollingTimestamp(diasAtras);

    res.json({
      sucesso: true,
      mensagem: `Timestamp do polling resetado para ${diasAtras} dias atrás`,
      resultado
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Limpar mensagemOriginal dos registros persistidos
 * Mantido como ferramenta de minimização de dados legados
 */
app.post('/api/diagnostico/limpar-storage', async (req, res) => {
  try {
    console.log('[Diagnóstico] Limpando mensagemOriginal do storage...');
    const dados = await storage.carregarDados(true);

    let limpas = 0;
    dados.copRedeInforma = dados.copRedeInforma.map(m => {
      if (m.mensagemOriginal) {
        const { mensagemOriginal, ...resto } = m;
        limpas++;
        return resto;
      }
      return m;
    });

    await storage.salvarDados(dados);

    res.json({
      sucesso: true,
      mensagem: `mensagemOriginal removida de ${limpas} registros`,
      totalRegistros: dados.copRedeInforma.length
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
function obterCapacidades() {
  const whatsappStatus = whatsapp.obterStatus();
  const evolutionDisponivel = whatsappStatus.configurado && whatsappStatus.conectado;
  const persistenciaDisponivel = supabase.isConfigured();

  return {
    persistencia: {
      provedor: 'supabase',
      configurada: persistenciaDisponivel
    },
    evolutionApi: {
      habilitada: whatsappStatus.habilitado,
      configurada: whatsappStatus.configurado,
      conectada: whatsappStatus.conectado
    },
    funcionalidades: {
      escala: persistenciaDisponivel,
      matrizOfensores: true,
      volumeWhatsappTempoReal: evolutionDisponivel,
      alocacaoHubTempoReal: evolutionDisponivel,
      historicoHubPersistido: persistenciaDisponivel
    }
  };
}

function responderHealth(req, res) {
  const capacidades = obterCapacidades();
  const degradado = !capacidades.persistencia.configurada || !capacidades.evolutionApi.conectada;

  res.json({
    status: degradado ? 'degraded' : 'ok',
    timestamp: new Date().toISOString(),
    ambiente: process.env.NODE_ENV || 'development',
    capacidades
  });
}

app.get('/health', responderHealth);

// Alias para /api/health
app.get('/api/health', responderHealth);

app.get('/api/capacidades', (req, res) => {
  res.json({
    sucesso: true,
    ...obterCapacidades(),
    timestamp: new Date().toISOString()
  });
});

const SCALE_CACHE_PATH = path.join(__dirname, 'data', 'escala-cache.json');

function salvarEscalaEmCache(dados) {
  fs.mkdirSync(path.dirname(SCALE_CACHE_PATH), { recursive: true });
  fs.writeFileSync(SCALE_CACHE_PATH, JSON.stringify({
    storageId: 'supabase',
    dados,
    atualizadoEm: new Date().toISOString()
  }, null, 2));
}

function carregarEscalaDoCache() {
  if (!fs.existsSync(SCALE_CACHE_PATH)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(SCALE_CACHE_PATH, 'utf8'));
}

app.get('/api/escala', async (req, res) => {
  try {
    const dados = await supabase.rpc('get_schedule_document');
    res.json({
      sucesso: true,
      binId: 'supabase',
      origem: 'supabase',
      dados
    });
  } catch (error) {
    console.error('[API Escala] Erro ao carregar:', error.message);
    const cache = carregarEscalaDoCache();
    if (cache?.dados) {
      return res.json({
        sucesso: true,
        binId: 'supabase',
        origem: 'backend-cache',
        aviso: 'Supabase indisponível; usando cache de leitura do backend',
        dados: cache.dados,
        atualizadoEm: cache.atualizadoEm
      });
    }

    res.status(error.status || 500).json({
      sucesso: false,
      erro: error.message,
      detalhes: error.details || null
    });
  }
});

app.put('/api/escala', async (req, res) => {
  try {
    const dados = req.body?.dados;

    if (!dados || typeof dados !== 'object') {
      return res.status(400).json({ sucesso: false, erro: 'dados é obrigatório' });
    }

    const metadata = await supabase.rpc('replace_schedule_document', { p_document: dados });
    salvarEscalaEmCache(dados);
    res.json({
      sucesso: true,
      binId: 'supabase',
      origem: 'supabase',
      metadata
    });
  } catch (error) {
    console.error('[API Escala] Erro ao salvar:', error.message);
    if (req.body?.dados && typeof req.body.dados === 'object') {
      salvarEscalaEmCache(req.body.dados);
    }
    res.status(error.status || 503).json({
      sucesso: false,
      persistido: false,
      origem: 'backend-cache',
      aviso: 'Supabase indisponível; uma cópia de emergência ficou somente no backend OCI',
      erro: error.message,
      detalhes: error.details || null
    });
  }
});

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

/**
 * Iniciar polling automático de mensagens
 */
app.post('/api/whatsapp/polling/iniciar', async (req, res) => {
  try {
    whatsapp.iniciarPolling();
    res.json({
      sucesso: true,
      mensagem: 'Polling automático iniciado',
      status: whatsapp.obterStatus()
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Parar polling automático de mensagens
 */
app.post('/api/whatsapp/polling/parar', async (req, res) => {
  try {
    whatsapp.pararPolling();
    res.json({
      sucesso: true,
      mensagem: 'Polling automático parado',
      status: whatsapp.obterStatus()
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
    const { processarMensagemEmpresarial } = require('./parserEmpresarial');

    // Tentar parser principal (COP REDE INFORMA / Novo Evento)
    let resultado = processarMensagem(msgFake);

    if (resultado) {
      console.log('[Webhook] ✅ Tipo:', resultado.tipo);
      if (resultado.tipo === 'COP_REDE_INFORMA') {
        await storage.adicionarCopRedeInforma(resultado.dados);
        console.log('[Webhook] 💾 COP REDE INFORMA salvo!');
      } else if (resultado.tipo === 'NOVO_EVENTO') {
        await storage.adicionarAlerta(resultado.dados);
        console.log('[Webhook] 💾 Alerta salvo!');
      }
    } else {
      // Tentar parser empresarial (COP REDE EMPRESARIAL — Rio/ES e Leste)
      const resultadoEmp = processarMensagemEmpresarial(msgFake);
      if (resultadoEmp && resultadoEmp.tipo === 'COP_REDE_INFORMA') {
        await storage.adicionarCopRedeEmpresarial(resultadoEmp.dados);
        console.log('[Webhook] 💾 COP REDE EMPRESARIAL salvo!');
        console.log('[Webhook] =====================================');
        return res.json({ sucesso: true, tipo: 'COP_REDE_EMPRESARIAL', mensagem: 'Mensagem empresarial processada com sucesso' });
      }
      console.log('[Webhook] ⚠️ Mensagem não reconhecida');
      return res.status(400).json({
        sucesso: false,
        erro: 'Mensagem não reconhecida. Deve começar com "COP REDE INFORMA", "💎 COP REDE INF:" ou "🚨 Novo Evento Detectado!"'
      });
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
// ROTAS COP REDE EMPRESARIAL (Rio/ES e Leste)
// ============================================

/**
 * Listar mensagens COP REDE EMPRESARIAL
 */
app.get('/api/cop-rede-empresarial', async (req, res) => {
  try {
    const filtros = {
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim
    };
    Object.keys(filtros).forEach(key => { if (!filtros[key]) delete filtros[key]; });
    const forcarAtualizacao = req.query.refresh === 'true';
    const mensagens = await storage.obterCopRedeEmpresarial(filtros, forcarAtualizacao);
    res.json({ sucesso: true, total: mensagens.length, dados: mensagens, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('[API] Erro ao listar COP REDE EMPRESARIAL:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Sincronizar histórico COP REDE EMPRESARIAL manualmente
 */
app.post('/api/cop-rede-empresarial/sincronizar', async (req, res) => {
  try {
    const limite = req.body.limite || 100;
    const resultado = await whatsapp.buscarHistoricoEmpresarial(limite);
    res.json({ sucesso: !resultado.erro, ...resultado });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// MATRIZ EMPRESARIAL SIR — Clusters Rio
// ============================================

// Tipos de RAL aceitos (os demais são descartados)
const TIPOS_SIR_EMPRESARIAL = new Set(['ACESSO CLIENTE', 'BACKBONE', 'COLETOR', 'FOTÔNICA', 'REC']);
// Clusters reais do portal Embratel SIR (valores do campo "cluster" no dashboard.json)
const CLUSTERS_SIR_EMP = new Set([
  'RIO DE JANEIRO', 'ESPIRITO SANTO',
  'NORTE', 'MINAS GERAIS', 'CENTRO OESTE', 'NORDESTE', 'BAHIA/SERGIPE'
]);
// Ordem de exibição dos clusters
const CLUSTERS_SIR_ORDER = [
  'RIO DE JANEIRO', 'ESPIRITO SANTO',
  'MINAS GERAIS', 'NORTE', 'CENTRO OESTE', 'NORDESTE', 'BAHIA/SERGIPE'
];

// Ordem de exibição das subdivisões do Rio (campo "cidade" no dashboard.json)
const RIO_SUBDIVISAO_ORDER = [
  'RIO DE JANEIRO', 'BAIXADA', 'METROPOLITANA',
  'NORTE 1', 'NORTE 2', 'NORTE 3', 'NORTE FLUMINENSE',
  'CENTRO SUL', 'SERRA', 'SUL FLUMINENSE', 'DESPACHO (DP)'
];

/**
 * GET /api/matriz-empresarial
 * Busca o dashboard.json do portal Embratel SIR e retorna
 * totais de RAL (filtrado por tipo) + REC agrupados por cluster.
 * Para RIO DE JANEIRO inclui subdivisão por campo "cidade".
 */
app.get('/api/matriz-empresarial', async (req, res) => {
  try {
    const url = `https://cpralonrj-pralon.github.io/embratel-sir/data/dashboard.json?t=${Date.now()}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; dashboard-bot/1.0)',
        'Accept': 'application/json, */*'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ao buscar dashboard SIR`);
    const data = await response.json();

    // Inicializar porCluster com zeros
    const porCluster = {};
    for (const c of CLUSTERS_SIR_ORDER) {
      porCluster[c] = { ral: 0, rec: 0, total: 0, porTipo: {}, subclusters: {} };
    }

    // RAL items — filtrar por tipo
    for (const item of (data.RAL?.items || [])) {
      if (!CLUSTERS_SIR_EMP.has(item.cluster)) continue;
      if (!TIPOS_SIR_EMPRESARIAL.has(item.ralType)) continue;
      porCluster[item.cluster].ral++;
      porCluster[item.cluster].total++;
      const t = item.ralType;
      porCluster[item.cluster].porTipo[t] = (porCluster[item.cluster].porTipo[t] || 0) + 1;

      // Para Rio: agrupar também por subdivisão (campo cidade)
      if (item.cluster === 'RIO DE JANEIRO' && item.cidade) {
        const sub = porCluster['RIO DE JANEIRO'].subclusters;
        if (!sub[item.cidade]) sub[item.cidade] = { ral: 0, rec: 0, total: 0, porTipo: {} };
        sub[item.cidade].ral++;
        sub[item.cidade].total++;
        sub[item.cidade].porTipo[t] = (sub[item.cidade].porTipo[t] || 0) + 1;
      }
    }

    // REC items — todos os clusters (sem filtro de tipo)
    for (const item of (data.REC?.items || [])) {
      if (!CLUSTERS_SIR_EMP.has(item.cluster)) continue;
      porCluster[item.cluster].rec++;
      porCluster[item.cluster].total++;
      porCluster[item.cluster].porTipo['REC'] = (porCluster[item.cluster].porTipo['REC'] || 0) + 1;

      if (item.cluster === 'RIO DE JANEIRO' && item.cidade) {
        const sub = porCluster['RIO DE JANEIRO'].subclusters;
        if (!sub[item.cidade]) sub[item.cidade] = { ral: 0, rec: 0, total: 0, porTipo: {} };
        sub[item.cidade].rec++;
        sub[item.cidade].total++;
        sub[item.cidade].porTipo['REC'] = (sub[item.cidade].porTipo['REC'] || 0) + 1;
      }
    }

    // Totais calculados a partir dos dados já filtrados (apenas tipos aceitos)
    const totalRalFiltrado = Object.values(porCluster).reduce((sum, c) => sum + c.ral, 0);
    const totalRecFiltrado = Object.values(porCluster).reduce((sum, c) => sum + c.rec, 0);

    res.json({
      sucesso: true,
      updatedAt: data.updatedAt || null,
      totalRal: totalRalFiltrado,
      totalRec: totalRecFiltrado,
      porCluster,
      clusterOrder: CLUSTERS_SIR_ORDER,
      rioSubdivisaoOrder: RIO_SUBDIVISAO_ORDER,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Erro ao buscar Matriz Empresarial SIR:', error.message);
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
// ROTAS DE ALOCAÇÃO DE HUB
// ============================================

/**
 * Obter última alocação de HUB
 * Retorna apenas a mensagem mais recente
 */
app.get('/api/alocacao-hub/ultima', async (req, res) => {
  try {
    const alocacao = await storageHub.obterUltimaAlocacao();
    res.json({
      sucesso: true,
      dados: alocacao,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Erro ao obter última alocação:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Listar todas as alocações de HUB
 * Query params: tipo (DIURNO/MADRUGADA), data
 */
app.get('/api/alocacao-hub', async (req, res) => {
  try {
    const filtros = {
      tipo: req.query.tipo,
      data: req.query.data
    };

    // Remover filtros vazios
    Object.keys(filtros).forEach(key => {
      if (!filtros[key]) delete filtros[key];
    });

    const alocacoes = await storageHub.obterAlocacoes(filtros);

    res.json({
      sucesso: true,
      total: alocacoes.length,
      dados: alocacoes,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Erro ao listar alocações:', error);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Sincronizar alocações de HUB manualmente
 */
app.post('/api/alocacao-hub/sincronizar', async (req, res) => {
  const statusEvolution = whatsapp.obterStatus();
  if (!statusEvolution.configurado) {
    return res.status(503).json({
      sucesso: false,
      codigo: 'EVOLUTION_API_INDISPONIVEL',
      erro: 'Sincronizacao do HUB indisponivel ate a migracao da Evolution API'
    });
  }

  try {
    const limite = req.body.limite || 50;
    const resultado = await whatsapp.buscarHistoricoHub(limite);
    res.json({
      sucesso: !resultado.erro,
      ...resultado
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Estatísticas de alocação de HUB
 */
app.get('/api/alocacao-hub/estatisticas', async (req, res) => {
  try {
    const stats = await storageHub.obterEstatisticas();
    res.json({
      sucesso: true,
      dados: stats
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Diagnóstico de alocação de HUB
 * Retorna informações sobre a configuração e status
 */
app.get('/api/alocacao-hub/diagnostico', async (req, res) => {
  try {
    const stats = await storageHub.obterEstatisticas();
    const whatsappStatus = whatsapp.obterStatus();

    res.json({
      sucesso: true,
      diagnostico: {
        config: {
          CHAT_ID: ALOCACAO_HUB_CONFIG.CHAT_ID || 'NÃO CONFIGURADO',
          STORAGE_PROVIDER: 'supabase',
          STORAGE_CONFIGURED: supabase.isConfigured()
        },
        whatsapp: {
          conectado: whatsappStatus.conectado,
          instancia: whatsappStatus.instancia,
          pollingAtivo: whatsappStatus.pollingAtivo
        },
        dados: {
          totalAlocacoes: stats.total,
          diurno: stats.diurno,
          madrugada: stats.madrugada,
          ultimaAtualizacao: stats.ultimaAtualizacao
        },
        instrucoes: {
          problema_comum: 'Se não estiver recebendo dados, verifique se o ALOCACAO_HUB_CHAT_ID está correto',
          como_obter_chat_id: 'Use GET /api/whatsapp/chats para listar todos os grupos disponíveis',
          como_sincronizar: 'Use POST /api/alocacao-hub/sincronizar para forçar uma sincronização'
        }
      }
    });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Preview das mensagens brutas do grupo HUB
 * Mostra estrutura e texto das primeiras mensagens para diagnóstico do parser
 */
app.get('/api/alocacao-hub/mensagens-bruto', async (req, res) => {
  try {
    const limite = parseInt(req.query.limite || '10');
    const mensagens = await whatsapp.buscarMensagensBrutas(limite);
    res.json({ sucesso: true, total: mensagens.length, mensagens });
  } catch (error) {
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Rota legada de configuração do antigo armazenamento
 */
app.post('/api/alocacao-hub/config/bin-id', async (req, res) => {
  res.status(410).json({
    sucesso: false,
    codigo: 'ARMAZENAMENTO_MIGRADO',
    erro: 'BIN_ID não é mais usado; configure SUPABASE_URL e SUPABASE_SECRET_KEY no backend.'
  });
});

/**
 * Rota legada de criação do antigo armazenamento
 */
app.post('/api/alocacao-hub/config/criar-bin', async (req, res) => {
  res.status(410).json({
    sucesso: false,
    codigo: 'ARMAZENAMENTO_MIGRADO',
    erro: 'A persistência do HUB agora usa tabelas do Supabase.'
  });
});

// ============================================
// ROTA DE CONFIGURAÇÃO
// ============================================

/**
 * Rota legada de configuração do antigo armazenamento
 */
app.post('/api/config/bin-id', async (req, res) => {
  res.status(410).json({
    sucesso: false,
    codigo: 'ARMAZENAMENTO_MIGRADO',
    erro: 'BIN_ID não é mais usado; configure o Supabase no backend.'
  });
});

/**
 * Rota legada de criação do antigo armazenamento
 */
app.post('/api/config/criar-bin', async (req, res) => {
  res.status(410).json({
    sucesso: false,
    codigo: 'ARMAZENAMENTO_MIGRADO',
    erro: 'A persistência operacional agora usa tabelas do Supabase.'
  });
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
// ROTA MATRIZ DE OFENSORES (Coprede / Supabase)
// ============================================

const SUPABASE_URL = 'https://wthzxrgifjtenaujhdbb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0aHp4cmdpZmp0ZW5hdWpoZGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkwMjYwODIsImV4cCI6MjA4NDYwMjA4Mn0.MGhDMxfbbKGc69Mut8M7ESmULS8d10VgeIu_vXcorpc';

const TOPOLOGIA_VALIDACAO_CACHE_PATH = path.join(__dirname, 'data', 'topologia-validacao-cache.json');
const TOPOLOGIA_VALIDACAO_CACHE_VERSION = 7;
const TOPOLOGIA_VALIDACAO_ORIGEM_MANUAL = 'admin-manual-v6';
const TOPOLOGIA_VALIDACAO_ORIGEM_HELPER = 'local-helper-v1';
const VISIUM_BASE_URL = process.env.VISIUM_BASE_URL || 'http://201.55.234.76/Consultas_/ConsultaInterfaceNode';
const VISIUM_TIMEOUT_MS = Number(process.env.VISIUM_TIMEOUT_MS || 25000);
const TOPOLOGIA_VALIDACAO_TTL_MS = 60 * 60 * 1000;

/**
 * Mapeamento de cidades brasileiras para cluster CopRede (backend).
 * Usado como fallback quando "regional" vem vazio do Supabase.
 */
const CIDADE_PARA_CLUSTER_BACKEND = {
  // NORTE
  manaus: 'Norte', belem: 'Norte', 'porto velho': 'Norte', 'boa vista': 'Norte',
  macapa: 'Norte', palmas: 'Norte', 'rio branco': 'Norte', santarem: 'Norte',
  maraba: 'Norte', castanhal: 'Norte', ananindeua: 'Norte', parauapebas: 'Norte',
  // NORDESTE
  fortaleza: 'Nordeste', recife: 'Nordeste', 'joao pessoa': 'Nordeste',
  maceio: 'Nordeste', teresina: 'Nordeste', natal: 'Nordeste', 'sao luis': 'Nordeste',
  'campina grande': 'Nordeste', caruaru: 'Nordeste', mossoro: 'Nordeste',
  caucaia: 'Nordeste', sobral: 'Nordeste', parnamirim: 'Nordeste',
  'juazeiro do norte': 'Nordeste',
  // BAHIA/SERGIPE
  salvador: 'Bahia', 'feira de santana': 'Bahia', 'vitoria da conquista': 'Bahia',
  ilheus: 'Bahia', itabuna: 'Bahia', aracaju: 'Bahia', camacari: 'Bahia',
  // CENTRO OESTE
  brasilia: 'Centro Oeste', goiania: 'Centro Oeste', 'campo grande': 'Centro Oeste',
  cuiaba: 'Centro Oeste', 'aparecida de goiania': 'Centro Oeste', anapolis: 'Centro Oeste',
  rondonopolis: 'Centro Oeste', dourados: 'Centro Oeste', taguatinga: 'Centro Oeste',
  // MG
  'belo horizonte': 'BH Capital', uberlandia: 'BH Capital', contagem: 'BH Capital',
  'juiz de fora': 'BH Capital', betim: 'BH Capital', 'montes claros': 'BH Capital',
  'ribeirao das neves': 'BH Capital', uberaba: 'BH Capital', ipatinga: 'BH Capital',
  // ES
  vitoria: 'Vitória', 'vila velha': 'Vitória', cariacica: 'Vitória',
  serra: 'Vitória', 'cachoeiro de itapemirim': 'Vitória', linhares: 'Vitória',
  // RIO
  'rio de janeiro': 'Rio Capital', niteroi: 'Rio Capital', petropolis: 'Rio Capital',
  'nova iguacu': 'Rio Capital', 'duque de caxias': 'Rio Capital',
  'campos dos goytacazes': 'Rio Capital', 'volta redonda': 'Rio Capital',
  macae: 'Rio Capital', 'sao goncalo': 'Rio Capital', 'belford roxo': 'Rio Capital',
};

function cidadeParaClusterBackend(cidade) {
  if (!cidade) return null;
  const c = cidade.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (CIDADE_PARA_CLUSTER_BACKEND[c]) return CIDADE_PARA_CLUSTER_BACKEND[c];
  for (const [key, val] of Object.entries(CIDADE_PARA_CLUSTER_BACKEND)) {
    if (c.startsWith(key)) return val;
  }
  return null;
}

/**
 * Mapeia o campo "regional" do Supabase para as áreas do painel.
 * Usa nm_cidade como fallback quando regional está vazio.
 * RIO | MG/ES/BA | CO/NO/NE | OUTRO
 */
function mapearRegionalParaArea(regional, nmCidade) {
  const fonte = (regional && regional.trim()) ? regional : (cidadeParaClusterBackend(nmCidade) || '');
  if (!fonte) return 'OUTRO';
  const r = fonte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (r.includes('rio') || r.includes('rj')) return 'RIO';
  if (r.includes('minas') || r.includes('mg') || r.includes('bh') || r.includes('belo horizonte') ||
      r.includes('espirito') || r.includes('vitoria') || r.includes('es') ||
      r.includes('bahia') || r.includes('ba') || r.includes('sergipe') || r.includes('se')) return 'MG/ES/BA';
  if (r.includes('norte') || r.includes('nordeste') || r.includes('centro') ||
      r.includes('co') || r.includes('ne') || r.includes('no') || r.includes('goias') ||
      r.includes('go') || r.includes('mato') || r.includes('para') || r.includes('am') ||
      r.includes('acre') || r.includes('rondonia') || r.includes('roraima') ||
      r.includes('amapa') || r.includes('tocantins') || r.includes('pernambuco') ||
      r.includes('ceara') || r.includes('piaui') || r.includes('maranhao') ||
      r.includes('manaus') || r.includes('belem') || r.includes('fortaleza') ||
      r.includes('recife') || r.includes('natal') || r.includes('teresina')) return 'CO/NO/NE';
  return 'OUTRO';
}

/**
 * Calcula duração em horas desde dh_inicio
 */
function calcularHoras(dhInicio) {
  if (!dhInicio) return 0;
  try {
    return (Date.now() - new Date(dhInicio).getTime()) / 3600000;
  } catch { return 0; }
}

// Normaliza\u00e7\u00e3o/parsing compartilhados com o helper local (backend/topologia.js)
const {
  normalizarTopologia: normalizarTopologiaBackend,
  pareceLogin: pareceLoginMonitor,
  extrairFormulario: extrairFormularioVisium,
  encontrarNomeCampo: encontrarNomeCampoVisium,
  extrairOpcoesSelect: extrairOpcoesSelectVisium,
  escolherOpcao: escolherOpcaoVisium,
  extrairActionFormulario,
  lerTabelaVisium,
  validarTopologias
} = require('./topologia');

function carregarCacheValidacaoTopologia() {
  try {
    if (!fs.existsSync(TOPOLOGIA_VALIDACAO_CACHE_PATH)) {
      return { resultados: {}, ultimaExecucao: null, erro: null, avisos: [] };
    }
    const cache = JSON.parse(fs.readFileSync(TOPOLOGIA_VALIDACAO_CACHE_PATH, 'utf8'));
    if (cache.versao !== TOPOLOGIA_VALIDACAO_CACHE_VERSION) {
      return { resultados: {}, ultimaExecucao: null, erro: null, avisos: [] };
    }
    return cache;
  } catch (error) {
    console.warn('[Topologia] Erro ao ler cache:', error.message);
    return { resultados: {}, ultimaExecucao: null, erro: null, avisos: [] };
  }
}

function salvarCacheValidacaoTopologia(cache) {
  fs.mkdirSync(path.dirname(TOPOLOGIA_VALIDACAO_CACHE_PATH), { recursive: true });
  fs.writeFileSync(TOPOLOGIA_VALIDACAO_CACHE_PATH, JSON.stringify(cache, null, 2));
}

function criarClienteVisium() {
  const cookies = new Map();

  function cookieHeader() {
    return Array.from(cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  function armazenarCookies(headers) {
    const setCookie = typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : (typeof headers.raw === 'function'
        ? (headers.raw()['set-cookie'] || [])
        : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []));
    for (const item of setCookie) {
      const partes = String(item || '').split(/,(?=\s*[^;,=\s]+=)/);
      for (const parte of partes) {
        const first = parte.split(';')[0].trim();
        const idx = first.indexOf('=');
        if (idx > 0) cookies.set(first.slice(0, idx), first.slice(idx + 1));
      }
    }
  }

  async function requisitar(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VISIUM_TIMEOUT_MS);
    try {
      const headers = {
        'User-Agent': 'coprede-visium-validator/1.0',
        ...(options.headers || {})
      };
      const cookie = cookieHeader();
      if (cookie) headers.Cookie = cookie;
      const response = await fetch(url, { ...options, headers, signal: controller.signal });
      armazenarCookies(response.headers);
      const text = await response.text();
      return { response, text };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`timeout ao acessar Visium (${VISIUM_TIMEOUT_MS}ms)`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { requisitar };
}

function montarUrlVisium(action) {
  if (!action) return VISIUM_BASE_URL;
  try {
    return new URL(action, VISIUM_BASE_URL).toString();
  } catch (_) {
    return VISIUM_BASE_URL;
  }
}

async function postarFormularioVisium(cliente, html, camposExtras) {
  const campos = { ...extrairFormularioVisium(html), ...(camposExtras || {}) };
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(campos)) body.append(key, value == null ? '' : String(value));
  return await cliente.requisitar(montarUrlVisium(extrairActionFormulario(html)), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: VISIUM_BASE_URL
    },
    body: body.toString()
  });
}

async function consultarVisiumNode(cidade, node) {
  const cliente = criarClienteVisium();
  const inicial = await cliente.requisitar(VISIUM_BASE_URL);
  if (!inicial.response.ok) throw new Error(`Visium HTTP ${inicial.response.status}`);
  if (pareceLoginMonitor(inicial.text)) throw new Error('Visium exigiu login/sessao');

  const campoCidade = encontrarNomeCampoVisium(inicial.text, 'ddlCidade');
  const campoNodeInicial = encontrarNomeCampoVisium(inicial.text, 'ddlNode');
  if (!campoCidade) throw new Error('campo de cidade do Visium nao encontrado');

  const cidadeOpt = escolherOpcaoVisium(extrairOpcoesSelectVisium(inicial.text, 'ddlCidade'), cidade);
  if (!cidadeOpt) throw new Error(`cidade nao encontrada no Visium: ${cidade}`);

  const cidadeResp = await postarFormularioVisium(cliente, inicial.text, {
    [campoCidade]: cidadeOpt.value,
    __EVENTTARGET: campoCidade,
    __EVENTARGUMENT: ''
  });
  if (!cidadeResp.response.ok) throw new Error(`Visium cidade HTTP ${cidadeResp.response.status}`);

  const campoNode = encontrarNomeCampoVisium(cidadeResp.text, 'ddlNode') || campoNodeInicial;
  const nodeOpt = escolherOpcaoVisium(extrairOpcoesSelectVisium(cidadeResp.text, 'ddlNode'), node);
  if (!campoNode || !nodeOpt) throw new Error(`node nao encontrado no dropdown do Visium: ${node}`);

  const campoConsultar = encontrarNomeCampoVisium(cidadeResp.text, 'btn_consultar') ||
    encontrarNomeCampoVisium(cidadeResp.text, 'consultar');
  const extras = {
    [campoCidade]: cidadeOpt.value,
    [campoNode]: nodeOpt.value,
    __EVENTTARGET: '',
    __EVENTARGUMENT: ''
  };
  if (campoConsultar) extras[campoConsultar] = 'Consultar';

  const consultaResp = await postarFormularioVisium(cliente, cidadeResp.text, extras);
  if (!consultaResp.response.ok) throw new Error(`Visium consulta HTTP ${consultaResp.response.status}`);
  const tabela = lerTabelaVisium(consultaResp.text);
  if (!tabela.found) throw new Error('tabela de resultado do Visium vazia ou nao encontrada');
  const allUp = tabela.subnodes.every((subnode) => subnode.up);
  return {
    cidade: cidadeOpt.text || cidade,
    node: nodeOpt.text || node,
    status: allUp ? 'up' : 'down',
    up: allUp,
    subnodes: tabela.subnodes,
    rows: tabela.rows,
    sourceUrl: VISIUM_BASE_URL
  };
}

async function validarTopologiasBackend(itens) {
  // Ciclo compartilhado com o helper local: mesmo filtro GPON e mesma
  // regra de status (qualquer node DOWN => down).
  return await validarTopologias(itens, {
    consultarNode: consultarVisiumNode,
    site: 'Visium',
    sitesConsultados: ['Visium Live']
  });
}

function salvarResultadosValidacaoTopologia(validacao) {
  const cacheAtual = carregarCacheValidacaoTopologia();
  const resultados = { ...(cacheAtual.resultados || {}) };
  const resultadosCiclo = validacao.resultados || validacao.resultadosCiclo || [];

  for (const resultado of resultadosCiclo) {
    if (!resultado?.topologia) continue;
    resultados[normalizarTopologiaBackend(resultado.topologia)] = resultado;
  }

  const cacheNovo = {
    versao: TOPOLOGIA_VALIDACAO_CACHE_VERSION,
    resultados,
    ultimaExecucao: validacao.testadoEm || validacao.ultimaExecucao || Date.now(),
    erro: validacao.ok === false ? validacao.erro : null,
    avisos: validacao.avisos || [],
    atualizadoEm: new Date().toISOString()
  };
  salvarCacheValidacaoTopologia(cacheNovo);

  return {
    sucesso: validacao.ok !== false,
    erro: cacheNovo.erro,
    resultados,
    resultadosCiclo,
    ultimaExecucao: cacheNovo.ultimaExecucao,
    avisos: cacheNovo.avisos,
    timestamp: cacheNovo.atualizadoEm
  };
}

app.get('/api/topologia-validacao/resultados', (req, res) => {
  const cache = carregarCacheValidacaoTopologia();
  res.json({
    sucesso: true,
    resultados: cache.resultados || {},
    ultimaExecucao: cache.ultimaExecucao || null,
    erro: cache.erro || null,
    avisos: cache.avisos || [],
    ttlMs: TOPOLOGIA_VALIDACAO_TTL_MS,
    timestamp: new Date().toISOString()
  });
});

app.post('/api/topologia-validacao/validar', async (req, res) => {
  try {
    if (req.body?.origem !== TOPOLOGIA_VALIDACAO_ORIGEM_MANUAL) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Validacao recusada: atualize a pagina e use o botao Testar incidentes.'
      });
    }

    const validacao = await validarTopologiasBackend(req.body?.itens || []);
    const resposta = salvarResultadosValidacaoTopologia(validacao);

    res.status(validacao.ok ? 200 : 503).json({
      ...resposta,
      sucesso: validacao.ok,
      falhaGlobalVisium: validacao.falhaGlobalVisium || null
    });
  } catch (error) {
    console.error('[Topologia] Erro ao validar:', error.message);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

app.post('/api/topologia-validacao/registrar', (req, res) => {
  try {
    if (req.body?.origem !== TOPOLOGIA_VALIDACAO_ORIGEM_HELPER) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Registro recusado: origem de helper local invalida.'
      });
    }

    const validacao = req.body?.validacao || {
      ok: true,
      resultados: req.body?.resultadosCiclo || req.body?.resultados || [],
      avisos: req.body?.avisos || [],
      testadoEm: req.body?.testadoEm || Date.now()
    };
    const resposta = salvarResultadosValidacaoTopologia(validacao);
    res.json(resposta);
  } catch (error) {
    console.error('[Topologia] Erro ao registrar resultado local:', error.message);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

/**
 * Buscar Matriz de Ofensores do portal Coprede (Supabase)
 * Retorna top 100 incidentes mais antigos, agrupados por área
 */
app.get('/api/matriz-ofensores', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    // Busca todos os campos de mapeamento geográfico: grupo e cluster são os campos
    // canônicos do portal de origem para identificar área (não usar só regional/cidade)
    // Filtrar fora apenas status tratada/treated (igual ao portal de origem que exclui encerrados)
    // Incidentes de quarentena continuam com status ativo, mas não devem entrar
    // na volumetria. O portal usa a tag "#QRT#" e também há registro legado com
    // a palavra "QUARENTENA"; o OR preserva resumos nulos.
    // "%23" é o caractere "#" codificado para não virar fragmento da URL.
    const url = `${SUPABASE_URL}/rest/v1/incidents?select=id_mostra,nm_tipo,nm_cidade,nm_status,topologia,dh_inicio,regional,grupo,cluster,ds_sumario&nm_status=not.in.(treated,tratada)&or=(ds_sumario.is.null,and(ds_sumario.not.ilike.*%23QRT%23*,ds_sumario.not.ilike.*QUARENTENA*))&order=dh_inicio.asc&limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Supabase ${response.status}: ${errText}`);
    }

    const ofensores = await response.json();

    // Agrupar por área e calcular estatísticas
    const areaMap = { 'RIO': [], 'MG/ES/BA': [], 'CO/NO/NE': [], 'OUTRO': [] };
    for (const inc of ofensores) {
      const area = mapearRegionalParaArea(inc.regional, inc.nm_cidade);
      areaMap[area].push(inc);
    }

    const porArea = Object.entries(areaMap).map(([area, incs]) => ({
      area,
      total: incs.length,
      criticos: incs.filter(i => calcularHoras(i.dh_inicio) > 24).length,
      entre12e24h: incs.filter(i => { const h = calcularHoras(i.dh_inicio); return h > 12 && h <= 24; }).length,
    }));

    res.json({
      sucesso: true,
      total: ofensores.length,
      ofensores,
      porArea,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[API] Erro ao buscar Matriz de Ofensores:', error.message);
    res.status(500).json({ sucesso: false, erro: error.message });
  }
});

// ============================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================

// Em producao OCI, o mesmo processo entrega o frontend e a API. Isso elimina
// a URL fixa do Railway e evita CORS/mixed-content entre dois dominios.
const publicDir = process.env.PUBLIC_DIR;
if (publicDir && fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, {
    etag: true,
    maxAge: process.env.NODE_ENV === 'production' ? '10m' : 0
  }));
  console.log(`[Static] Frontend servido de ${publicDir}`);
}

app.listen(SERVER_CONFIG.PORT, async () => {
  console.log('============================================');
  console.log('   COP REDE INFORMA - Backend');
  console.log('============================================');
  console.log(`Servidor rodando na porta ${SERVER_CONFIG.PORT}`);
  console.log(`CORS permitido: ${SERVER_CONFIG.CORS_ORIGIN}`);
  console.log(`Persistência Supabase: ${supabase.isConfigured() ? 'CONFIGURADA' : 'NÃO CONFIGURADA'}`);
  console.log('');

  // WhatsApp (Evolution API) - ÚNICA FONTE DE DADOS
  const evolutionConfigurada = Boolean(
    EVOLUTION_CONFIG.ENABLED &&
    EVOLUTION_CONFIG.API_URL &&
    EVOLUTION_CONFIG.API_KEY &&
    EVOLUTION_CONFIG.INSTANCE_NAME
  );

  if (evolutionConfigurada) {
    console.log('📱 Verificando WhatsApp (Evolution API)...');
    console.log(`   Instância: ${EVOLUTION_CONFIG.INSTANCE_NAME}`);
    console.log(`   SOURCE_CHAT_ID: ${EVOLUTION_CONFIG.SOURCE_CHAT_ID || 'NÃO CONFIGURADO'}`);
    try {
      const status = await whatsapp.verificarConexao();
      if (status.conectado) {
        console.log('✅ WhatsApp conectado!');
        console.log('');

        // Iniciar polling automático como fallback (funciona mesmo sem webhook)
        const pollingDisabled = process.env.WHATSAPP_POLLING_DISABLED === 'true';
        if (!pollingDisabled) {
          whatsapp.iniciarPolling();
          console.log('🔄 Polling automático ativado (fallback para webhook)');
        } else {
          console.log('⏸️  Polling desativado via WHATSAPP_POLLING_DISABLED=true');
        }

        console.log('');
        console.log('   Para receber mensagens via webhook (mais rápido):');
        console.log('   URL: https://seu-dominio.example/api/whatsapp/webhook');
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
    console.log('   - EVOLUTION_ENABLED=true');
    console.log('   - EVOLUTION_API_URL');
    console.log('   - EVOLUTION_API_KEY');
    console.log('   - EVOLUTION_INSTANCE_NAME');
    console.log('   - EVOLUTION_SOURCE_CHAT_ID');
  }

  // COP REDE EMPRESARIAL (Rio/ES e Leste)
  console.log('');
  console.log('🏢 COP REDE EMPRESARIAL (Rio/ES e Leste):');
  console.log(`   CHAT_ID: ${COP_REDE_EMPRESARIAL_CONFIG.CHAT_ID || 'NÃO CONFIGURADO'}`);

  // Alocação de HUB
  console.log('');
  console.log('📋 Alocação de HUB:');
  console.log(`   CHAT_ID: ${ALOCACAO_HUB_CONFIG.CHAT_ID}`);
  console.log(`   STORAGE: ${supabase.isConfigured() ? 'Supabase configurado' : 'Supabase não configurado'}`);

  // Carregar histórico de HUB automaticamente no startup
  if (evolutionConfigurada && supabase.isConfigured() && ALOCACAO_HUB_CONFIG.CHAT_ID) {
    try {
      console.log('   📥 Carregando histórico de alocações...');
      const resultadoHub = await whatsapp.buscarHistoricoHub(20);
      if (resultadoHub.alocacoes > 0) {
        console.log(`   ✅ ${resultadoHub.alocacoes} alocações carregadas do histórico`);
      } else if (resultadoHub.erro) {
        console.log(`   ⚠️  ${resultadoHub.erro}`);
      } else {
        console.log('   ℹ️  Nenhuma nova alocação no histórico');
      }
    } catch (hubError) {
      console.log(`   ⚠️  Erro ao carregar histórico HUB: ${hubError.message}`);
    }
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
  console.log('  POST /api/whatsapp/polling/iniciar');
  console.log('  POST /api/whatsapp/polling/parar');
  console.log('');
  console.log('  Dados COP REDE:');
  console.log('  GET  /api/cop-rede-informa');
  console.log('  GET  /api/alertas');
  console.log('  GET  /api/matriz-ofensores');
  console.log('  GET  /api/topologia-validacao/resultados');
  console.log('  POST /api/topologia-validacao/validar');
  console.log('');
  console.log('  Alocação de HUB:');
  console.log('  GET  /api/alocacao-hub/ultima');
  console.log('  GET  /api/alocacao-hub');
  console.log('  POST /api/alocacao-hub/sincronizar');
  console.log('============================================');
});

module.exports = app;
