import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { canonicalJson, GENESIS_HASH, lineHash } from '../src/index.js';

const vectors = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'canonical-v1.json'), 'utf8'));

test('canonical JSON and journal hashes match the Python reference byte for byte (shared vectors)', () => {
  let prev = GENESIS_HASH;
  for (const v of vectors.vectors) {
    assert.equal(canonicalJson(v.value), v.canonical, v.name);
    assert.equal(v.line_prev, prev);
    const h = lineHash(vectors.domain, { ...v.value, prev });
    assert.equal(h, v.line_hash, v.name);
    prev = h;
  }
});

test('floats and non-JSON values are refused instead of being written differently per language', () => {
  assert.throws(() => canonicalJson({ qty: 1.5 }), /integers only/);
  assert.throws(() => canonicalJson({ f: () => 1 }), /not representable/);
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
});
