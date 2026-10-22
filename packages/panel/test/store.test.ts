import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CaptionJob } from '@eve-cut/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defaultJobsDir, hashSrt, jobIdFor, JobStore } from '../src/jobs/store.js';
import type { JobRecord } from '../src/jobs/store.js';

function job(): CaptionJob {
  return {
    profileSlug: '4s-estampas',
    mode: 'claude',
    blocks: [{ index: 1, num: '1', timing: '00:00:00,000 --> 00:00:01,000', text: 'oi' }],
    changes: [],
    batchCount: 1,
    errors: [],
    notRun: [],
    cancelled: false,
    log: [],
  };
}

function record(bytes: string, status: JobRecord['status'] = 'revisao'): JobRecord {
  const srtHash = hashSrt(Buffer.from(bytes, 'utf8'));
  return {
    version: 1,
    id: jobIdFor(srtHash),
    srtHash,
    srtPath: 'C:\\x.srt',
    source: 'arquivo',
    sequenceName: null,
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '',
    status,
    job: job(),
  };
}

describe('JobStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eve-cut-jobs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lives in %APPDATA%\\eve-cut\\jobs and keys jobs by the .srt hash', () => {
    expect(defaultJobsDir({ APPDATA: 'C:\\A' })).toBe('C:\\A\\eve-cut\\jobs');
    expect(hashSrt(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(jobIdFor('ba7816bf8f01cfea414140de5dae2223')).toBe('ba7816bf8f01cfea');
  });

  it('saves and finds a job by the hash of the same file', () => {
    const store = new JobStore(join(dir, 'jobs'));
    const saved = store.save(record('srt A'), new Date('2026-10-22T11:00:00.000Z'));

    expect(saved.updatedAt).toBe('2026-10-22T11:00:00.000Z');
    expect(store.findByHash(saved.srtHash)).toEqual(saved);
    expect(store.findByHash(hashSrt(Buffer.from('srt B')))).toBeNull();
  });

  it('restores the last job still in review, skipping applied and broken files', () => {
    const store = new JobStore(dir);
    store.save(record('primeiro'), new Date('2026-10-22T11:00:00.000Z'));
    const second = store.save(record('segundo'), new Date('2026-10-22T12:00:00.000Z'));
    store.save(record('aplicado', 'aplicado'), new Date('2026-10-22T13:00:00.000Z'));
    writeFileSync(join(dir, '0123456789abcdef.json'), '{ quebrado');

    expect(store.latestOpen()?.id).toBe(second.id);
    expect(new JobStore(join(dir, 'nada')).latestOpen()).toBeNull();
  });
});
