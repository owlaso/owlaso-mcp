import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { z } from 'zod';
import { TOOLS, capFullReviews } from '../src/tools.js';
import { OwlasoClient, envInt, toResult } from '../src/client.js';
import { parseBaseUrl, startBackend } from '../src/backend.js';

const schema = (n) => z.object(TOOLS.find((t) => t.name === n).schema);

async function serve(handler, fn) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${srv.address().port}`);
  } finally {
    srv.closeAllConnections();
    await new Promise((r) => srv.close(r));
  }
}

test('tool schemas reject malformed / oversized input', () => {
  const rv = schema('get_reviews');
  assert.ok(rv.safeParse({ appId: 'com.spotify.music', country: 'all', lang: 'pt-BR', stars: '1, 2', dateFrom: '2024-01-31' }).success);
  assert.ok(rv.safeParse({ appId: '324684580' }).success);
  for (const bad of [
    { appId: '../../etc/passwd' },
    { appId: 'a b' },
    { appId: 'x'.repeat(256) },
    { appId: 'a', country: 'usa&x=1' },
    { appId: 'a', lang: 'en;rm' },
    { appId: 'a', stars: '0,9' },
    { appId: 'a', dateFrom: 'yesterday' },
    { appId: 'a', sort: 'newest&max=1' },
    { appId: 'a', keyword: 'k'.repeat(201) },
    { appId: 'a', minLength: 10 ** 9 },
  ]) assert.equal(rv.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 80));

  const kw = schema('analyze_keyword');
  assert.ok(kw.safeParse({ keyword: 'music', country: 'US' }).success);
  assert.equal(kw.safeParse({ keyword: 'm'.repeat(101) }).success, false);
  assert.equal(kw.safeParse({ keyword: 'music', country: 'all' }).success, false);
  assert.equal(schema('search_apps').safeParse({ q: '   ' }).success, false);
});

test('envInt falls back on invalid values instead of disabling limits', () => {
  assert.equal(envInt(undefined, 5), 5);
  assert.equal(envInt('abc', 5), 5);
  assert.equal(envInt('-1', 5), 5);
  assert.equal(envInt('1.5', 5), 5);
  assert.equal(envInt('42', 5), 42);
});

test('parseBaseUrl only accepts plain http(s) origins', () => {
  assert.equal(parseBaseUrl('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
  assert.equal(parseBaseUrl('https://h/owl//'), 'https://h/owl');
  for (const bad of ['file:///etc/passwd', 'javascript:1', 'http://u:p@h', 'http://h/?a=1', 'not a url']) {
    assert.throws(() => parseBaseUrl(bad), undefined, bad);
  }
});

test('startBackend rejects a bad OWLASO_URL', async () => {
  await assert.rejects(startBackend({ OWLASO_URL: 'ftp://x' }), /http or https/u);
});

test('oversized backend responses are refused', async () => {
  await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }); // chunked, no content-length
    res.write('['); for (let i = 0; i < 64; i++) res.write(`"${'x'.repeat(1024)}",`); res.end('0]');
  }, async (base) => {
    await assert.rejects(new OwlasoClient(base, 5000, 4096).get('/api/health'), /too large/u);
    assert.equal((await new OwlasoClient(base, 5000, 1 << 20).get('/api/health')).length, 65);
  });
  await serve((req, res) => { res.writeHead(200, { 'content-length': '999999' }); res.end(); }, async (base) => {
    await assert.rejects(new OwlasoClient(base, 5000, 1000).get('/x'), /too large/u);
  });
});

test('redirects are not followed', async () => {
  let hit = false;
  await serve((req, res) => { hit = true; res.end('{}'); }, (target) => serve((req, res) => {
    res.writeHead(302, { location: `${target}/steal` }); res.end();
  }, async (base) => {
    await assert.rejects(new OwlasoClient(base, 5000).get('/api/health'));
    assert.equal(hit, false);
  }));
});

test('backend errors are coerced to bounded strings', async () => {
  await serve((req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('obj') ? { error: { nested: 1 } } : { error: 'e'.repeat(5000) }));
  }, async (base) => {
    const c = new OwlasoClient(base, 5000);
    await assert.rejects(c.get('/obj'), { message: 'HTTP 400' });
    await assert.rejects(c.get('/long'), (e) => e.message.length <= 501);
  });
});

test('hung backend times out with a clear message', async () => {
  await serve(() => { /* never respond */ }, async (base) => {
    await assert.rejects(new OwlasoClient(base, 200).get('/api/health'), /did not respond within 200 ms/u);
  });
});

test('capFullReviews tolerates unexpected shapes', () => {
  assert.deepEqual(capFullReviews({ raw: 'x' }, 1), { raw: 'x' });
  assert.equal(capFullReviews(null, 1), null);
  const out = capFullReviews({ groups: [null, { reviews: 'nope' }, { reviews: [1, 2] }] }, 1);
  assert.deepEqual(out.groups, [null, { reviews: 'nope' }, { reviews: [1] }]);
  assert.equal(out.reviewsOmitted, 1);
});

test('toResult truncation never splits a surrogate pair', () => {
  const r = toResult('😀😀😀', 4); // JSON: "😀😀😀" → cut after `"` + one emoji + high surrogate
  const head = r.content[0].text.split('\n')[0];
  assert.equal(head, '"😀');
  assert.equal(r._meta.truncated, true);
  assert.equal(toResult(undefined).content[0].text, 'null');
});
