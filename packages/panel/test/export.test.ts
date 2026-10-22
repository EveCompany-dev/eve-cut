import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exportSequenceSrt, watchedFolders } from '../src/captions/export.js';
import type { PremiereAdapter } from '../src/premiere/adapter.js';

const SRT = '1\r\n00:00:00,000 --> 00:00:01,000\r\noi\r\n\r\n';

function adapter(onExport: (outPath: string, eprPath: string) => void): PremiereAdapter {
  return {
    status: async () => ({ appVersion: '26', projectPath: null, sequence: null }),
    exportCaptionsSrt: async (outPath, eprPath) => {
      onExport(outPath, eprPath);
      return { result: 'No Error', sequence: 'EVE_5246', durationMs: 1 };
    },
  };
}

describe('exportSequenceSrt', () => {
  let work: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'eve-cut-export-'));
  });

  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('returns the sidecar of this export and throws the audio away', async () => {
    let wav = '';
    let epr = '';
    writeFileSync(join(work, 'outro.srt'), SRT);
    const path = await exportSequenceSrt({
      adapter: adapter((outPath, eprPath) => {
        wav = outPath;
        epr = eprPath;
        writeFileSync(outPath, 'RIFF');
        writeFileSync(`${outPath}.srt`, SRT);
      }),
      extensionDir: 'C:\\ext\\eve-cut',
      workDir: work,
      sidecarWaitMs: 1000,
    });

    expect(path).toBe(`${wav}.srt`);
    expect(epr).toBe('C:\\ext\\eve-cut\\presets\\eve-cut-legendas.epr');
    expect(existsSync(wav)).toBe(false);
  });

  it('gives null when Premiere says "No Error" and writes nothing', async () => {
    const path = await exportSequenceSrt({ adapter: adapter(() => {}), extensionDir: 'C:\\x', workDir: work, sidecarWaitMs: 50 });
    expect(path).toBeNull();
  });
});

describe('watchedFolders', () => {
  it('watches the project folder and the last folder, once each', () => {
    expect(watchedFolders('C:\\Projetos\\Cliente\\video.prproj', 'c:\\projetos\\cliente')).toEqual(['C:\\Projetos\\Cliente']);
    expect(watchedFolders(null, 'D:\\Legendas')).toEqual(['D:\\Legendas']);
    expect(watchedFolders(null, null)).toEqual([]);
  });
});
