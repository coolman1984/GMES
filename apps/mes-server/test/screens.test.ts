import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

  test('every screen file is valid JavaScript (a syntax error in one screen blanks the whole application)', () => {
    for (const f of files) {
      const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: read(f), encoding: 'utf8' });
      assert.equal(r.status, 0, f + '\n' + r.stderr);
    }
  });

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
    // the daily report names a work order's status as t("st." + status): every status the server stores needs a name
    const exe = read(join(WEB_DIR, '..', '..', 'apps', 'mes-server', 'src', 'modules', 'exe', 'index.ts'));
    const statuses = [...(exe.match(/status\s+TEXT NOT NULL[^)]*CHECK \(status IN \(([^)]*)\)/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    assert.ok(statuses.includes('completed'), 'the work order statuses are read from the server: ' + statuses);
    assert.deepEqual(statuses.filter((x) => !(`st.${x}` in en)), []);
  });

  test('the operator station: every scrap reason has a name in both languages; unit-by-unit only for serialised items', () => {
    // scrap reasons are shown as t("scrap." + code): a code without a name shows its raw key to the operator
    const src = read(join(WEB_DIR, 'screens', 'exe2020.js'));
    const en = JSON.parse(read(join(WEB_DIR, 'i18n', 'en.json'))), ar = JSON.parse(read(join(WEB_DIR, 'i18n', 'ar.json')));
    const lists = src.slice(src.indexOf('const SCRAP ='), src.indexOf('const LOSS_ICON'));
    const codes = [...lists.matchAll(/\["([a-z_]+)", "[a-z-]+"\]/g)].map((m) => m[1]!);
    assert.ok(codes.includes('kiln_crack') && codes.includes('solder'), 'the ceramic and the electronics lists are both read');
    assert.deepEqual(codes.filter((c) => !(`scrap.${c}` in en) || !(`scrap.${c}` in ar)), []);
    // the server books a lot or bulk item on a routing by quantity (only serial + routing is refused): so does the screen
    assert.match(src, /const serial = \(\) => !!\(S\.wo && S\.wo\.routing_id && S\.wo\.item\.tracking === "serial"\)/);
    // the release plan says "serial flow" only for a serial item: a lot of tiles on a routing is booked by quantity
    assert.match(read(join(WEB_DIR, 'screens', 'exe2010.js')), /o\.routing_id && o\.item\.tracking === "serial" \? ui\.badge\(t\("plan\.serial_flow"\)/);
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

  test('a screen hears "activated" once when it opens, then once per return to its tab', () => {
    const kit = read(join(KIT_DIR, 'eco-ui.js'));
    const from = kit.indexOf('function activate(');
    const activate = kit.slice(from, kit.indexOf('\n  function ', from + 1));
    assert.match(activate, /e && e\.ready && e\.inst\.onActivate/, 'activate() waits until the screen is built and shown');
    assert.match(kit, /entry\.inst = inst; entry\.ready = true;/, 'the first activation comes from the build, once');
  });

  test('the kit knows nothing about manufacturing or people: products build their screens from it', () => {
    const kit = read(join(KIT_DIR, 'eco-ui.js'));
    assert.doesNotMatch(kit, /work.?order|employee|EXE\d|MDM\d|\/api\//i);
  });
});
