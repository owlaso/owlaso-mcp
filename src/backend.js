import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:3000';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitHealthy(base, child, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`OwlASO server exited (${child.exitCode}).`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Timed out waiting for the OwlASO server.');
}

/**
 * Resolve the OwlASO HTTP API.
 *  - OWLASO_URL: use a running instance (npm start in the owlaso repo).
 *  - OWLASO_DIR: spawn `src/server.js` from an owlaso checkout on a free loopback port.
 *  - neither: http://127.0.0.1:3000.
 */
export async function startBackend(env = process.env) {
  if (env.OWLASO_URL) return { base: env.OWLASO_URL.replace(/\/+$/u, ''), stop() {} };
  if (!env.OWLASO_DIR) return { base: DEFAULT_URL, stop() {} };

  const port = await freePort();
  const child = spawn(process.execPath, [path.resolve(env.OWLASO_DIR, 'src/server.js')], {
    env: { ...env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'inherit'], // stdout belongs to the MCP transport
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitHealthy(base, child);
  } catch (error) {
    child.kill();
    throw error;
  }
  return { base, stop: () => child.kill() };
}
