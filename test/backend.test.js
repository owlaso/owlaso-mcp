import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startBackend } from '../src/backend.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function fakeOwlaso(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owlaso-fake-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src/server.js'), source);
  return dir;
}

// Mirrors OwlASO: listens on PORT/HOST from env, serves /api/health.
const HEALTHY = `
import http from 'node:http';
http.createServer((req, res) => res.end(JSON.stringify({ ok: true, env: { PORT: process.env.PORT, HOST: process.env.HOST } })))
  .listen(Number.parseInt(process.env.PORT, 10), process.env.HOST);
`;

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function until(cond, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return cond();
}

test('child binds its own ephemeral loopback port and reports it', async () => {
  const backend = await startBackend({ ...process.env, OWLASO_DIR: fakeOwlaso(HEALTHY), HOST: '0.0.0.0', PORT: '3000' });
  try {
    const url = new URL(backend.base);
    assert.equal(url.hostname, '127.0.0.1');
    assert.notEqual(url.port, '3000');
    const body = await (await fetch(`${backend.base}/api/health`)).json();
    assert.deepEqual(body.env, { PORT: '0', HOST: '127.0.0.1' });
  } finally {
    backend.stop();
  }
  assert.ok(await until(() => !alive(backend.pid)));
});

test('a server that exits before listening is reported', async () => {
  await assert.rejects(startBackend({ ...process.env, OWLASO_DIR: fakeOwlaso('process.exit(3);') }), /exited \(3\)/u);
});

test('child exits when the MCP process is SIGKILLed (no orphan)', async () => {
  const dir = fakeOwlaso(HEALTHY);
  const parent = spawn(process.execPath, ['--input-type=module', '-e', `
    const { startBackend } = await import(${JSON.stringify(pathToFileURL(path.resolve(here, '../src/backend.js')).href)});
    const b = await startBackend({ ...process.env, OWLASO_DIR: ${JSON.stringify(dir)} });
    console.log(b.pid);
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  const pid = Number(await new Promise((resolve) => parent.stdout.once('data', (d) => resolve(String(d).trim()))));
  try {
    assert.ok(alive(pid));
    parent.kill('SIGKILL');
    assert.ok(await until(() => !alive(pid)), 'OwlASO child outlived its parent');
  } finally {
    if (alive(pid)) process.kill(pid, 'SIGKILL'); // never leave an orphan holding the runner's stderr
  }
});
