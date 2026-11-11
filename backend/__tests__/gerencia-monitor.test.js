const bcrypt = require('bcryptjs');

describe('monitor de gerencia - isolamento e janela', () => {
  let monitor;
  const groupId = '120363999999999999@g.us';
  const TOKEN = 'segredo-teste-gerencia-minimo-trinta-e-dois';

  function message(id, at, chat = groupId, content = 'Demanda da gerencia') {
    return { event: 'messages.upsert', data: {
      key: { remoteJid: chat, id, participant: '5511999999999@s.whatsapp.net' },
      messageTimestamp: Math.floor(at / 1000),
      pushName: 'Gerente',
      message: { conversation: content }
    } };
  }
  const receive = (id, at, chat, token = TOKEN) =>
    monitor.receiveWebhook(message(id, at, chat), token);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-22T01:00:00.000Z')); // 22:00 Brasilia
    process.env.GERENCIA_GROUP_CHAT_ID = groupId;
    process.env.GERENCIA_WEBHOOK_TOKEN = TOKEN;
    process.env.GERENCIA_CONTROL_PASSWORD_HASH = bcrypt.hashSync('SENHA-PRIVADA-FORTE', 4);
    jest.resetModules();
    monitor = require('../gerencia-monitor');
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.GERENCIA_GROUP_CHAT_ID;
    delete process.env.GERENCIA_WEBHOOK_TOKEN;
    delete process.env.GERENCIA_CONTROL_PASSWORD_HASH;
  });

  it('inicia desligado e nao recupera mensagens anteriores', () => {
    expect(monitor.state().active).toBe(false);
    receive('m1', Date.now());
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(0);
    monitor.setEnabled(true);
    receive('m2', Date.now() - 60000);
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(0);
  });

  it('aceita exclusivamente o grupo alvo, sem duplicidade, e apaga ao desabilitar', () => {
    monitor.setEnabled(true);
    const now = Date.now();
    expect(receive('other', now, 'outro@g.us')).toBe(false);
    expect(receive('m1', now)).toBe(true);
    expect(receive('m1', now)).toBe(true);
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(1);
    monitor.setEnabled(false);
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(0);
  });

  it('ignora webhook sem token autenticado', () => {
    monitor.setEnabled(true);
    receive('forged', Date.now(), groupId, 'token-incorreto');
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(0);
    receive('legitimate', Date.now());
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(1);
  });

  it('desativa e limpa mensagens automaticamente as 07:00', () => {
    monitor.setEnabled(true);
    jest.setSystemTime(new Date('2026-10-22T09:59:58.000Z'));
    receive('valid', Date.now());
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(1);
    jest.setSystemTime(new Date('2026-10-22T10:00:00.000Z'));
    expect(monitor.state().active).toBe(false);
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(0);
    receive('late', Date.now());
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(0);
  });

  it('permite armar antes das 21h, sem divulgar mensagens diurnas', () => {
    jest.setSystemTime(new Date('2026-10-21T20:00:00.000Z'));
    monitor.setEnabled(true);
    receive('day', Date.now());
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(0);
    jest.setSystemTime(new Date('2026-10-22T00:00:00.000Z'));
    receive('night', Date.now());
    expect(monitor.state({ includeMessages: true }).messages).toHaveLength(1);
  });

  it('sem grupo ou token configurado, mantem monitor bloqueado', () => {
    delete process.env.GERENCIA_GROUP_CHAT_ID;
    jest.resetModules();
    const noGroup = require('../gerencia-monitor');
    expect(() => noGroup.setEnabled(true)).toThrow();
    expect(noGroup.state().active).toBe(false);
  });

  it('senha de controle e independente da senha administrativa', async () => {
    jest.useRealTimers();
    jest.resetModules();
    const monitorWithRealTimers = require('../gerencia-monitor');
    expect((await monitorWithRealTimers.authenticate('', '192.0.2.49')).ok).toBe(false);
    expect((await monitorWithRealTimers.authenticate('senha-administrativa', '192.0.2.50')).ok).toBe(false);
    expect((await monitorWithRealTimers.authenticate('SENHA-PRIVADA-FORTE', '192.0.2.50')).ok).toBe(true);
  });

  it('entrega mensagens temporarias ao supervisor administrativo', () => {
    monitor.setEnabled(true);
    receive('sigilosa', Date.now());

    const supervisor = monitor.clientState();
    expect(supervisor.active).toBe(true);
    expect(supervisor.messages).toHaveLength(1);
    expect(supervisor.messages[0].id).toBe('sigilosa');
  });
});
