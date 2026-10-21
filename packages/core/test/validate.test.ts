import { describe, expect, it } from 'vitest';

import type { Batch } from '../src/batch/index.js';
import { migrate } from '../src/profile/index.js';
import type { ModelChange } from '../src/prompt/index.js';
import { editDistance, normalizedDistance, validateChanges } from '../src/validate/index.js';

const PROFILE = migrate({
  schema_version: 2,
  slug: '4s',
  client_name: '4S',
  subtitle_glossary: { proper_nouns: ['4S Estampas'], product_names: ['DTF'] },
});

const BATCH: Batch = {
  items: [
    { index: 1, text: 'contexto antes', editable: false },
    { index: 2, text: 'fazemos estampa em DTF', editable: true },
    { index: 3, text: 'aqui na 4S Estampas\na gente atende', editable: true },
    { index: 4, text: 'o tecido sai da esfumacao', editable: true },
    { index: 5, text: 'contexto depois', editable: false },
  ],
};

function check(change: Omit<ModelChange, 'kind'> & { kind?: ModelChange['kind'] }) {
  const [result] = validateChanges(BATCH, [{ kind: 'ortografia', ...change }], PROFILE);
  return result!;
}

function passes(change: Omit<ModelChange, 'kind'>): void {
  const result = check(change);
  expect(result.reason).toBeNull();
  expect(result.status).toBe('pendente');
}

function fails(change: Omit<ModelChange, 'kind'>, reason: RegExp): void {
  const result = check(change);
  expect(result.status).toBe('rejeitada_auto');
  expect(result.reason).toMatch(reason);
}

describe('validateChanges', () => {
  it('passes a plain correction and keeps kind, note and before/after', () => {
    const [result] = validateChanges(
      BATCH,
      [{ index: 4, text: 'o tecido sai da sublimação', kind: 'glossario', note: 'termo do cliente' }],
      PROFILE,
    );

    expect(result).toEqual({
      index: 4,
      before: 'o tecido sai da esfumacao',
      after: 'o tecido sai da sublimação',
      kind: 'glossario',
      source: 'claude',
      note: 'termo do cliente',
      status: 'pendente',
      reason: null,
    });
  });

  describe('rule 1: the index exists and is editable', () => {
    it('passes an editable block', () => passes({ index: 2, text: 'fazemos estampas em DTF' }));
    it('fails a block outside the batch', () => fails({ index: 9, text: 'x' }, /não está neste lote/));
    it('fails a context block', () => {
      fails({ index: 1, text: 'contexto antes.' }, /só contexto/);
      expect(check({ index: 1, text: 'contexto antes.' }).before).toBe('contexto antes');
    });
  });

  describe('rule 2: not empty and different', () => {
    it('passes a different text', () => passes({ index: 2, text: 'Fazemos estampa em DTF.' }));
    it('fails an empty text', () => fails({ index: 2, text: '  ' }, /vazio/));
    it('fails the same text', () => fails({ index: 2, text: 'fazemos estampa em DTF' }, /igual/));
  });

  describe('rule 3: same number of lines', () => {
    it('passes keeping the line break', () => passes({ index: 3, text: 'aqui na 4S Estampas,\na gente atende.' }));
    it('fails an extra line', () => fails({ index: 3, text: 'aqui na 4S Estampas\na gente\natende' }, /linhas \(2 → 3\)/));
    it('fails a merged line', () => fails({ index: 3, text: 'aqui na 4S Estampas a gente atende' }, /linhas \(2 → 1\)/));
  });

  describe('rule 4: length', () => {
    // 22 characters: the limit is max(27.5, 34) = 34.
    it('passes up to old + 12 on short blocks', () => passes({ index: 2, text: 'fazemos estampa em DTF, sim, sim!' }));
    it('fails beyond the limit', () =>
      fails({ index: 2, text: 'fazemos estampa em DTF e também em silk' }, /longo demais \(22 → 39/));
  });

  describe('rule 5: protected terms stay', () => {
    it('passes when the protected term is kept', () => passes({ index: 2, text: 'Fazemos estampa em DTF.' }));
    it('fails when a protected term is removed', () =>
      fails({ index: 3, text: 'aqui na 4S estampas\na gente atende' }, /termo protegido "4S Estampas"/));
    it('fails when a protected term is respelled', () => fails({ index: 2, text: 'fazemos estampa em D.T.F.' }, /"DTF"/));
  });

  describe('rule 6: no timing or block number', () => {
    it('passes numbers inside the speech', () => passes({ index: 2, text: 'fazemos 10 estampas em DTF' }));
    it('fails an arrow', () => fails({ index: 2, text: 'fazemos estampa --> DTF' }, /tempo ou número/));
    it('fails a timestamp', () => fails({ index: 2, text: 'fazemos 00:00:01,000 DTF' }, /tempo ou número/));
    it('fails a line with only a block number', () => fails({ index: 3, text: '12\naqui na 4S Estampas' }, /tempo ou número/));
  });

  describe('rule 7: edit distance', () => {
    it('passes a correction', () => passes({ index: 4, text: 'o tecido sai da sublimação' }));
    it('fails a rewrite', () => fails({ index: 4, text: 'a malha fica pronta já' }, /reescrita/));
  });

  it('keeps the first of a duplicated index and logs the second', () => {
    const log: string[] = [];

    const result = validateChanges(
      BATCH,
      [
        { index: 2, text: 'Fazemos estampa em DTF.', kind: 'pontuacao' },
        { index: 2, text: 'fazemos estampas em DTF', kind: 'ortografia' },
      ],
      PROFILE,
      { log: (message) => log.push(message) },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.after).toBe('Fazemos estampa em DTF.');
    expect(log).toEqual([expect.stringContaining('#2')]);
  });

  it('works without a profile', () => {
    expect(validateChanges(BATCH, [{ index: 2, text: 'fazemos estampa em D T F', kind: 'outro' }], null)[0]!.status).toBe(
      'pendente',
    );
  });
});

describe('distance', () => {
  it('counts accented letters as one character', () => {
    expect(editDistance('esfumacao', 'esfumação')).toBe(2);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(normalizedDistance('', '')).toBe(0);
    expect(normalizedDistance('abcd', 'abxd')).toBe(0.25);
  });
});
