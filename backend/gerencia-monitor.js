'use strict';

// Monitoramento restrito ao turno: nunca consulta historico e nao persiste conteudo.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const TIMEZONE = 'America/Sao_Paulo';
const GROUP_ID = String(process.env.GERENCIA_GROUP_CHAT_ID || '').trim();
const PASSWORD_HASH = String(process.env.GERENCIA_CONTROL_PASSWORD_HASH || '').trim();
const WEBHOOK_TOKEN = String(process.env.GERENCIA_WEBHOOK_TOKEN || '').trim();
const COOKIE_NAME = 'divisao_gerencia_control';
const MAX_MESSAGES = 80;
const CONTROL_SESSION_MS = 15 * 60 * 1000;
const attempts = new Map();
let active = false;
let activatedAt = 0;
let expiresAt = 0;
let messages = [];
let identifiers = new Set();

function validPasswordHash() {
  return ['$2a$', '$2b$', '$2y$'].some(prefix => PASSWORD_HASH.startsWith(prefix)) && PASSWORD_HASH.length === 60;
}

function configured() {
  return Boolean(GROUP_ID && validPasswordHash() && WEBHOOK_TOKEN.length >= 32);
}

function parts(when = Date.now()) {
  const list = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(when));
  return Object.fromEntries(list.filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

function isNight(when = Date.now()) {
  const hour = parts(when).hour;
  return hour >= 21 || hour < 7;
}

function nextCutoff(when = Date.now()) {
  // Sao Paulo permanece UTC-03 em 2026; calculo do proximo encerramento as 07h locais.
  const p = parts(when);
  const dayDelta = p.hour >= 7 ? 1 : 0;
  return Date.UTC(p.year, p.month - 1, p.day + dayDelta, 10, 0, 0);
}

function deactivate() {
  active = false;
  activatedAt = 0;
  expiresAt = 0;
  messages = [];
  identifiers = new Set();
}

function validateState() {
  if (active && (!configured() || Date.now() >= expiresAt)) deactivate();
}

function setEnabled(enabled) {
  validateState();
  if (!enabled) { deactivate(); return state(); }
  if (!configured()) {
    const error = new Error('Grupo e senha exclusiva precisam ser configurados no servidor');
    error.status = 503;
    throw error;
  }
  if (!active) {
    active = true;
    activatedAt = Date.now();
    expiresAt = nextCutoff(activatedAt);
    messages = [];
    identifiers = new Set();
  }
  return state();
}

function state() {
  validateState();
  return {
    active, groupConfigured: Boolean(GROUP_ID),
    passwordConfigured: validPasswordHash(),
    webhookAuthConfigured: WEBHOOK_TOKEN.length >= 32,
    openedAt: active ? new Date(activatedAt).toISOString() : null,
    closesAt: active ? new Date(expiresAt).toISOString() : null,
    inWindow: isNight(), messages: active ? messages : []
  };
}

function timestamp(value) {
  if (value && typeof value === 'object') value = value.low ?? value.seconds ?? value.toNumber?.();
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? Math.floor(n * 1000) : Math.floor(n);
}

function validWebhookToken(provided) {
  if (WEBHOOK_TOKEN.length < 32 || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(WEBHOOK_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function receiveWebhook(body, providedToken) {
  const data = body?.data || body;
  const chatId = data?.key?.remoteJid || data?.remoteJid;
  if (!GROUP_ID || chatId !== GROUP_ID) return false;
  // Retorno true impede que mensagens sensiveis do grupo entrem em parsers e logs legados.
  validateState();
  if (!active || !isNight() || !validWebhookToken(providedToken)) return true;
  const sentAt = timestamp(data?.messageTimestamp ?? data?.timestamp ?? body?.messageTimestamp);
  // Nao recuperar nada anterior ao instante em que o coordenador habilitou.
  if (!sentAt || sentAt < activatedAt - 3000 || sentAt > Date.now() + 60000) return true;
  const id = String(data?.key?.id || '').trim();
  if (!id || identifiers.has(id)) return true;
  const msg = data?.message || {};
  const content = msg.conversation || msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption || msg.videoMessage?.caption ||
    data?.body || data?.text || '';
  const kind = msg.imageMessage ? 'imagem' : msg.videoMessage ? 'video' :
    msg.audioMessage ? 'audio' : msg.documentMessage ? 'documento' : 'texto';
  const text = String(content || (kind === 'texto' ? '[Mensagem sem texto]' : '[Midia recebida]')).slice(0, 5000);
  identifiers.add(id);
  messages.push({
    id, sentAt: new Date(sentAt).toISOString(),
    sender: String(data?.pushName || data?.key?.participant || 'Participante').slice(0, 100),
    kind, text
  });
  if (messages.length > MAX_MESSAGES) {
    const old = messages.shift();
    identifiers.delete(old.id);
  }
  return true;
}

function parseCookie(header, name = COOKIE_NAME) {
  const prefix = name + '=';
  return String(header || '').split(';').map(s => s.trim()).find(s => s.startsWith(prefix))?.slice(prefix.length) || '';
}

function signature(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function controlToken(adminCookie, secret) {
  const payload = Buffer.from(JSON.stringify({
    expires: Date.now() + CONTROL_SESSION_MS,
    adminBind: signature(adminCookie, secret),
    nonce: crypto.randomBytes(12).toString('hex')
  })).toString('base64url');
  return payload + '.' + signature(payload, secret + PASSWORD_HASH);
}

function validControl(req, secret, adminCookieName) {
  if (!configured() || !secret) return false;
  const token = parseCookie(req.headers.cookie);
  const adminCookie = parseCookie(req.headers.cookie, adminCookieName);
  if (!token || !adminCookie) return false;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return false;
  const expected = signature(payload, secret + PASSWORD_HASH);
  if (Buffer.byteLength(mac) !== Buffer.byteLength(expected) ||
      !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return value.expires > Date.now() &&
      value.adminBind === signature(adminCookie, secret);
  } catch { return false; }
}

function cookie(value, seconds) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; Path=/api/gerencia; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure}`;
}

async function authenticate(password, ip) {
  if (!validPasswordHash()) return { ok: false, status: 503, error: 'Senha exclusiva ainda nao configurada' };
  const key = String(ip || 'unknown');
  const item = attempts.get(key) || { count: 0, until: 0 };
  if (item.until > Date.now()) return { ok: false, status: 429, error: 'Muitas tentativas. Tente novamente mais tarde.' };
  const ok = typeof password === 'string' && password.length > 0 && password.length <= 256 &&
    await bcrypt.compare(password, PASSWORD_HASH);
  if (!ok) {
    item.count++;
    if (item.count >= 5) { item.count = 0; item.until = Date.now() + 60000; }
    attempts.set(key, item);
    return { ok: false, status: 401, error: 'Senha exclusiva incorreta' };
  }
  attempts.delete(key);
  return { ok: true };
}

module.exports = {
  state, setEnabled, receiveWebhook, validControl, controlToken,
  cookie, authenticate, parseCookie, CONTROL_SESSION_MS
};
