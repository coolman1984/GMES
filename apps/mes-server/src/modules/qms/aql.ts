/**
 * Acceptance sampling by attributes, single sampling, normal inspection (ISO 2859-1 / ANSI Z1.4, tables I and II-A).
 *
 * Table II-A is diagonal: moving one sample-size code letter down (sample ~×1.6) and one AQL column left (AQL ÷ ~1.6)
 * gives the same acceptance number. With letters A..R and AQL values 0.010..10 numbered from 0, a cell depends only on
 * s = letter + aql column:  s = 14 → Ac 0;  15 → "↑" (use the plan above);  16 → "↓" (use the plan below);
 * 17..24 → Ac 1, 2, 3, 5, 7, 10, 14, 21;  below 14 → "↓" to the Ac 0 plan;  above 24 → "↑" to the Ac 21 plan.
 * The known rows (J = 80: 0.65 → 1/2, 1.0 → 2/3, 1.5 → 3/4, 2.5 → 5/6, 4.0 → 7/8, 6.5 → 10/11) are tested.
 */
export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R'] as const;
const SAMPLE = [2, 3, 5, 8, 13, 20, 32, 50, 80, 125, 200, 315, 500, 800, 1250, 2000];
export const AQLS = ['0.010', '0.015', '0.025', '0.040', '0.065', '0.10', '0.15', '0.25', '0.40', '0.65', '1.0', '1.5', '2.5', '4.0', '6.5', '10'] as const;
const AC: Record<number, number> = { 14: 0, 17: 1, 18: 2, 19: 3, 20: 5, 21: 7, 22: 10, 23: 14, 24: 21 };
// lot size upper bounds -> code letter for general inspection levels I, II, III (table I)
const TABLE_I: [number, string, string, string][] = [
  [8, 'A', 'A', 'B'], [15, 'A', 'B', 'C'], [25, 'B', 'C', 'D'], [50, 'C', 'D', 'E'], [90, 'C', 'E', 'F'], [150, 'D', 'F', 'G'],
  [280, 'E', 'G', 'H'], [500, 'F', 'H', 'J'], [1200, 'G', 'J', 'K'], [3200, 'H', 'K', 'L'], [10000, 'J', 'L', 'M'],
  [35000, 'K', 'M', 'N'], [150000, 'L', 'N', 'P'], [500000, 'M', 'P', 'Q'], [Infinity, 'N', 'Q', 'R'],
];

export interface SamplingPlan { lotSize: number; level: 'I' | 'II' | 'III'; aql: string; letter: string; sample: number; accept: number; reject: number; all: boolean }

export function samplingPlan(lotSize: number, level: 'I' | 'II' | 'III', aql: string): SamplingPlan {
  if (!Number.isInteger(lotSize) || lotSize < 2) throw new RangeError('lot size must be 2 or more');
  const a = AQLS.indexOf(aql as (typeof AQLS)[number]);
  if (a < 0) throw new RangeError(`AQL ${aql} is not in the table (${AQLS.join(', ')})`);
  const row = TABLE_I.find((r) => lotSize <= r[0])!;
  let l: number = LETTERS.indexOf(row[level === 'I' ? 1 : level === 'II' ? 2 : 3] as (typeof LETTERS)[number]);
  // follow the arrows to a plan with an acceptance number
  for (let guard = 0; guard < 40; guard++) {
    const s = l + a;
    if (AC[s] !== undefined) break;
    if (s < 14 || s === 16) l = Math.min(LETTERS.length - 1, l + 1);    // "↓" use the first plan below
    else l = Math.max(0, l - 1);                                            // "↑" use the first plan above
  }
  const accept = AC[l + a]!;
  const sample = SAMPLE[l]!;
  return { lotSize, level, aql, letter: LETTERS[l]!, sample: Math.min(sample, lotSize), accept, reject: accept + 1, all: sample >= lotSize };
}
