import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MODULES, ordered } from '../src/app.js';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));

test('a module imports only kernel/, contracts/, @eco/contracts, libraries and its own folder (mechano rule, as in Mizan)', () => {
  const bad: string[] = [];
  for (const file of files(join(src, 'modules')).filter((f) => f.endsWith('.ts'))) {
    const own = relative(join(src, 'modules'), file).split('/')[0]!;
    for (const m of readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
      const spec = m[1]!;
      if (!spec.startsWith('.')) continue;
      const target = relative(src, resolve(dirname(file), spec));
      const ok = target.startsWith('kernel/') || target.startsWith('contracts/') || target.startsWith(`modules/${own}/`);
      if (!ok) bad.push(`${relative(src, file)} -> ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the kernel never imports a module', () => {
  for (const file of files(join(src, 'kernel'))) assert.doesNotMatch(readFileSync(file, 'utf8'), /from '\.\.\/modules\//, file);
});

test('every module dependency is installed and the order has no cycle', () => {
  const ids = ordered(MODULES).map((m) => m.id);
  assert.deepEqual(ids.slice(0, 1), ['system']);
  assert.ok(ids.indexOf('eco') < ids.indexOf('exe'));
});

test('manufacturing never stores a value or a cost (cost is owned by accounting)', () => {
  for (const file of files(join(src, 'modules'))) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(unit_cost|unitCost|value_minor|amount)\b/, `${relative(src, file)} mentions a money field`);
  }
});
