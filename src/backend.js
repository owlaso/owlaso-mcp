import { spawn } from 'node:child_process';
import path from 'node:path';

const DEFAULT_URL = 'http://127.0.0.1:3000';
// A file: URL, not a path: `--import C:\…` is not a valid specifier on Windows.
const PRELOAD = new URL('./preload.js', import.meta.url).href;

// The child binds PORT=0 itself and reports the real port over IPC (see preload.js).
function boundPort(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const done = (fn, value) => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      child.off('error', onError);
      fn(value);
    };
    const onMessage = (msg) => {
      const port = msg?.owlasoPort;
      if (Number.isInteger(port) && port > 0 && port < 65536) done(resolve, port);
    };
    const onExit = (code, signal) => done(reject, new Error(`OwlASO server exited (${code ?? signal}).`));
    const onError = (error) => done(reject, error);
    const timer = setTimeout(() => done(reject, new Error('Timed out waiting for the OwlASO server to listen.')), timeoutMs);
    child.on('message', onMessage);
    child.once('exit', onExit);
    child.once('error', onError);
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
 *  - OWLASO_DIR: spawn `src/server.js` from an owlaso checkout; it binds an ephemeral loopback port itself.
 *  - neither: http://127.0.0.1:3000.
 */
export async function startBackend(env = process.env) {
  if (env.OWLASO_URL) return { base: parseBaseUrl(env.OWLASO_URL), stop() {} };
  if (!env.OWLASO_DIR) return { base: DEFAULT_URL, stop() {} };

  const child = spawn(process.execPath, ['--import', PRELOAD, path.resolve(env.OWLASO_DIR, 'src/server.js')], {
    // HOST is pinned to loopback after the spread so the inherited env can't expose the API.
    env: { ...env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'], // stdout belongs to the MCP transport
  });
  child.on('error', (error) => console.error('[owlaso-mcp] OwlASO server:', error.message)); // never crash on a late spawn/kill error
  const stop = () => { if (child.exitCode === null && child.signalCode === null) child.kill(); };
  let base;
  try {
    const timeoutMs = 15000;
    const deadline = Date.now() + timeoutMs;
    base = `http://127.0.0.1:${await boundPort(child, timeoutMs)}`;
    await waitHealthy(base, child, Math.max(1, deadline - Date.now()));
  } catch (error) {
    stop();
    throw error;
  }
  // Don't orphan the server if this process dies on an uncaught error.
  process.once('exit', stop);
  return { base, pid: child.pid, stop };
}
