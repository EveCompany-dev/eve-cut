import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';

import type { CaptionJob } from '@eve-cut/core';
import { appDataDir } from '@eve-cut/core/bridge';

/** `revisao` until F1-11 applies it; an applied job is not restored when the panel opens. */
export type JobStatus = 'revisao' | 'aplicado';

/** `%APPDATA%\eve-cut\jobs\<id>.json` (SPEC §4). */
export interface JobRecord {
  version: 1;
  /** First 16 hex chars of the `.srt` hash: one job per caption file. */
  id: string;
  srtHash: string;
  /** Where the `.srt` is on disk (the export in `work`, or the file José picked). */
  srtPath: string;
  /** `sequencia` = exported by the panel; `arquivo` = dropped or picked by hand. */
  source: 'sequencia' | 'arquivo';
  sequenceName: string | null;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  job: CaptionJob;
}

export function defaultJobsDir(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(appDataDir(env), 'eve-cut', 'jobs');
}

/** sha256 of the `.srt` bytes, hex. The same file always maps to the same job. */
export function hashSrt(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function jobIdFor(srtHash: string): string {
  return srtHash.slice(0, 16);
}

/** Jobs on disk. The folder is injected so tests use a temp dir. */
export class JobStore {
  constructor(readonly dir: string = defaultJobsDir()) {}

  /** Writes the record with a fresh `updatedAt`: temp file + rename, never half a job. */
  save(record: JobRecord, now: Date = new Date()): JobRecord {
    const saved: JobRecord = { ...record, updatedAt: now.toISOString() };
    const file = this.fileFor(saved.id);
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    mkdirSync(this.dir, { recursive: true });
    try {
      writeFileSync(tmp, `${JSON.stringify(saved)}\n`, 'utf8');
      renameSync(tmp, file);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
    return saved;
  }

  findByHash(srtHash: string): JobRecord | null {
    const record = this.read(this.fileFor(jobIdFor(srtHash)));
    return record && record.srtHash === srtHash ? record : null;
  }

  /** The job touched last that is still in review: what the panel shows when it opens. */
  latestOpen(): JobRecord | null {
    let latest: JobRecord | null = null;
    for (const record of this.all()) {
      if (record.status !== 'revisao') continue;
      if (!latest || record.updatedAt > latest.updatedAt) latest = record;
    }
    return latest;
  }

  private all(): JobRecord[] {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return [];
    }
    const out: JobRecord[] = [];
    for (const name of names) {
      if (!/^[0-9a-f]{16}\.json$/.test(name)) continue;
      const record = this.read(join(this.dir, name));
      if (record) out.push(record);
    }
    return out;
  }

  /** A broken or foreign file is skipped, never thrown: it must not block the panel. */
  private read(file: string): JobRecord | null {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<JobRecord>;
      if (parsed.version !== 1 || typeof parsed.id !== 'string' || typeof parsed.srtHash !== 'string') return null;
      if (!parsed.job || !Array.isArray(parsed.job.blocks) || !Array.isArray(parsed.job.changes)) return null;
      return parsed as JobRecord;
    } catch {
      return null;
    }
  }

  private fileFor(id: string): string {
    if (!/^[0-9a-f]{16}$/.test(id)) throw new Error(`Id de job inválido: "${id}".`);
    return join(this.dir, `${id}.json`);
  }
}
