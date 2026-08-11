const { spawn } = require('child_process');
const path = require('path');
const bcrypt = require('bcryptjs');

const port = 3137;
const backendDir = path.resolve(__dirname, '..');
const publicDir = path.resolve(backendDir, '..');
const adminPassword = 'senha-teste-administrativa';

const server = spawn(process.execPath, ['server.js'], {
  cwd: backendDir,
  env: {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    PUBLIC_DIR: publicDir,
    EVOLUTION_ENABLED: 'false',
    WHATSAPP_POLLING_DISABLED: 'true',
    SUPABASE_URL: '',
    SUPABASE_SECRET_KEY: '',
    ADMIN_PASSWORD_HASH: bcrypt.hashSync(adminPassword, 4),
    ADMIN_SESSION_SECRET: 'segredo-de-sessao-para-smoke-test-oci-123456789'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
server.stdout.on('data', chunk => { output += chunk.toString(); });
server.stderr.on('data', chunk => { output += chunk.toString(); });

async function waitForHealth() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return response.json();
    } catch {
      // O processo ainda esta iniciando.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout aguardando health check.\n${output}`);
}

(async () => {
  try {
    const health = await waitForHealth();
    if (health.status !== 'degraded') {
      throw new Error(`Status esperado degraded, recebido ${health.status}`);
    }
    if (health.capacidades.funcionalidades.alocacaoHubTempoReal !== false) {
      throw new Error('HUB em tempo real deveria estar desativado sem Evolution API');
    }
    if (health.capacidades.funcionalidades.volumetriaPortal !== true) {
      throw new Error('Volumetria do portal deve permanecer ativa sem Evolution API');
    }
    if (health.capacidades.funcionalidades.ingestaoCopWhatsappTempoReal !== false) {
      throw new Error('Ingestao COP/WhatsApp deveria estar desativada sem Evolution API');
    }

    const page = await fetch(`http://127.0.0.1:${port}/`);
    const html = await page.text();
    if (!page.ok || !html.includes('<!DOCTYPE html>')) {
      throw new Error('Frontend estatico nao foi servido');
    }

    const adminPage = await fetch(`http://127.0.0.1:${port}/admin`);
    const adminHtml = await adminPage.text();
    if (!adminPage.ok || !adminHtml.includes('<!DOCTYPE html>')) {
      throw new Error('Rota do frontend administrativo nao foi servida');
    }

    const anonymousSession = await fetch(`http://127.0.0.1:${port}/api/admin/session`);
    if (anonymousSession.status !== 401) {
      throw new Error(`Sessao anonima deveria retornar 401, recebeu ${anonymousSession.status}`);
    }

    const anonymousWrite = await fetch(`http://127.0.0.1:${port}/api/escala`, { method: 'PUT' });
    if (anonymousWrite.status !== 401) {
      throw new Error(`Escrita anonima deveria retornar 401, recebeu ${anonymousWrite.status}`);
    }

    const wrongLogin = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'incorreta' })
    });
    if (wrongLogin.status !== 401) {
      throw new Error(`Senha incorreta deveria retornar 401, recebeu ${wrongLogin.status}`);
    }

    const login = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword })
    });
    const sessionCookie = login.headers.get('set-cookie')?.split(';')[0];
    if (!login.ok || !sessionCookie) {
      throw new Error('Login administrativo nao criou a sessao segura');
    }

    const authenticatedSession = await fetch(`http://127.0.0.1:${port}/api/admin/session`, {
      headers: { Cookie: sessionCookie }
    });
    if (!authenticatedSession.ok) {
      throw new Error('Sessao administrativa valida nao foi reconhecida');
    }

    if (html.includes("ADMIN_PIN: '")) {
      throw new Error('PIN administrativo nao pode ser publicado no JavaScript');
    }

    console.log('Smoke test OCI concluido: consulta publica, login somente por senha e Evolution degradada.');
  } finally {
    server.kill();
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
