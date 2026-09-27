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
 * to the day it started on (the "export of the wrong day" lesson from the G-MES automation).
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
