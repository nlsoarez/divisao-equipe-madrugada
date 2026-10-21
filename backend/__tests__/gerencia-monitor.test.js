const bcrypt = require('bcryptjs');

describe('monitor de gerencia - isolamento e janela', () => {
  let monitor;
  const groupId = '120363999999999999@g.us';

  function message(id, at, chat = groupId, text = 'Demanda da gerencia') {
    return { event: 'messages.upsert', data: {
      key: { remoteJid: chat, id, participant: '5511999999999@s.whatsapp.net' },
      messageTimestamp: Math.floor(at / 1000),
      pushName: 'Gerente', message: { conversation: text }
    } };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-22T01:00:00.000Z')); // 22:00 BRT
    process.env.GERENCIA_GROUP_CHAT_ID = groupId;
    process.env.GERENCIA_WEBHOOK_TOKEN = 'segredo-teste-gerencia-minimo-trinta-e-dois';
    process.env.GERENCIA_CONTROL_PASSWORD_HASH = bcrypt.hashSync('SENHA-PRIVADA-FORTE', 10);
    jest.resetModules();
    monitor = require('../gerencia-monitor');
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.GERENCIA_GROUP_CHAT_ID;
    delete process.env.GERENCIA_WEBHOOK_TOKEN;
    delete process.env.GERENCIA_CONTROL_PASSWORD_HASH;
  });

  it('inicia desligado e nao guarda mensagens anteriores', () => {
    expect(monitor.state().active).toBe(false);
    monitor.receiveWebhook(message('m1', Date.now(, 'segredo-teste-gerencia-minimo-trinta-e-dois'));
    expect(monitor.state().messages).toHaveLength(0);
    monitor.setEnabled(true);
    monitor.receiveWebhook(message('m2', Date.now() - 60000, 'segredo-teste-gerencia-minimo-trinta-e-dois');
    expect(monitor.state().messages).toHaveLength(0);
  });

  it('aceita apenas o grupo alvo, sem duplicidade, e apaga ao desabilitar', () => {
    monitor.setEnabled(true);
    const now = Date.now();
    expect(monitor.receiveWebhook(message('outro', now, 'outro@g.us', 'segredo-teste-gerencia-minimo-trinta-e-dois')).toBe(false);
    expect(monitor.receiveWebhook(message('m1', now, 'segredo-teste-gerencia-minimo-trinta-e-dois')).toBe(true);
    expect(monitor.receiveWebhook(message('m1', now, 'segredo-teste-gerencia-minimo-trinta-e-dois')).toBe(true);
    expect(monitor.state().messages).toHaveLength(1);
    monitor.setEnabled(false);
    expect(monitor.state().messages).toHaveLength(0);
  });

  it('recusa conteudo fora da janela e desativa automaticamente as 07:00', () => {
    monitor.setEnabled(true);
    jest.setSystemTime(new Date('2026-10-22T09:59:58.000Z')); // 06:59:58 BRT
    monitor.receiveWebhook(message('valid', Date.now(, 'segredo-teste-gerencia-minimo-trinta-e-dois'));
    expect(monitor.state().messages).toHaveLength(1);
    jest.setSystemTime(new Date('2026-10-22T10:00:00.000Z')); // 07:00 BRT
    expect(monitor.state().active).toBe(false);
    expect(monitor.state().messages).toHaveLength(0);
    monitor.receiveWebhook(message('late', Date.now(, 'segredo-teste-gerencia-minimo-trinta-e-dois'));
    expect(monitor.state().messages).toHaveLength(0);
  });

  it('permite armar antes das 21h, mas nao exibe mensagens desse intervalo', () => {
    jest.setSystemTime(new Date('2026-10-21T20:00:00.000Z')); // 17:00 BRT
    monitor.setEnabled(true);
    monitor.receiveWebhook(message('day', Date.now(, 'segredo-teste-gerencia-minimo-trinta-e-dois'));
    expect(monitor.state().messages).toHaveLength(0);
    jest.setSystemTime(new Date('2026-10-22T00:00:00.000Z')); // 21:00 BRT
    monitor.receiveWebhook(message('night', Date.now(, 'segredo-teste-gerencia-minimo-trinta-e-dois'));
    expect(monitor.state().messages).toHaveLength(1);
  });

  it('sem o ID ou senha de controle, permanece bloqueado', () => {
    delete process.env.GERENCIA_GROUP_CHAT_ID;
    jest.resetModules();
    const notConfigured = require('../gerencia-monitor');
    expect(() => notConfigured.setEnabled(true)).toThrow();
    expect(notConfigured.state().active).toBe(false);
  });

  it('senha de controle nao e intercambiavel com a senha administrativa', async () => {
    const wrong = await monitor.authenticate('senha-administrativa', '192.0.2.50');
    expect(wrong.ok).toBe(false);
    const right = await monitor.authenticate('SENHA-PRIVADA-FORTE', '192.0.2.50');
    expect(right.ok).toBe(true);
  });

  it('sessao exclusiva fica vinculada ao cookie administrativo original', () => {
    const secret = 'um-segredo-com-no-minimo-trinta-e-dois-caracteres';
    const token = monitor.controlToken('cookie-admin-1', secret);
    const req = {headers: {cookie: 'divisao_admin_session=cookie-admin-1; divisao_gerencia_control=' + token}};
    expect(monitor.validControl(req, secret, 'divisao_admin_session')).toBe(true);
    req.headers.cookie = 'divisao_admin_session=cookie-admin-2; divisao_gerencia_control=' + token;
    expect(monitor.validControl(req, secret, 'divisao_admin_session')).toBe(false);
  });
});
