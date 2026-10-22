import { readFileSync } from 'node:fs';

import { correctCaptions, decode, makeBatches, parse } from '@eve-cut/core';
import type { BatchRunner, CaptionJob, CorrectProgress, SrtBlock } from '@eve-cut/core';
import type { Profile } from '@eve-cut/core/profile';

import { hashSrt, jobIdFor } from './store.js';
import type { JobRecord, JobStore } from './store.js';

/** An `.srt` read from disk, ready to correct. */
export interface SrtInput {
  path: string;
  bytes: Uint8Array;
  hash: string;
  blocks: SrtBlock[];
  source: JobRecord['source'];
  sequenceName: string | null;
}

export class InputError extends Error {}

/** Read and parse the file; a file with no caption block is refused before any Claude call. */
export function readSrt(path: string, source: JobRecord['source'], sequenceName: string | null = null): SrtInput {
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
  } catch {
    throw new InputError(`Não consegui ler o arquivo ${path}.`);
  }
  return srtFromBytes(bytes, path, source, sequenceName);
}

/** Same as `readSrt` for bytes already in memory (a dropped file without a path on disk). */
export function srtFromBytes(
  bytes: Uint8Array,
  path: string,
  source: JobRecord['source'],
  sequenceName: string | null = null,
): SrtInput {
  const blocks = parse(decode(bytes));
  if (blocks.length === 0) throw new InputError('O arquivo não tem nenhum bloco de legenda.');
  return { path, bytes, hash: hashSrt(bytes), blocks, source, sequenceName };
}

/** Batches the job will run, for "Lote X de N" before the first one comes back. */
export function batchTotal(blocks: readonly SrtBlock[], batchSize: number): number {
  return makeBatches(blocks, batchSize, 3).length;
}

export interface RunJobOptions {
  input: SrtInput;
  profile: Profile | null;
  /** `null` = glossary only. */
  runner: BatchRunner | null;
  batchSize: number;
  store: JobStore;
  onProgress?: (progress: CorrectProgress) => void;
  signal?: AbortSignal;
  now?: () => Date;
}

/**
 * Correct and save. The job is saved even when batches failed or it was cancelled: what came back
 * is kept and the failed blocks stay as they were (invariant 5).
 */
export async function runJob(options: RunJobOptions): Promise<JobRecord> {
  const now = options.now ?? (() => new Date());
  const job: CaptionJob = await correctCaptions(options.input.blocks, options.profile, {
    runner: options.runner,
    batchSize: options.batchSize,
    onProgress: options.onProgress,
    signal: options.signal,
  });
  const previous = options.store.findByHash(options.input.hash);
  return options.store.save(
    {
      version: 1,
      id: jobIdFor(options.input.hash),
      srtHash: options.input.hash,
      srtPath: options.input.path,
      source: options.input.source,
      sequenceName: options.input.sequenceName,
      createdAt: previous?.createdAt ?? now().toISOString(),
      updatedAt: '',
      status: 'revisao',
      job,
    },
    now(),
  );
}
