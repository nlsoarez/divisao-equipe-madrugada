/* Aba restrita /admin. Nenhuma credencial ou mensagem guardada em localStorage. */
(function () {
  'use strict';
  let running = false, fetching = false, timer = null, soundEnabled = false, monitorActive = false;
  let audio = null, knownIds = new Set(), initialized = false;
  const $ = id => document.getElementById(id);

  async function request(path, init = {}) {
    const response = await fetch('/api/gerencia/' + path, {
      cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, ...init
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.erro || 'HTTP ' + response.status);
    return data;
  }

  function status(text, danger) {
    const el = $('gerenciaErro');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('text-danger', Boolean(danger));
    el.classList.toggle('text-muted', !danger);
  }

  function playAlert() {
    if (!soundEnabled || !audio) return;
    try {
      if (audio.state !== 'running') return;
      const now = audio.currentTime;
      [0, 0.20].forEach((offset) => {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 800;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.10, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.15);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.16);
      });
    } catch { /* Audio bloqueado pelo navegador. */ }
  }

  function renderMessages(messages) {
    const container = $('gerenciaMensagens');
    if (!container) return;
    container.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'text-muted p-3';
      empty.textContent = 'Nenhuma mensagem recebida nesta ativação.';
      container.appendChild(empty);
      return;
    }
    for (const message of messages) {
      const article = document.createElement('article');
      article.className = 'border rounded-3 p-3 mb-2 bg-white';
      const head = document.createElement('div');
      head.className = 'small text-muted mb-1';
      const formatted = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: '2-digit'
      }).format(new Date(message.sentAt));
      head.textContent = (message.sender || 'Participante') + ' • ' + formatted +
        (message.kind !== 'texto' ? ' • ' + message.kind : '');
      const body = document.createElement('div');
      body.style.whiteSpace = 'pre-wrap';
      body.style.overflowWrap = 'anywhere';
      body.textContent = message.text;
      article.append(head, body);
      container.appendChild(article);
    }
  }

  async function refresh() {
    if (!running || fetching) return;
    fetching = true;
    try {
      const data = await request('estado');
      const active = Boolean(data.active);
      const configured = Boolean(data.groupConfigured && data.passwordConfigured && data.webhookAuthConfigured);
      const messages = Array.isArray(data.messages) && active ? data.messages : [];
      monitorActive = active;
      const ids = new Set(messages.map(item => item.id));

      // A primeira consulta apenas estabelece o cursor: nunca toca mensagens antigas.
      if (initialized && active) {
        if (messages.some(item => !knownIds.has(item.id))) playAlert();
      }
      if (!active) initialized = false;
      else initialized = true;
      knownIds = ids;

      const badge = $('gerenciaEstado');
      if (badge) {
        badge.className = 'badge ' + (active ? 'bg-success' : 'bg-secondary');
        badge.textContent = active ? (data.inWindow ? 'MONITORANDO' : 'ARMADO • AGUARDANDO 21H') : 'DESLIGADO';
      }
      const detail = $('gerenciaDetalhe');
      if (detail) detail.textContent = !data.groupConfigured
        ? 'Aguardando o ID do grupo. Nenhuma mensagem é capturada.'
        : !data.passwordConfigured
          ? 'Aguardando a configuração da senha exclusiva no servidor.'
          : !data.webhookAuthConfigured
            ? 'Aguardando a autenticação segura do webhook Evolution.'
          : active ? 'Ativado manualmente. Encerramento automático: 07h (Brasília).'
            : 'Inativo. Nenhuma mensagem é armazenada.';
      const toggle = $('gerenciaAlternar');
      if (toggle) {
        toggle.disabled = !configured && !active;
        toggle.textContent = active ? 'Desabilitar monitoramento' : 'Habilitar monitoramento';
        toggle.className = 'btn ' + (active ? 'btn-outline-danger' : 'btn-danger');
      }
      renderMessages(messages);
      status('', false);
    } catch (error) {
      initialized = false;
      knownIds.clear();
      renderMessages([]);
      status('Monitor indisponível: ' + error.message, true);
    } finally { fetching = false; }
  }

  async function toggle() {
    const password = $('gerenciaSenha')?.value || '';
    if (!password) return status('Informe sua senha exclusiva.', true);
    try {
      await request('alternar', {
        method: 'POST', body: JSON.stringify({ enabled: !monitorActive, password })
      });
      initialized = false;
      knownIds.clear();
      await refresh();
    } catch (error) {
      status(error.message, true);
    } finally {
      if ($('gerenciaSenha')) $('gerenciaSenha').value = '';
    }
  }

  async function enableSound() {
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) throw new Error('Áudio não suportado no navegador.');
      if (!audio) audio = new AudioCtor();
      await audio.resume();
      if (audio.state !== 'running') throw new Error('Permita a reprodução de áudio no navegador.');
      soundEnabled = true;
      const button = $('gerenciaSom');
      if (button) button.textContent = 'Som ativado';
      playAlert();
    } catch (error) { status(error.message, true); }
  }

  function start() {
    if (running || !$('tabGerencia')) return;
    running = true;
    $('gerenciaSenha')?.addEventListener('keydown', e => { if (e.key === 'Enter') toggle(); });
    $('gerenciaAlternar')?.addEventListener('click', toggle);
    $('gerenciaSom')?.addEventListener('click', enableSound);
    refresh();
    timer = setInterval(refresh, 4000);
  }

  window.GerenciaMonitor = { start, refresh };
})();
