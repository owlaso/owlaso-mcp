#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { startBackend } from './backend.js';
import { OwlasoClient, toResult, toError } from './client.js';
import { register } from './tools.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export function createServer(client) {
  const server = new McpServer({ name: 'owlaso', version });
  register(server, client, toResult, toError);
  return server;
}

async function main() {
  const backend = await startBackend();
  const server = createServer(new OwlasoClient(backend.base));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    backend.stop();
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, shutdown);
  process.stdin.on('end', shutdown);
  process.stdin.on('close', shutdown);
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => { console.error('[owlaso-mcp]', error.message); process.exit(1); });
}
