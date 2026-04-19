import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer as createHttpsServer } from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const hermesCommand = process.env.MASTER_CHAT_HERMES_COMMAND || '/usr/local/bin/hermes';
const hermesCwd = process.env.MASTER_CHAT_HERMES_CWD || '/root/hermes-agent';
const adapterPort = Number(process.env.MASTER_CHAT_ADAPTER_PORT || (9300 + Math.floor(Math.random() * 200)));
const httpsPort = Number(process.env.MASTER_CHAT_REMOTE_HTTPS_PORT || (9500 + Math.floor(Math.random() * 200)));
const authToken = process.env.MASTER_CHAT_ADAPTER_TOKEN || `remote-local-${Date.now()}`;
const tempDir = mkdtempSync(join(tmpdir(), 'paperclip-master-chat-https-'));
const keyFile = join(tempDir, 'key.pem');
const certFile = join(tempDir, 'cert.pem');

function log(step, detail) {
  console.log(`[remote-adapter-local-smoke] ${step}${detail ? `: ${detail}` : ''}`);
}

function fail(message) {
  throw new Error(message);
}

async function waitFor(url, attempts = 30) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await delay(400);
  }
  fail(`Timed out waiting for ${url}`);
}

function generateCertificate() {
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyFile,
    '-out', certFile,
    '-subj', '/CN=localhost',
    '-days', '1',
  ], { stdio: 'ignore' });
}

function startAdapter() {
  const child = spawn('node', ['./dist/adapter-service.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      MASTER_CHAT_ADAPTER_PORT: String(adapterPort),
      MASTER_CHAT_ADAPTER_HOST: '127.0.0.1',
      MASTER_CHAT_ADAPTER_TOKEN: authToken,
      MASTER_CHAT_HERMES_COMMAND: hermesCommand,
      MASTER_CHAT_HERMES_CWD: hermesCwd,
      MASTER_CHAT_ADAPTER_DEFAULT_PROFILE: 'default',
      MASTER_CHAT_ADAPTER_DEFAULT_PROVIDER: 'auto',
      MASTER_CHAT_ADAPTER_DEFAULT_MODEL: 'MiniMax-M2.7',
      MASTER_CHAT_ADAPTER_TIMEOUT_MS: process.env.MASTER_CHAT_ADAPTER_TIMEOUT_MS || '120000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  child.stdout.on('data', () => {});

  return { child, getStderr: () => stderr };
}

function startHttpsProxy() {
  const key = readFileSync(keyFile);
  const cert = readFileSync(certFile);
  const server = createHttpsServer({ key, cert }, async (req, res) => {
    try {
      const bodyChunks = [];
      for await (const chunk of req) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;
      const upstreamHeaders = { ...req.headers };
      delete upstreamHeaders.host;
      const upstream = await fetch(`http://127.0.0.1:${adapterPort}${req.url || '/'}`, {
        method: req.method,
        headers: upstreamHeaders,
        body,
      });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      const text = await upstream.text();
      res.end(text);
    } catch (error) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  return server;
}

async function runChild(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...options,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit ${code ?? 'unknown'})`));
    });
  });
}

async function stopChild(child) {
  if (!child) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2000),
  ]);
}

async function main() {
  log('build', 'Building plugin artifacts');
  execFileSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit' });

  log('cert', 'Generating ephemeral self-signed certificate');
  generateCertificate();

  log('adapter', 'Starting bundled Hermes adapter');
  const adapter = startAdapter();
  await waitFor(`http://127.0.0.1:${adapterPort}/health`);

  log('proxy', 'Starting HTTPS reverse proxy');
  const proxy = startHttpsProxy();
  await new Promise((resolve) => proxy.listen(httpsPort, '127.0.0.1', resolve));

  try {
    log('smoke', 'Running signed HTTPS adapter smoke');
    await runChild('node', ['./scripts/remote-adapter-smoke.mjs'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        MASTER_CHAT_REMOTE_ADAPTER_URL: `https://127.0.0.1:${httpsPort}`,
        MASTER_CHAT_REMOTE_ADAPTER_TOKEN: authToken,
        MASTER_CHAT_REMOTE_ALLOW_INSECURE_TLS: 'true',
        MASTER_CHAT_REMOTE_PROFILE: 'default',
        MASTER_CHAT_REMOTE_PROVIDER: 'auto',
        MASTER_CHAT_REMOTE_MODEL: 'MiniMax-M2.7',
      },
    });
  } finally {
    await new Promise((resolve) => proxy.close(resolve));
    await stopChild(adapter.child);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[remote-adapter-local-smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
