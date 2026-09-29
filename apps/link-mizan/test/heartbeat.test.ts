import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { nextHeartbeat, writeHeartbeat } from '../src/heartbeat.js';

const T1 = new Date('2026-09-29T10:00:00Z');
const T2 = new Date('2026-09-29T10:00:10Z');
const T3 = new Date('2026-09-29T10:00:20Z');

test('a cycle that ran to the end is healthy and remembered as the last good one', () => {
  const hb = nextHeartbeat(null, T1, {});
  assert.deepEqual(hb, { at: T1.toISOString(), ok: true, lastOkAt: T1.toISOString(), note: 'ok' });
});

test('a cycle stopped early (Mizan down) is not healthy, and the last good time is kept', () => {
  const good = nextHeartbeat(null, T1, {});
  const stopped = nextHeartbeat(good, T2, { stoppedBy: 'Mizan unreachable' });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.lastOkAt, T1.toISOString());
  assert.equal(stopped.note, 'Mizan unreachable');
});

test('a cycle that threw is not healthy; the first-ever failure has no last good time', () => {
  const failed = nextHeartbeat(null, T1, { error: 'account 1145 does not exist in Mizan' });
  assert.equal(failed.ok, false);
  assert.equal(failed.lastOkAt, null);
  const recovered = nextHeartbeat(failed, T3, {});
  assert.equal(recovered.ok, true);
  assert.equal(recovered.lastOkAt, T3.toISOString());
});

test('the pulse file is written whole (no temporary file left behind)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hb-'));
  try {
    const file = join(dir, 'sub', 'link.json');
    writeHeartbeat(file, nextHeartbeat(null, T1, {}));
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).ok, true);
    assert.throws(() => readFileSync(`${file}.tmp`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
