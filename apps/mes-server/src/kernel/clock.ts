import { newUuidv7 } from '@eco/contracts';

/**
 * Time and identity come from outside the business logic (idea taken from Space Planner's pure
 * core), so tests can pin them and every decision is reproducible.
 */
export interface Clock {
  now(): Date;
  newId(): string;
}

export const systemClock: Clock = { now: () => new Date(), newId: newUuidv7 };

/**
 * The production day a moment belongs to: a night shift that runs past midnight still belongs
 * to the day it started on (the "export of the wrong day" lesson from an earlier automation project).
 */
export function productionDate(now: Date, timeZone: string, dayStart: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const local = `${parts.hour}:${parts.minute}`;
  const day = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  if (local < dayStart) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** The local hour (0-23) of a moment in the plant's time zone: the buckets of the hourly boards. */
export function localHour(at: Date, timeZone: string): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(at));
}

/** The UTC instant of a local wall-clock time in the plant's zone. */
export function localInstant(day: string, hhmm: string, timeZone: string): number {
  const probe = new Date(`${day}T12:00:00Z`);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(probe).map((x) => [x.type, x.value]));
  const offset = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - probe.getTime();
  const [h, m] = hhmm.split(':').map(Number);
  return Date.parse(`${day}T00:00:00Z`) + (h! * 60 + m!) * 60000 - offset;
}

/** The instants a production shift of a production day runs between (a night shift ends the next calendar day). */
export function shiftWindow(day: string, s: { start_at: string; end_at: string }, timeZone: string, dayStart: string): { from: number; to: number } {
  // a shift that starts before the production day starts (e.g. 01:00 with days starting 07:00) belongs to the next calendar day
  const startDay = s.start_at < dayStart ? nextDay(day) : day;
  const from = localInstant(startDay, s.start_at, timeZone);
  let to = localInstant(startDay, s.end_at, timeZone);
  if (to <= from) to += 24 * 3600_000;
  return { from, to };
}
const nextDay = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
