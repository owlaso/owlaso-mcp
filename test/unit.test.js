import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, capFullReviews } from '../src/tools.js';
import { OwlasoClient } from '../src/client.js';

const tool = (n) => TOOLS.find((t) => t.name === n);

test('flags are serialized the way OwlASO parses them', () => {
  const c = new OwlasoClient('http://x');
  const kw = c.url('/api/asosearch', tool('analyze_keyword').map({ keyword: 'music', lite: true, track: false }));
  assert.equal(kw.searchParams.get('q'), 'music');
  assert.equal(kw.searchParams.get('lite'), '1');
  assert.equal(kw.searchParams.has('track'), false);

  const rv = c.url('/api/reviews', tool('get_reviews').map({ appId: 'a', replyOnly: true }));
  assert.equal(rv.searchParams.get('replyOnly'), 'true');
  assert.equal(c.url('/api/reviews', tool('get_reviews').map({ appId: 'a', replyOnly: false })).searchParams.has('replyOnly'), false);
});

test('capFullReviews keeps stats and counts omitted rows', () => {
  const out = capFullReviews({ totalReviews: 5, groups: [{ count: 3, reviews: [1, 2, 3] }, { count: 2, reviews: [4, 5] }] }, 1);
  assert.deepEqual(out.groups.map((g) => g.reviews), [[1], [4]]);
  assert.equal(out.reviewsOmitted, 3);
  assert.equal(out.groups[0].count, 3);
});
