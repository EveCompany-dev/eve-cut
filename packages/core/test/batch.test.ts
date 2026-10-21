import { describe, expect, it } from 'vitest';

import { makeBatches } from '../src/batch/index.js';
import type { SrtBlock } from '../src/srt/index.js';

function blocks(count: number): SrtBlock[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    num: String(i + 1),
    timing: '00:00:01,000 --> 00:00:02,000 X1:100',
    text: `bloco ${i + 1}`,
  }));
}

describe('makeBatches', () => {
  it('splits 46 blocks into 2 batches of 40 + 6', () => {
    const batches = makeBatches(blocks(46));

    expect(batches).toHaveLength(2);
    expect(batches[0]!.items.filter((i) => i.editable)).toHaveLength(40);
    expect(batches[1]!.items.filter((i) => i.editable)).toHaveLength(6);
  });

  it('gives context only after the first batch and only before the last', () => {
    const [first, last] = makeBatches(blocks(46));

    expect(first!.items.map((i) => i.index)).toEqual([...range(1, 40), 41, 42, 43]);
    expect(first!.items.slice(40).every((i) => !i.editable)).toBe(true);
    expect(last!.items.map((i) => i.index)).toEqual([38, 39, 40, ...range(41, 46)]);
    expect(last!.items.slice(0, 3).every((i) => !i.editable)).toBe(true);
  });

  it('gives middle batches context on both sides', () => {
    const middle = makeBatches(blocks(30), 10)[1]!;

    expect(middle.items.map((i) => [i.index, i.editable])).toEqual([
      [8, false],
      [9, false],
      [10, false],
      ...range(11, 20).map((n) => [n, true]),
      [21, false],
      [22, false],
      [23, false],
    ]);
  });

  it('makes every block editable exactly once', () => {
    for (const [count, size, context] of [[46, 40, 3], [100, 10, 3], [7, 3, 5], [1, 40, 3], [80, 80, 3]] as const) {
      const editable = makeBatches(blocks(count), size, context).flatMap((b) =>
        b.items.filter((i) => i.editable).map((i) => i.index),
      );
      expect(editable).toEqual(range(1, count));
    }
  });

  it('never sends the timing line', () => {
    for (const batch of makeBatches(blocks(46))) {
      for (const item of batch.items) {
        expect(Object.keys(item).sort()).toEqual(['editable', 'index', 'text']);
        expect(JSON.stringify(item)).not.toContain('-->');
      }
    }
  });

  it('handles no blocks, no context and invalid sizes', () => {
    expect(makeBatches([])).toEqual([]);
    expect(makeBatches(blocks(5), 2, 0).map((b) => b.items.length)).toEqual([2, 2, 1]);
    expect(() => makeBatches(blocks(5), 0)).toThrow(RangeError);
    expect(() => makeBatches(blocks(5), 10, -1)).toThrow(RangeError);
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
