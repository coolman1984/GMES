/**
 * Health of the link to Mizan, from the pulse file the link rewrites after every cycle (apps/link-mizan/src/heartbeat.ts).
 * Only judged when the plant is configured to run the link (GMES_LINK_MIZAN_HEARTBEAT is set). Missing, unreadable,
 * never-succeeded or stale means NOT healthy: a link that quietly stopped must show on the page, not be trusted.
 */
export interface LinkHealth {
  id: 'link_mizan';
  ok: boolean;
  details: { state: 'ok' | 'never_ran' | 'unreadable' | 'never_succeeded' | 'stale'; lastOkAt?: string | null; ageSeconds?: number; note?: string };
}

export function linkMizanCheck(raw: string | null, now: Date, maxAgeMs: number): LinkHealth {
  if (raw === null) return { id: 'link_mizan', ok: false, details: { state: 'never_ran' } };
  let hb: { lastOkAt?: unknown; note?: unknown };
  try {
    hb = JSON.parse(raw);
  } catch {
    return { id: 'link_mizan', ok: false, details: { state: 'unreadable' } };
  }
  const note = typeof hb.note === 'string' ? hb.note : undefined;
  const last = typeof hb.lastOkAt === 'string' ? Date.parse(hb.lastOkAt) : NaN;
  if (Number.isNaN(last)) return { id: 'link_mizan', ok: false, details: { state: 'never_succeeded', lastOkAt: null, note } };
  const age = now.getTime() - last;
  if (age <= maxAgeMs) return { id: 'link_mizan', ok: true, details: { state: 'ok', lastOkAt: hb.lastOkAt as string, ageSeconds: Math.round(age / 1000) } };
  return { id: 'link_mizan', ok: false, details: { state: 'stale', lastOkAt: hb.lastOkAt as string, ageSeconds: Math.round(age / 1000), note } };
}
