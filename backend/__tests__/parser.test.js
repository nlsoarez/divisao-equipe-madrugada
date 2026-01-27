/**
 * Testes unitários para o parser de mensagens
 */

const {
  normalizar,
  identificarTipoMensagem,
  extrairCampo,
  extrairData,
  extrairVolume,
  mapearGrupoParaArea,
  parseCopRedeInforma,
  parseNovoEvento,
  processarMensagem
} = require('../parser');

describe('Parser - Funções auxiliares', () => {
  describe('normalizar()', () => {
    test('deve converter para lowercase', () => {
      expect(normalizar('TESTE')).toBe('teste');
    });

    test('deve remover acentos', () => {
      expect(normalizar('São Paulo')).toBe('sao paulo');
    });

    test('deve tratar string vazia', () => {
      expect(normalizar('')).toBe('');
    });

    test('deve tratar null', () => {
      expect(normalizar(null)).toBe('');
    });
  });

  describe('identificarTipoMensagem()', () => {
    test('deve identificar COP REDE INFORMA', () => {
      const texto = 'COP REDE INFORMA\nTIPO: Teste';
      expect(identificarTipoMensagem(texto)).toBe('COP_REDE_INFORMA');
    });

    test('deve identificar Novo Evento Detectado', () => {
      const texto = '🚨 Novo Evento Detectado!\nDetalhes aqui';
      expect(identificarTipoMensagem(texto)).toBe('NOVO_EVENTO');
    });

    test('deve retornar null para mensagem desconhecida', () => {
      const texto = 'Mensagem qualquer\nSem título conhecido';
      expect(identificarTipoMensagem(texto)).toBeNull();
    });

    test('deve retornar null para texto vazio', () => {
      expect(identificarTipoMensagem('')).toBeNull();
    });
  });

  describe('extrairCampo()', () => {
    test('deve extrair campo TIPO', () => {
      const texto = 'COP REDE INFORMA\nTIPO: Incidente\nGRUPO: Norte';
      expect(extrairCampo(texto, 'TIPO')).toBe('Incidente');
    });

    test('deve extrair campo GRUPO', () => {
      const texto = 'COP REDE INFORMA\nTIPO: Incidente\nGRUPO: Bahia / Sergipe';
      expect(extrairCampo(texto, 'GRUPO')).toBe('Bahia / Sergipe');
    });

    test('deve ser case-insensitive', () => {
      const texto = 'tipo: Incidente\ngrupo: Norte';
      expect(extrairCampo(texto, 'TIPO')).toBe('Incidente');
    });

    test('deve tratar espaços extras', () => {
      const texto = 'TIPO :   Incidente   ';
      expect(extrairCampo(texto, 'TIPO')).toBe('Incidente');
    });

    test('deve retornar null se campo não existir', () => {
      const texto = 'TIPO: Incidente';
      expect(extrairCampo(texto, 'VOLUME')).toBeNull();
    });
  });

  describe('extrairData()', () => {
    test('deve extrair data dd/mm/aaaa', () => {
      expect(extrairData('15/12/2024')).toBe('15/12/2024');
    });

    test('deve extrair data dd/mm e adicionar ano atual', () => {
      const resultado = extrairData('15/12');
      const anoAtual = new Date().getFullYear();
      expect(resultado).toBe(`15/12/${anoAtual}`);
    });

    test('deve padronizar dias e meses com um dígito', () => {
      const resultado = extrairData('5/6');
      const anoAtual = new Date().getFullYear();
      expect(resultado).toBe(`05/06/${anoAtual}`);
    });

    test('deve retornar null para formato inválido', () => {
      expect(extrairData('data inválida')).toBeNull();
    });
  });

  describe('extrairVolume()', () => {
    test('deve extrair número inteiro', () => {
      expect(extrairVolume('10')).toBe(10);
    });

    test('deve extrair número decimal com ponto', () => {
      expect(extrairVolume('10.5')).toBe(10.5);
    });

    test('deve extrair número decimal com vírgula', () => {
      expect(extrairVolume('10,5')).toBe(10.5);
    });

    test('deve ignorar caracteres não numéricos', () => {
      expect(extrairVolume('Volume: 25 unidades')).toBe(25);
    });

    test('deve retornar null para texto sem número', () => {
      expect(extrairVolume('sem número')).toBeNull();
    });
  });
});

describe('Parser - Mapeamento de Grupos', () => {
  describe('mapearGrupoParaArea()', () => {
    test('deve mapear Rio / Espírito Santo para RIO', () => {
      const resultado = mapearGrupoParaArea('Rio / Espírito Santo');
      expect(resultado.areaPainel).toBe('RIO');
      expect(resultado.status).toBe('sucesso');
    });

    test('deve mapear Bahia / Sergipe para MG/ES/BA', () => {
      const resultado = mapearGrupoParaArea('Bahia / Sergipe');
      expect(resultado.areaPainel).toBe('MG/ES/BA');
    });

    test('deve mapear Centro Oeste para CO/NO/NE', () => {
      const resultado = mapearGrupoParaArea('Centro Oeste');
      expect(resultado.areaPainel).toBe('CO/NO/NE');
    });

    test('deve mapear Norte para CO/NO/NE', () => {
      const resultado = mapearGrupoParaArea('Norte');
      expect(resultado.areaPainel).toBe('CO/NO/NE');
    });

    test('deve mapear Minas Gerais para MG/ES/BA', () => {
      const resultado = mapearGrupoParaArea('Minas Gerais');
      expect(resultado.areaPainel).toBe('MG/ES/BA');
    });

    test('deve mapear Nordeste para CO/NO/NE', () => {
      const resultado = mapearGrupoParaArea('Nordeste');
      expect(resultado.areaPainel).toBe('CO/NO/NE');
    });

    test('deve ser case-insensitive', () => {
      const resultado = mapearGrupoParaArea('MINAS GERAIS');
      expect(resultado.areaPainel).toBe('MG/ES/BA');
    });

    test('deve retornar GRUPO_DESCONHECIDO para grupo não mapeado', () => {
      const resultado = mapearGrupoParaArea('ZZZ Lugar Ficticio');
      expect(resultado.status).toBe('grupo_desconhecido');
      expect(resultado.areaPainel).toBeNull();
    });

    test('deve tratar null', () => {
      const resultado = mapearGrupoParaArea(null);
      expect(resultado.status).toBe('grupo_desconhecido');
    });
  });
});

describe('Parser - Parsing completo', () => {
  const dataMensagem = new Date('2024-12-15T10:30:00Z');
  const messageId = 12345;

  describe('parseCopRedeInforma()', () => {
    test('deve extrair mensagem formato novo com emojis e clusters', () => {
      const texto = `📢 COP REDE - INFORMA
🏷️ TIPO: OTG FIBRA HFC - GPON
🕒 Horário de envio: 24/01/2026 00:00:25
📊 Volume Total: 45
🏢 Totais por Cluster:
- Minas Gerais: 12
- Rio de Janeiro: 8`;

      const resultado = parseCopRedeInforma(texto, dataMensagem, messageId);

      expect(resultado).not.toBeNull();
      expect(resultado.origem).toBe('COP_REDE_INFORMA');
      expect(resultado.resumo).toBeDefined();
    });

    test('deve retornar objeto com campos esperados', () => {
      const texto = `📢 COP REDE - INFORMA
🏷️ TIPO: Incidente
📊 Volume Total: 5
🏢 Totais por Cluster:
- Bahia / Sergipe: 5`;

      const resultado = parseCopRedeInforma(texto, dataMensagem, messageId);

      expect(resultado.id).toBeDefined();
      expect(resultado.messageId).toBe(messageId);
      expect(resultado.dataRecebimento).toBeDefined();
      expect(resultado.mensagemOriginal).toBe(texto);
      expect(resultado.origem).toBe('COP_REDE_INFORMA');
    });
  });

  describe('parseNovoEvento()', () => {
    test('deve extrair campos de alerta com emojis', () => {
      const texto = `🚨 Novo Evento Detectado!
📡 Cluster: Norte
📅 Data: 15/12/2024
⚠️ Sintoma: Sistema fora do ar`;

      const resultado = parseNovoEvento(texto, dataMensagem, messageId);

      expect(resultado.grupo).toBe('Norte');
      expect(resultado.areaPainel).toBe('CO/NO/NE');
      expect(resultado.statusAlerta).toBe('novo');
      expect(resultado.origem).toBe('NOVO_EVENTO_DETECTADO');
    });

    test('deve retornar campos básicos do alerta', () => {
      const texto = `🚨 Novo Evento Detectado!
📡 Cluster: Minas Gerais`;

      const resultado = parseNovoEvento(texto, dataMensagem, messageId);

      expect(resultado.id).toBeDefined();
      expect(resultado.messageId).toBe(messageId);
      expect(resultado.statusAlerta).toBe('novo');
      expect(resultado.status).toBe('novo');
      expect(resultado.historicoStatus).toBeDefined();
    });
  });

  describe('processarMensagem()', () => {
    test('deve processar mensagem COP REDE INFORMA novo formato', () => {
      const message = {
        message_id: 123,
        text: '📢 COP REDE - INFORMA\n🏷️ TIPO: Teste\n🏢 Totais por Cluster:\n- Norte: 5',
        date: Math.floor(Date.now() / 1000)
      };

      const resultado = processarMensagem(message);

      expect(resultado).not.toBeNull();
      expect(resultado.tipo).toBe('COP_REDE_INFORMA');
      expect(resultado.dados).toBeDefined();
      expect(resultado.dados.origem).toBe('COP_REDE_INFORMA');
    });

    test('deve processar mensagem de alerta', () => {
      const message = {
        message_id: 124,
        text: '🚨 Novo Evento Detectado!\n📡 Cluster: Minas Gerais',
        date: Math.floor(Date.now() / 1000)
      };

      const resultado = processarMensagem(message);

      expect(resultado).not.toBeNull();
      expect(resultado.tipo).toBe('NOVO_EVENTO');
      expect(resultado.dados.areaPainel).toBe('MG/ES/BA');
    });

    test('deve retornar null para mensagem não relevante', () => {
      const message = {
        message_id: 125,
        text: 'Mensagem comum do grupo',
        date: Math.floor(Date.now() / 1000)
      };

      const resultado = processarMensagem(message);
      expect(resultado).toBeNull();
    });

    test('deve retornar null para mensagem sem texto', () => {
      const message = {
        message_id: 126,
        date: Math.floor(Date.now() / 1000)
      };

      const resultado = processarMensagem(message);
      expect(resultado).toBeNull();
    });
  });
});
