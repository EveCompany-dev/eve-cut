import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BatchRunner } from '@eve-cut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { batchTotal, InputError, readSrt, runJob } from '../src/jobs/flow.js';
import { JobStore } from '../src/jobs/store.js';

const SRT = [
  '1',
  '00:00:00,000 --> 00:00:02,000',
  'a gente faz estampa em de teif',
  '',
  '2',
  '00:00:02,000 --> 00:00:04,000',
  'aqui em brusque',
  '',
  '',
].join('\r\n');

describe('readSrt / runJob', () => {
  let dir: string;
  let srt: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eve-cut-flow-'));
    srt = join(dir, 'seq.wav.srt');
    writeFileSync(srt, `\uFEFF${SRT}`, 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the file and refuses one without blocks', () => {
    const input = readSrt(srt, 'sequencia', 'EVE_5246');
    expect(input.blocks).toHaveLength(2);
    expect(input.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(batchTotal(input.blocks, 40)).toBe(1);

    const empty = join(dir, 'vazio.srt');
    writeFileSync(empty, '\r\n');
    expect(() => readSrt(empty, 'arquivo')).toThrow(InputError);
    expect(() => readSrt(join(dir, 'nada.srt'), 'arquivo')).toThrow(InputError);
  });

  it('saves the job and finds it again by the hash of the same file', async () => {
    const store = new JobStore(join(dir, 'jobs'));
    const runner: BatchRunner = async () => ({
      ok: true,
      data: { changes: [{ index: 2, text: 'aqui em Brusque', kind: 'nome_proprio' }] },
      durationMs: 5,
      raw: {},
    });
    const progress: number[] = [];

    const record = await runJob({
      input: readSrt(srt, 'sequencia', 'EVE_5246'),
      profile: null,
      runner,
      batchSize: 40,
      store,
      onProgress: (p) => progress.push(p.done),
    });

    expect(progress).toEqual([1]);
    expect(record.job.changes.map((c) => c.after)).toEqual(['aqui em Brusque']);
    expect(store.findByHash(readSrt(srt, 'arquivo').hash)?.id).toBe(record.id);
    expect(store.latestOpen()?.sequenceName).toBe('EVE_5246');
  });

  it('keeps the original text and records the error when Claude hits the limit', async () => {
    const store = new JobStore(dir);
    const runner: BatchRunner = async () => ({
      ok: false,
      kind: 'limit',
      message: 'Limite da assinatura do Claude atingido (resets Oct 23, 2am).',
      retryable: false,
    });

    const record = await runJob({ input: readSrt(srt, 'arquivo'), profile: null, runner, batchSize: 40, store });

    expect(record.job.changes).toEqual([]);
    expect(record.job.errors[0]?.kind).toBe('limit');
    expect(record.job.blocks.map((b) => b.text)).toEqual(['a gente faz estampa em de teif', 'aqui em brusque']);
  });
});
