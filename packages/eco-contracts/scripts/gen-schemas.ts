/**
 * Writes one JSON Schema per contract into schemas/, for apps that are not TypeScript
 * (BAMS is Python). A test fails when these files are stale, so they never lie.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSchemas } from '../src/schemas.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');
mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(renderSchemas())) writeFileSync(join(dir, `${name}.schema.json`), text);
console.log(`wrote ${Object.keys(renderSchemas()).length} schemas to ${dir}`);
