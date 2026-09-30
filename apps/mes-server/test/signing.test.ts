import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkSignature, sha256hex, signatureHeaders, signRequest } from '../src/kernel/signing.js';
import { server } from './helpers.js';

process.env.GMES_SECRETS = 'plain';

/** Request signatures on machine calls (plan 50 WP-X2): same algorithm as Mizan and HR-System. */
test('the algorithm: a fixed vector, and anything changed is refused', () => {
  // the same vector is pinned in Mizan's and HR-System's tests: three implementations, one signature
  const kh = sha256hex('mk_example_key');
  assert.equal(kh, '2e0337bdb84b83290ffebce13b546d7a2e9946911b81a9775b069bbb1afc7013');
  assert.equal(signRequest(kh, 'POST', '/eco/v1/inbox?x=1', '{"events":[]}', 1_800_000_000_000), 'd67f9a620fd70b7d0f6ffeee7f3f4cbc256e1ef3a573dedb2cb33507e0868197');
  const now = 1_800_000_000_000, body = '{"events":[]}';
  const sig = signRequest(kh, 'POST', '/eco/v1/inbox', body, now);
  const base = { keyHash: kh, method: 'POST', pathWithQuery: '/eco/v1/inbox', rawBody: body, ts: String(now), sig, now, required: false };
  assert.equal(checkSignature(base), null);
  assert.equal(checkSignature({ ...base, rawBody: '{"events":[1]}' }), 'auth.signature_invalid');
  assert.equal(checkSignature({ ...base, pathWithQuery: '/eco/v1/feed' }), 'auth.signature_invalid');
  assert.equal(checkSignature({ ...base, now: now + 5 * 60_000 + 1 }), 'auth.signature_expired');
  assert.equal(checkSignature({ ...base, sig: 'zz' }), 'auth.signature_malformed');
  assert.equal(checkSignature({ ...base, ts: undefined, sig: undefined }), null);
  assert.equal(checkSignature({ ...base, ts: undefined, sig: undefined, required: true }), 'auth.signature_required');
  assert.equal(checkSignature({ ...base, sig: undefined }), 'auth.signature_malformed');
});

test('over HTTP: signed calls work, tampered or stale ones get 401, unsigned ones work until signatures are required', async () => {
  const s = await server('mizan');
  const key = s.keys.link;
  const call = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: string) =>
    s.app.http.inject({ method, url, headers: { 'x-eco-key': key, 'content-type': 'application/json', ...headers }, payload });
  const url = '/eco/v1/feed?after=0&limit=10';
  assert.equal((await call('GET', url, {})).statusCode, 200, 'unsigned, not required');
  assert.equal((await call('GET', url, signatureHeaders(key, 'GET', url, ''))).statusCode, 200, 'signed');
  assert.equal((await call('GET', url, signatureHeaders(key, 'GET', '/eco/v1/feed?after=1&limit=10', ''))).statusCode, 401, 'signed for another query');
  assert.equal((await call('GET', url, signatureHeaders(key, 'GET', url, '', Date.now() - 6 * 60_000))).statusCode, 401, 'stale');
  const body = JSON.stringify({ events: [] });
  const ok = await call('POST', '/eco/v1/inbox', signatureHeaders(key, 'POST', '/eco/v1/inbox', body), body);
  assert.notEqual(ok.statusCode, 401, 'a signed POST reaches the inbox: ' + ok.body);
  const altered = await call('POST', '/eco/v1/inbox', signatureHeaders(key, 'POST', '/eco/v1/inbox', body), JSON.stringify({ events: [], x: 1 }));
  assert.equal(altered.statusCode, 401, 'a body changed after signing');
  assert.equal(JSON.parse(altered.body).error.code, 'auth.signature_invalid');
  process.env.ECO_REQUIRE_SIGNATURE = '1';
  try {
    assert.equal((await call('GET', url, {})).statusCode, 401, 'unsigned, required');
    assert.equal((await call('GET', url, signatureHeaders(key, 'GET', url, ''))).statusCode, 200, 'signed, required');
  } finally { delete process.env.ECO_REQUIRE_SIGNATURE; await s.close(); }
});
