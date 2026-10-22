import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extensionDir, findNewSrts, looksLikeSrt, waitForSrt } from '../src/captions/source.js';

const SRT = '\uFEFF1\r\n00:00:00,000 --> 00:00:02,469\r\nOlá\r\n\r\n';

describe('extensionDir', () => {
  it('turns the panel URL into the extension folder', () => {
    expect(extensionDir('file:///C:/Users/Jos%C3%A9/AppData/Roaming/Adobe/CEP/extensions/eve-cut/index.html')).toBe(
      'C:\\Users\\José\\AppData\\Roaming\\Adobe\\CEP\\extensions\\eve-cut',
    );
  });
});

describe('looksLikeSrt', () => {
  it('accepts an .srt with or without BOM and refuses anything else', () => {
    expect(looksLikeSrt(SRT)).toBe(true);
    expect(looksLikeSrt('1\n00:00:01.000 --> 00:00:02.000\nx')).toBe(true);
    expect(looksLikeSrt('')).toBe(false);
    expect(looksLikeSrt('WEBVTT\n\n00:00.000 --> 00:01.000')).toBe(false);
  });
});

describe('findNewSrts / waitForSrt', () => {
  let dir: string;
  let other: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eve-cut-src-'));
    other = mkdtempSync(join(tmpdir(), 'eve-cut-src-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });

  it('finds only new, non-empty caption files, newest first', () => {
    const since = Date.now();
    const old = join(dir, 'antigo.srt');
    writeFileSync(old, SRT);
    utimesSync(old, new Date(since - 60_000), new Date(since - 60_000));
    writeFileSync(join(dir, 'vazio.srt'), '');
    writeFileSync(join(dir, 'texto.srt'), 'não é legenda');
    writeFileSync(join(dir, 'audio.wav'), 'RIFF');
    const a = join(dir, 'a.wav.srt');
    const b = join(other, 'b.srt');
    writeFileSync(a, SRT);
    writeFileSync(b, SRT);
    utimesSync(a, new Date(since + 1000), new Date(since + 1000));
    utimesSync(b, new Date(since + 5000), new Date(since + 5000));

    const found = findNewSrts([dir, null, other, join(dir, 'não-existe')], since);

    expect(found.map((f) => f.path)).toEqual([b, a]);
  });

  it('waits until the file shows up', async () => {
    const since = Date.now();
    const target = join(dir, 'saida.wav.srt');
    setTimeout(() => writeFileSync(target, SRT), 60);

    await expect(waitForSrt([dir], since, { timeoutMs: 2000, intervalMs: 20 })).resolves.toBe(target);
  });

  it('gives up on timeout and on abort', async () => {
    await expect(waitForSrt([dir], Date.now(), { timeoutMs: 50, intervalMs: 10 })).resolves.toBeNull();

    const controller = new AbortController();
    const waiting = waitForSrt([dir], Date.now(), { timeoutMs: 10_000, intervalMs: 5000, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(waiting).resolves.toBeNull();
  });
});
