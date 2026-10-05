import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const owlasoDir = process.env.OWLASO_DIR || path.resolve(here, '../../owlaso');
const have = fs.existsSync(path.join(owlasoDir, 'src/server.js'));

test('spawns OwlASO (mock data) and serves tools over stdio', { skip: !have && 'OWLASO_DIR not found' }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(here, '../src/index.js')],
    env: { ...process.env, OWLASO_DIR: owlasoDir, MOCK_STORE_DATA: '1', DISABLE_RANK_HISTORY: '1' },
  });
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'analyze_keyword'));

    const health = await client.callTool({ name: 'owlaso_health', arguments: {} });
    assert.equal(JSON.parse(health.content[0].text).mock, true);

    const found = await client.callTool({ name: 'search_apps', arguments: { q: 'spotify' } });
    assert.ok(!found.isError, found.content[0].text);

    const kw = await client.callTool({ name: 'analyze_keyword', arguments: { keyword: 'music', country: 'us', lite: true } });
    assert.ok(!kw.isError, kw.content[0].text);

    const parse = (r) => { assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };

    // replyOnly must reach OwlASO as "true" (it ignores "1").
    const replied = parse(await client.callTool({ name: 'get_reviews', arguments: { appId: 'com.spotify.music', replyOnly: true } }));
    assert.ok(replied.reviews.length > 0);
    assert.ok(replied.reviews.every((r) => r.replyText));

    const full = parse(await client.callTool({ name: 'get_full_reviews', arguments: { appId: 'com.spotify.music', reviewsPerGroup: 2 } }));
    assert.ok(full.groups.every((g) => g.reviews.length <= 2));
    assert.ok(full.reviewsOmitted > 0);
    assert.ok(full.totalReviews > 0);

    const bad = await client.callTool({ name: 'keyword_history', arguments: { keyword: 'music', store: 'both', country: 'zz' } });
    assert.ok(bad.content[0].text.length > 0);
  } finally {
    await client.close();
  }
});
