const mockSupabaseClient = {
  isConfigured: jest.fn(() => true),
  selectAll: jest.fn(),
  upsert: jest.fn(),
  request: jest.fn(),
  rpc: jest.fn()
};

jest.mock('../supabase', () => ({ client: mockSupabaseClient }));

const storage = require('../storage');
const storageHub = require('../storageHub');

describe('Supabase operational storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseClient.isConfigured.mockReturnValue(true);
    storage.limparCache();
    storageHub.limparCache();
  });

  test('upserts one COP message by channel and message id', async () => {
    mockSupabaseClient.upsert.mockResolvedValue([]);
    const message = {
      id: 'cop-1',
      messageId: 'wa-1',
      dataGeracao: '09/08/2026 01:30',
      areaPainel: 'RIO',
      volume: 7
    };

    await storage.adicionarCopRedeInforma(message);

    expect(mockSupabaseClient.upsert).toHaveBeenCalledWith(
      'operational_messages',
      [expect.objectContaining({
        channel: 'cop_rede_informa',
        message_id: 'wa-1',
        area_panel: 'RIO',
        volume: 7,
        payload: message
      })],
      'channel,message_id'
    );
  });

  test('loads normalized rows without changing the frontend payload contract', async () => {
    mockSupabaseClient.selectAll.mockImplementation(async table => {
      if (table === 'operational_messages') {
        return [{
          channel: 'cop_rede_informa',
          message_id: 'wa-2',
          record_id: 'cop-2',
          payload: { areaPainel: 'MG/ES/BA', dataGeracao: '09/08/2026 02:00' }
        }];
      }
      return [{
        alert_id: 'alert-1',
        message_id: 'wa-alert-1',
        status: 'em_analise',
        updated_at: '2026-08-09T05:00:00.000Z',
        payload: { grupoOriginal: 'Grupo' }
      }];
    });

    const data = await storage.carregarDados(true);

    expect(data.copRedeInforma[0]).toMatchObject({ id: 'cop-2', messageId: 'wa-2', areaPainel: 'MG/ES/BA' });
    expect(data.alertas[0]).toMatchObject({ id: 'alert-1', statusAlerta: 'em_analise' });
  });

  test('batch-upserts HUB allocations instead of overwriting a document', async () => {
    mockSupabaseClient.upsert.mockResolvedValue([]);
    const allocations = [{
      id: 'hub-1',
      messageId: 'hub-message-1',
      tipoAlocacao: 'MADRUGADA',
      data: '09/08/2026',
      dataRecebimento: '2026-08-09T03:00:00.000Z'
    }];

    const count = await storageHub.adicionarAlocacoesBatch(allocations);

    expect(count).toBe(1);
    expect(mockSupabaseClient.upsert).toHaveBeenCalledWith(
      'hub_allocations',
      [expect.objectContaining({
        message_id: 'hub-message-1',
        allocation_type: 'MADRUGADA',
        allocation_date: '2026-08-09'
      })],
      'message_id'
    );
  });
});
