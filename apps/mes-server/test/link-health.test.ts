import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linkMizanCheck } from '../src/modules/eco/link-health.js';

const NOW = new Date('2026-09-29T10:02:00Z');
const MAX = 120_000;
const pulse = (lastOkAt: string | null, note = 'ok') => JSON.stringify({ at: NOW.toISOString(), ok: lastOkAt !== null, lastOkAt, note });

test('the link to Mizan is healthy while its last good cycle is recent', () => {
  const c = linkMizanCheck(pulse('2026-09-29T10:01:30Z'), NOW, MAX);
  assert.equal(c.ok, true);
  assert.equal(c.details.state, 'ok');
  assert.equal(c.details.ageSeconds, 30);
});

test('a link whose last good cycle is older than the limit is NOT healthy, even if it still writes its pulse', () => {
  const c = linkMizanCheck(pulse('2026-09-29T09:50:00Z', 'Mizan unreachable'), NOW, MAX);
  assert.equal(c.ok, false);
  assert.equal(c.details.state, 'stale');
  assert.equal(c.details.note, 'Mizan unreachable');
});

test('a configured link that never wrote a pulse, wrote garbage, or never succeeded is not healthy', () => {
  assert.equal(linkMizanCheck(null, NOW, MAX).details.state, 'never_ran');
  assert.equal(linkMizanCheck('{not json', NOW, MAX).details.state, 'unreadable');
  const never = linkMizanCheck(pulse(null, 'account 1145 does not exist in Mizan'), NOW, MAX);
  assert.equal(never.ok, false);
  assert.equal(never.details.state, 'never_succeeded');
});

test('exactly at the limit still counts as healthy, one second over does not', () => {
  assert.equal(linkMizanCheck(pulse('2026-09-29T10:00:00Z'), NOW, MAX).ok, true);
  assert.equal(linkMizanCheck(pulse('2026-09-29T09:59:59Z'), NOW, MAX).ok, false);
});
