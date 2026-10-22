import { rmSync } from 'node:fs';
import { win32 } from 'node:path';

import type { PremiereAdapter } from '../premiere/adapter.js';
import { SIDECAR_WAIT_MS, waitForSrt, WATCH_MS } from './source.js';

export const EXPORT_FAILED_MESSAGE =
  'Não consegui exportar as legendas sozinho. Confira se a primeira faixa de legenda (C1) tem as legendas, ou exporte pelo menu Arquivo → Exportar → Legendas…; eu pego o arquivo assim que ele aparecer.';

export const CAPTIONS_PRESET = 'eve-cut-legendas.epr';

export interface ExportOptions {
  adapter: PremiereAdapter;
  /** Folder of the installed panel; the preset is in `presets\` next to `index.html`. */
  extensionDir: string;
  workDir: string;
  sidecarWaitMs?: number;
  now?: () => number;
}

/**
 * P1: export the sequence to `work\captions-<time>.wav` and wait for the sidecar `.srt`. Returns its
 * path, or `null` when Premiere said "No Error" and wrote nothing (no captions in C1). Errors from
 * the host (no sequence, missing preset) are thrown with their pt-BR message.
 */
export async function exportSequenceSrt(options: ExportOptions): Promise<string | null> {
  const now = options.now ?? Date.now;
  const since = now();
  const outPath = win32.join(options.workDir, `captions-${since}.wav`);
  const eprPath = win32.join(options.extensionDir, 'presets', CAPTIONS_PRESET);

  try {
    await options.adapter.exportCaptionsSrt(outPath, eprPath);
    // The sidecar is `<wav>.srt`, maybe with a suffix; an older export in the same folder never counts.
    const prefix = win32.basename(outPath).toLowerCase();
    return await waitForSrt([options.workDir], since, {
      timeoutMs: options.sidecarWaitMs ?? SIDECAR_WAIT_MS,
      match: (path) => win32.basename(path).toLowerCase().startsWith(prefix),
    });
  } finally {
    // Only the captions matter; the audio render is thrown away. A locked file just stays in `work`.
    try {
      rmSync(outPath, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Plan B (SPEC §5.1): the folders watched for an `.srt` José exports by hand. */
export function watchedFolders(projectPath: string | null, lastFolder: string | null): string[] {
  const dirs = [projectPath ? win32.dirname(projectPath) : null, lastFolder];
  const unique: string[] = [];
  for (const dir of dirs) {
    if (dir && !unique.some((other) => other.toLowerCase() === dir.toLowerCase())) unique.push(dir);
  }
  return unique;
}

export function watchForSrt(dirs: string[], since: number, signal: AbortSignal): Promise<string | null> {
  return waitForSrt(dirs, since, { timeoutMs: WATCH_MS, intervalMs: 1000, signal });
}
