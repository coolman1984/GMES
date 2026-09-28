/**
 * The screens (apps/mes-web) and the shared interface kit (packages/eco-ui), served by the same server as the API:
 * one address, one origin, no second web server to install.
 *
 *   /            -> apps/mes-web/index.html
 *   /ui/<file>   -> apps/mes-web/<file>
 *   /eco-ui/<f>  -> packages/eco-ui/src/<f>
 *
 * Only files that exist when the server starts are served (a fixed list, looked up by name): no path from a
 * request ever reaches the file system. A strict Content-Security-Policy allows scripts from this server only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const WEB_DIR = join(ROOT, 'apps', 'mes-web');
export const KIT_DIR = join(ROOT, 'packages', 'eco-ui', 'src');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
};

function listing(dir: string, prefix: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (TYPES[extname(f)]) out.set(prefix + relative(dir, p).split('\\').join('/'), p);
    }
  };
  walk(dir);
  return out;
}

export function serveScreens(http: FastifyInstance): Map<string, string> {
  const files = new Map([...listing(WEB_DIR, '/ui/'), ...listing(KIT_DIR, '/eco-ui/')]);
  files.set('/', join(WEB_DIR, 'index.html'));
  const send = (path: string) => async (_req: unknown, reply: import('fastify').FastifyReply) => {
    reply.headers({ ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return reply.send(readFileSync(path));
  };
  for (const [url, path] of files) http.get(url, send(path));
  return files;
}
