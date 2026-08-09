const { spawn } = require('child_process');
const path = require('path');

const port = 3137;
const backendDir = path.resolve(__dirname, '..');
const publicDir = path.resolve(backendDir, '..');

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
    SUPABASE_SECRET_KEY: ''
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

    console.log('Smoke test OCI concluido: frontend ativo e Evolution degradada.');
  } finally {
    server.kill();
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
