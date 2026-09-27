/**
 * Why BAMS-style multi-master merging is NOT used for production facts (docs/ecosystem/08 §E8.1,
 * ADR-027). Executable demonstration: the same physical events recorded on two offline terminals,
 * merged the BAMS way (PN-counter deltas, last-writer-wins registers), versus the authoritative
 * command model manufacturing uses. Pure simulation; no server needed.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

type Delta = { node: string; serial: string; delta: number };

/** BAMS counter semantics: every movement is a delta, added exactly once per delta (not per physical thing). */
const counterMerge = (...logs: Delta[][]) => logs.flat().reduce((sum, d) => sum + d.delta, 0);

/** BAMS register semantics for one field: highest (hlc, origin) wins. */
const lww = (...writes: { hlc: number; origin: string; value: string }[]) =>
  [...writes].sort((a, b) => b.hlc - a.hlc || (a.origin < b.origin ? 1 : -1))[0]!.value;

/** Manufacturing: one authority, commands keyed by id, facts checked against global state before they exist. */
function authority(planned: number) {
  const done = new Set<string>();
  const commands = new Set<string>();
  let completed = 0;
  return {
    complete(commandId: string, serial: string): 'ok' | 'replayed' | 'serial.already_completed' | 'wo.over_complete' {
      if (commands.has(commandId)) return 'replayed';
      if (done.has(serial)) return 'serial.already_completed';
      if (completed + 1 > planned) return 'wo.over_complete';
      commands.add(commandId);
      done.add(serial);
      completed++;
      return 'ok';
    },
    get completed() {
      return completed;
    },
  };
}

describe('offline multi-master merge breaks production truth; the authoritative model keeps it', () => {
  test('identity: one serial scanned on two offline terminals is counted twice by a counter merge', () => {
    const a: Delta[] = [{ node: 'A', serial: 'SN-1', delta: 1 }];
    const b: Delta[] = [{ node: 'B', serial: 'SN-1', delta: 1 }];
    assert.equal(counterMerge(a, b), 2, 'merge says two units were made; one was');
    const plant = authority(10);
    assert.equal(plant.complete('term-A-0001', 'SN-1'), 'ok');
    assert.equal(plant.complete('term-B-0001', 'SN-1'), 'serial.already_completed');
    assert.equal(plant.completed, 1);
  });

  test('facts are not overwritable: concurrent "good" and "scrap" on one unit, LWW silently keeps one', () => {
    const shown = lww({ hlc: 100, origin: 'A', value: 'good' }, { hlc: 100, origin: 'B', value: 'scrap' });
    assert.equal(shown, 'scrap', 'the good report vanished without anyone deciding');
    // BAMS surfaces this as a conflict "to decide" — right for a description, wrong for a physical fact that already happened twice.
  });

  test('conservation: two offline terminals each accept up to the plan, the merge exceeds it', () => {
    const planned = 5;
    const offlineTerminal = (node: string) => Array.from({ length: planned }, (_, i) => ({ node, serial: `${node}-${i}`, delta: 1 }));
    assert.equal(counterMerge(offlineTerminal('A'), offlineTerminal('B')), 10, 'completed 10 of a 5-unit order: no merge rule can undo that');
    const plant = authority(planned);
    const outcomes = [...offlineTerminal('A'), ...offlineTerminal('B')].map((d, i) => plant.complete(`cmd-${i}`, d.serial));
    assert.equal(outcomes.filter((o) => o === 'ok').length, planned);
    assert.equal(outcomes.filter((o) => o === 'wo.over_complete').length, planned, 'the excess is refused and visible, not merged');
  });

  test('delivery: a retried command after a lost answer is booked once', () => {
    const plant = authority(3);
    assert.equal(plant.complete('term-A-0007', 'SN-7'), 'ok');
    assert.equal(plant.complete('term-A-0007', 'SN-7'), 'replayed');
    assert.equal(plant.completed, 1);
  });

  test('escrow (the future safe offline mode) keeps conservation: each terminal may only spend its own quota', () => {
    const planned = 5;
    const quota: Record<string, number> = { A: 3, B: 2 }; // handed out by the authority BEFORE going offline
    const spend = (node: string, want: number) => Math.min(want, quota[node]!);
    const made = spend('A', 5) + spend('B', 5);
    assert.ok(made <= planned);
  });
});
