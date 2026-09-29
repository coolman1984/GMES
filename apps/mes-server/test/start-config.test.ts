import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

// Runs scripts/check-link-config.ps1 (the part of start.ps1 that decides whether the link to Mizan is started and
// with what). Windows PowerShell or PowerShell 7; skipped where neither exists.
const script = fileURLToPath(new URL('../../../scripts/check-link-config.ps1', import.meta.url));
const shell = ['pwsh', 'powershell'].find((s) => spawnSync(s, ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' }).status === 0);
const run = (dataDir: string) => spawnSync(shell!, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-DataDir', dataDir], { encoding: 'utf8' });
const withDataDir = (config: object | null, fn: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'gmes-start-'));
  try {
    if (config) writeFileSync(join(dir, 'config.json'), JSON.stringify({ companyId: '0192f7c4-0000-7000-8000-00000000d3e1', port: 4712, ...config }));
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('a plant without a mizan section does not run the link', { skip: !shell }, () => {
  withDataDir({}, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.stdout.trim(), 'null');
  });
});

test('a configured plant gets the link environment; secrets come from files, never from config.json', { skip: !shell }, () => {
  const config = { mizan: { url: 'http://127.0.0.1:4800', user: 'mes-link', passwordFile: 'secrets\\pw.txt', mesKeyFile: 'secrets\\key.txt' } };
  withDataDir(config, (dir) => {
    mkdirSync(join(dir, 'secrets'));
    writeFileSync(join(dir, 'secrets', 'pw.txt'), 'S3cret-pass\r\n');
    writeFileSync(join(dir, 'secrets', 'key.txt'), 'eco-key-123\n');
    const r = run(dir);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const s = JSON.parse(r.stdout);
    assert.equal(s.LINK_MIZAN_URL, 'http://127.0.0.1:4800');
    assert.equal(s.LINK_MIZAN_USER, 'mes-link');
    assert.equal(s.LINK_MIZAN_PASSWORD, 'S3cret-pass');
    assert.equal(s.LINK_MES_KEY, 'eco-key-123');
    assert.equal(s.LINK_MES_URL, 'http://127.0.0.1:4712');
    assert.equal(s.LINK_COMPANY_ID, '0192f7c4-0000-7000-8000-00000000d3e1');
    assert.equal(s.LINK_WIP_ACCOUNT, '1145');
    assert.equal(s.LINK_VARIANCE_ACCOUNT, '5170');
    assert.match(s.LINK_HEARTBEAT, /link-mizan\.heartbeat\.json$/);
    const saved = readFileSync(join(dir, 'config.json'), 'utf8');
    assert.ok(!saved.includes('S3cret-pass') && !saved.includes('eco-key-123'), 'no secret in config.json');
  });
});

test('a configured link whose secret file is missing stops the start with a clear message', { skip: !shell }, () => {
  withDataDir({ mizan: { url: 'http://127.0.0.1:4800', user: 'mes-link', passwordFile: 'nope.txt', mesKeyFile: 'nope2.txt' } }, (dir) => {
    const r = run(dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /mizan\.passwordFile does not exist/);
  });
});
