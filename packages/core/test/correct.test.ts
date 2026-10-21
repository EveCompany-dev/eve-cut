import { describe, expect, it } from 'vitest';

import type { ClaudeRunResult } from '../src/claude/index.js';
import { correctCaptions, wordDiff, type BatchRunner } from '../src/correct/index.js';
import { migrate } from '../src/profile/index.js';
import type { ModelChange } from '../src/prompt/index.js';
import type { SrtBlock } from '../src/srt/index.js';

const PROFILE = migrate({
  schema_version: 2,
  slug: '4s-estampas',
  client_name: '4S Estampas',
  subtitle_glossary: { terms: [{ wrong: 'de teif', correct: 'DTF' }], proper_nouns: ['Brusque'] },
});

function blocks(texts: string[]): SrtBlock[] {
  return texts.map((text, i) => ({
    index: i + 1,
    num: String(i + 1),
    timing: `00:00:${String(i).padStart(2, '0')},000 --> 00:00:${String(i).padStart(2, '0')},900`,
    text,
  }));
}

function numbered(count: number): SrtBlock[] {
  return blocks(Array.from({ length: count }, (_, i) => `bloco numero ${i + 1}`));
}

function ok(changes: ModelChange[]): ClaudeRunResult {
  return { ok: true, data: { changes }, durationMs: 10, raw: {} };
}

/** Runner that answers from a function of the batch's editable indexes. */
function runnerFrom(answer: (editable: number[]) => ClaudeRunResult | Promise<ClaudeRunResult>): BatchRunner {
  return async ({ batch }) => answer(batch.items.filter((i) => i.editable).map((i) => i.index));
}

describe('correctCaptions', () => {
  it('glossary-only mode runs just the exact glossary', async () => {
    const job = await correctCaptions(blocks(['fazemos estampa em de teif', 'nada']), PROFILE, { runner: null });

    expect(job.mode).toBe('glossario');
    expect(job.batchCount).toBe(0);
    expect(job.changes).toEqual([
      {
        id: '1:regra',
        index: 1,
        before: 'fazemos estampa em de teif',
        after: 'fazemos estampa em DTF',
        kind: 'glossario',
        source: 'regra',
        status: 'pendente',
        reason: null,
        ruleText: null,
        review: 'pendente',
        editedText: null,
      },
    ]);
  });

  it('sends the glossary-corrected text to Claude and combines both changes in one item', async () => {
    const seen: string[] = [];
    const runner: BatchRunner = async ({ userPrompt, systemPrompt }) => {
      seen.push(userPrompt);
      expect(systemPrompt).toContain('4S Estampas');
      return ok([{ index: 1, text: 'Fazemos estampa em DTF.', kind: 'pontuacao' }]);
    };

    const job = await correctCaptions(blocks(['fazemos estampa em de teif']), PROFILE, { runner });

    expect(seen[0]).toContain('fazemos estampa em DTF');
    expect(seen[0]).not.toContain('de teif');
    expect(job.changes).toHaveLength(1);
    expect(job.changes[0]).toMatchObject({
      id: '1:claude',
      before: 'fazemos estampa em de teif',
      ruleText: 'fazemos estampa em DTF',
      after: 'Fazemos estampa em DTF.',
      kind: 'pontuacao',
      source: 'claude',
      status: 'pendente',
    });
  });

  it('keeps the glossary change when Claude omits the block', async () => {
    const job = await correctCaptions(blocks(['em de teif', 'outro bloco']), PROFILE, {
      runner: runnerFrom(() => ok([{ index: 2, text: 'Outro bloco.', kind: 'pontuacao' }])),
    });

    expect(job.changes.map((c) => [c.id, c.after])).toEqual([
      ['1:regra', 'em DTF'],
      ['2:claude', 'Outro bloco.'],
    ]);
  });

  it('leaves a block Claude omits with its original text', async () => {
    const input = blocks(['primeiro bloco', 'segundo bloco']);

    const job = await correctCaptions(input, PROFILE, { runner: runnerFrom(() => ok([])) });

    expect(job.changes).toEqual([]);
    expect(job.blocks).toEqual(input);
  });

  it('keeps the glossary change as its own item when Claude\'s change is rejected', async () => {
    const job = await correctCaptions(blocks(['em de teif']), PROFILE, {
      runner: runnerFrom(() => ok([{ index: 1, text: 'uma frase completamente diferente aqui', kind: 'outro' }])),
    });

    expect(job.changes.map((c) => [c.id, c.status])).toEqual([
      ['1:regra', 'pendente'],
      ['1:claude', 'rejeitada_auto'],
    ]);
    expect(job.changes[1]!.ruleText).toBe('em DTF');
  });

  it('a failed batch does not lose the others and is recorded in the job', async () => {
    const job = await correctCaptions(numbered(25), PROFILE, {
      batchSize: 10,
      runner: runnerFrom((editable) =>
        editable[0] === 11
          ? { ok: false, kind: 'timeout', message: 'O Claude demorou demais neste lote.', retryable: false }
          : ok(editable.map((index) => ({ index, text: `bloco número ${index}`, kind: 'ortografia' as const }))),
      ),
    });

    expect(job.batchCount).toBe(3);
    expect(job.errors).toEqual([
      { batch: 2, from: 11, to: 20, kind: 'timeout', message: 'O Claude demorou demais neste lote.' },
    ]);
    expect(job.changes.map((c) => c.index)).toEqual([...range(1, 10), ...range(21, 25)]);
  });

  it('records an invalid answer and a thrown runner as batch errors', async () => {
    const job = await correctCaptions(numbered(20), PROFILE, {
      batchSize: 10,
      runner: runnerFrom((editable) => {
        if (editable[0] === 1) return { ok: true, data: { changes: [{ index: 1 }] }, durationMs: 1, raw: {} };
        throw new Error('spawn falhou');
      }),
    });

    expect(job.errors.map((e) => [e.batch, e.kind])).toEqual([
      [1, 'invalid'],
      [2, 'failed'],
    ]);
    expect(job.changes).toEqual([]);
  });

  it('stops starting batches after the usage limit', async () => {
    let calls = 0;
    const job = await correctCaptions(numbered(50), PROFILE, {
      batchSize: 10,
      concurrency: 1,
      runner: async () => {
        calls++;
        return { ok: false, kind: 'limit', message: 'Limite da assinatura do Claude atingido (resets).', retryable: false };
      },
    });

    expect(calls).toBe(1);
    expect(job.errors).toHaveLength(5);
    expect(job.errors.every((e) => e.kind === 'limit')).toBe(true);
  });

  it('reports progress once per batch', async () => {
    const progress: unknown[] = [];

    await correctCaptions(numbered(25), PROFILE, {
      batchSize: 10,
      concurrency: 1,
      runner: runnerFrom(() => ok([])),
      onProgress: (p) => progress.push(p),
    });

    expect(progress).toEqual([
      { done: 1, total: 3, batch: 1, ok: true },
      { done: 2, total: 3, batch: 2, ok: true },
      { done: 3, total: 3, batch: 3, ok: true },
    ]);
  });

  it('runs batches in parallel, capped by the concurrency', async () => {
    let running = 0;
    let peak = 0;

    await correctCaptions(numbered(50), PROFILE, {
      batchSize: 10,
      runner: async () => {
        running++;
        peak = Math.max(peak, running);
        await delay(20);
        running--;
        return ok([]);
      },
    });

    expect(peak).toBe(2);
  });

  it('cancels: stops the remaining batches and keeps what already came back', async () => {
    const controller = new AbortController();
    const job = await correctCaptions(numbered(40), PROFILE, {
      batchSize: 10,
      concurrency: 1,
      signal: controller.signal,
      runner: runnerFrom(async (editable) => {
        if (editable[0] === 11) {
          controller.abort();
          await delay(50);
        }
        return ok([{ index: editable[0]!, text: `bloco número ${editable[0]}`, kind: 'ortografia' }]);
      }),
    });

    expect(job.cancelled).toBe(true);
    expect(job.changes.map((c) => c.index)).toEqual([1]);
    expect(job.notRun).toEqual([2, 3, 4]);
  });

  it('works without a profile', async () => {
    const job = await correctCaptions(blocks(['de teif']), null, {
      runner: runnerFrom(() => ok([{ index: 1, text: 'DTF', kind: 'glossario' }])),
    });

    expect(job.profileSlug).toBeNull();
    expect(job.changes.map((c) => c.id)).toEqual(['1:claude']);
  });
});

describe('wordDiff', () => {
  it('shows a multi-word swap as one change', () => {
    expect(wordDiff('a gente faz estampa em de teif', 'a gente faz estampa em DTF')).toEqual([
      { op: 'igual', text: 'a gente faz estampa em ' },
      { op: 'removido', text: 'de teif' },
      { op: 'inserido', text: 'DTF' },
    ]);
  });

  it('separates punctuation from words', () => {
    expect(wordDiff('aqui na quatro s estampas', 'Aqui na 4S Estampas.')).toEqual([
      { op: 'removido', text: 'aqui' },
      { op: 'inserido', text: 'Aqui' },
      { op: 'igual', text: ' na ' },
      { op: 'removido', text: 'quatro s estampas' },
      { op: 'inserido', text: '4S Estampas.' },
    ]);
  });

  it('rebuilds both texts from the segments', () => {
    const pairs: Array<[string, string]> = [
      ['', 'novo texto'],
      ['texto velho', ''],
      ['igual', 'igual'],
      ['linha um\nlinha dois', 'linha um,\nlinha 2'],
      ['é a sublimação têxtil', 'é a sublimação  têxtil!'],
    ];
    for (const [before, after] of pairs) {
      const segments = wordDiff(before, after);
      expect(segments.filter((s) => s.op !== 'inserido').map((s) => s.text).join('')).toBe(before);
      expect(segments.filter((s) => s.op !== 'removido').map((s) => s.text).join('')).toBe(after);
    }
  });
});

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
