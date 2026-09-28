import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { KIT_DIR, WEB_DIR } from '../src/web.js';
import { server, type TestServer } from './helpers.js';

const js = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? js(join(dir, d.name)) : d.name.endsWith('.js') ? [join(dir, d.name)] : []));
const read = (p: string) => readFileSync(p, 'utf8');

describe('the screens are served by the server itself (one address, one origin)', () => {
  let s: TestServer;
  before(async () => { s = await server('gmes'); });
  after(() => s.close());
  const get = (url: string) => s.app.http.inject({ method: 'GET', url });

  test('the shell, its code and the shared kit are served with a strict policy and no key', async () => {
    const page = await get('/');
    assert.equal(page.statusCode, 200);
    assert.match(page.headers['content-type'] as string, /text\/html/);
    assert.match(page.headers['content-security-policy'] as string, /script-src 'self';/);
    assert.match(page.body, /\/eco-ui\/tokens\.css/);
    for (const url of ['/ui/app.js', '/ui/auth.js', '/ui/common.js', '/ui/screens/exe3010.js', '/ui/screens/mdm1020.js', '/ui/i18n/ar.json', '/eco-ui/eco-ui.js', '/eco-ui/tokens.css']) {
      const r = await get(url);
      assert.equal(r.statusCode, 200, url);
      assert.equal(r.headers['x-content-type-options'], 'nosniff', url);
    }
  });

  test('no path from a request reaches the file system', async () => {
    for (const url of ['/ui/../package.json', '/ui/%2e%2e/package.json', '/eco-ui/../../../package.json', '/ui/..%2f..%2fpackage.json', '/ui/data.js.bak', '/ui/']) {
      assert.notEqual((await get(url)).statusCode, 200, url);
    }
  });

  test('the API keeps asking for a key: serving screens opened nothing else', async () => {
    const r = await s.call('GET', '/api/items', undefined, null as unknown as string);
    assert.equal(r.status, 401);
  });
});

describe('the interface kit and the screens (UX phase, ADR-029)', () => {
  const files = [...js(WEB_DIR), ...js(KIT_DIR)];

  test('server values are written as text only: no HTML parsing, no code from strings', () => {
    for (const f of files) assert.doesNotMatch(read(f), /\.innerHTML|outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, f);
  });

  test('English and Arabic have the same keys, no empty text, and the Arabic is Arabic', () => {
    const en = JSON.parse(read(join(WEB_DIR, 'i18n', 'en.json'))), ar = JSON.parse(read(join(WEB_DIR, 'i18n', 'ar.json')));
    assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
    for (const [k, v] of Object.entries({ ...en, ...ar })) assert.ok(String(v).trim(), k);
    const latinOnly = Object.entries(ar).filter(([k, v]) => !/[؀-ۿ]/.test(String(v)) && !['st.scan_ph', 'u.mfa'].includes(k));
    assert.deepEqual(latinOnly, []);
  });

  test('every text key a screen uses exists, and every screen in the menu has a name', () => {
    const en = JSON.parse(read(join(WEB_DIR, 'i18n', 'en.json')));
    const used = new Set(files.filter((f) => f.startsWith(WEB_DIR)).flatMap((f) => [...read(f).matchAll(/\bt\("([a-z_]+(?:\.[A-Za-z0-9_]+)+)"/g)].map((m) => m[1]!)));
    assert.ok(used.size > 150, 'the screens use the dictionary');
    assert.deepEqual([...used].filter((k) => !(k in en)), []);
    const codes = [...read(join(WEB_DIR, 'app.js')).matchAll(/"([A-Z]{3,4}\d{4})"/g)].map((m) => m[1]!);
    assert.ok(codes.length > 40);
    assert.deepEqual(codes.filter((c) => !(`scr.${c}` in en)), []);
    for (const s of ['planned', 'released', 'run', 'hold', 'done', 'closed', 'idle', 'setup', 'down']) assert.ok(`st.${s}` in en, s);
  });

  test('no screen shows invented data: there is no sample file, and every screen reads the server', () => {
    assert.equal(existsSync(join(WEB_DIR, 'data.js')), false, 'the sample data file is gone');
    for (const f of js(WEB_DIR)) assert.doesNotMatch(read(f), /from\s+["'][./]*data\.js["']|Math\.random\(\)\s*\*/, f);
    for (const f of js(join(WEB_DIR, 'screens'))) assert.match(read(f), /\bapi\("GET"/, f);
  });

  test('the screens send every change as a command with its own id (a retry is applied once)', () => {
    for (const f of js(join(WEB_DIR, 'screens'))) {
      for (const m of read(f).matchAll(/api\("POST", `?"?\/api\/(work-orders|stoppages)[^,]*,\s*\{([^}]*)/g)) assert.match(m[2]!, /commandId: commandId\(\)/, f + ': ' + m[0]);
    }
  });

  test('every token the components use is defined, in the light and in the dark theme', () => {
    const tokens = read(join(KIT_DIR, 'tokens.css'));
    const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    const used = new Set([...[read(join(KIT_DIR, 'eco-ui.css')), read(join(WEB_DIR, 'mes.css'))].join('\n').matchAll(/var\((--(?:eco|st)-[a-z0-9-]+)/g)].map((m) => m[1]!));
    assert.deepEqual([...used].filter((v) => !defined.has(v)), []);
    const dark = tokens.slice(tokens.indexOf(':root[data-theme="dark"] {'));
    for (const v of ['--eco-app-bg', '--eco-surface', '--eco-text', '--eco-line', '--eco-grid-row-sel', '--eco-top-bg']) assert.match(dark, new RegExp(v + ':'), v);
  });

  test('the kit knows nothing about manufacturing or people: products build their screens from it', () => {
    const kit = read(join(KIT_DIR, 'eco-ui.js'));
    assert.doesNotMatch(kit, /work.?order|employee|EXE\d|MDM\d|\/api\//i);
  });
});
