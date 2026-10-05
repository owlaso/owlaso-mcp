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
      // Per-probe timeout: a socket that accepts but never answers must not outlive the deadline.
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(Math.max(1, Math.min(2000, deadline - Date.now()))), redirect: 'error' });
      await res.body?.cancel();
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Timed out waiting for the OwlASO server.');
}

// Only plain http(s) origins; credentials and paths are rejected so the base can't smuggle them into every request.
export function parseBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`OWLASO_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('OWLASO_URL must use http or https.');
  if (url.username || url.password) throw new Error('OWLASO_URL must not contain credentials.');
  if (url.search || url.hash) throw new Error('OWLASO_URL must not contain a query or fragment.');
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, '');
}

/**
 * Resolve the OwlASO HTTP API.
 *  - OWLASO_URL: use a running instance (npm start in the owlaso repo).
 *  - OWLASO_DIR: spawn `src/server.js` from an owlaso checkout on a free loopback port.
 *  - neither: http://127.0.0.1:3000.
 */
export async function startBackend(env = process.env) {
  if (env.OWLASO_URL) return { base: parseBaseUrl(env.OWLASO_URL), stop() {} };
  if (!env.OWLASO_DIR) return { base: DEFAULT_URL, stop() {} };

  const port = await freePort();
  const child = spawn(process.execPath, [path.resolve(env.OWLASO_DIR, 'src/server.js')], {
    // HOST is pinned to loopback after the spread so the inherited env can't expose the API.
    env: { ...env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'inherit'], // stdout belongs to the MCP transport
  });
  const spawnError = new Promise((_, reject) => child.once('error', reject));
  spawnError.catch(() => {}); // a late 'error' must not become an unhandled rejection
  const base = `http://127.0.0.1:${port}`;
  try {
    await Promise.race([waitHealthy(base, child), spawnError]);
  } catch (error) {
    child.kill();
    throw error;
  }
  const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill(); };
  // Don't orphan the server if this process dies on an uncaught error.
  process.once('exit', stop);
  return { base, stop };
}
