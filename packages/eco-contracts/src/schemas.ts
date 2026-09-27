import { z } from 'zod';
import { CONTRACTS } from './index.js';

/** Contract name -> pretty JSON Schema text (stable key order, trailing newline). */
export function renderSchemas(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, schema] of Object.entries(CONTRACTS)) {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    out[name] = JSON.stringify({ $id: `https://eco.local/contracts/${name}.schema.json`, title: name, ...json }, null, 2) + '\n';
  }
  return out;
}
