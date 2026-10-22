import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clampBatchSize,
  defaultSettings,
  loadSettings,
  normalizeSettings,
  saveSettings,
  settingsFilePath,
} from '../src/settings/index.js';

describe('normalizeSettings', () => {
  it('gives the defaults for anything that is not an object', () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings());
    expect(normalizeSettings('x')).toEqual(defaultSettings());
    expect(defaultSettings().claude).toEqual({ exePath: '', model: 'sonnet', batchSize: 40 });
  });

  it('keeps the good fields and drops only the bad ones', () => {
    const settings = normalizeSettings({
      claude: { exePath: '  C:\\claude.exe ', model: 'gpt', batchSize: 25 },
      captions: { lastClient: '4s-estampas', lastFolder: 42 },
    });

    expect(settings.claude).toEqual({ exePath: 'C:\\claude.exe', model: 'sonnet', batchSize: 25 });
    expect(settings.captions).toEqual({ lastClient: '4s-estampas', lastFolder: null });
  });
});

describe('clampBatchSize', () => {
  it('keeps the batch size between 10 and 80', () => {
    expect(clampBatchSize(5)).toBe(10);
    expect(clampBatchSize(200)).toBe(80);
    expect(clampBatchSize('33')).toBe(33);
    expect(clampBatchSize(32.6)).toBe(33);
    expect(clampBatchSize('abc')).toBe(40);
    expect(clampBatchSize(undefined)).toBe(40);
  });
});

describe('settings file', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eve-cut-settings-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lives in %APPDATA%\\eve-cut', () => {
    expect(settingsFilePath({ APPDATA: 'C:\\Users\\jose\\AppData\\Roaming' })).toBe(
      'C:\\Users\\jose\\AppData\\Roaming\\eve-cut\\settings.json',
    );
  });

  it('round-trips through the disk', () => {
    const file = join(dir, 'sub', 'settings.json');
    const settings = defaultSettings();
    settings.claude.model = 'opus';
    settings.captions.lastClient = 'cliente';

    saveSettings(settings, file);

    expect(loadSettings(file)).toEqual(settings);
    expect(JSON.parse(readFileSync(file, 'utf8')).claude.model).toBe('opus');
  });

  it('falls back to the defaults when the file is missing or broken', () => {
    const file = join(dir, 'settings.json');
    expect(loadSettings(file)).toEqual(defaultSettings());

    writeFileSync(file, '{ quebrado', 'utf8');
    expect(loadSettings(file)).toEqual(defaultSettings());
  });
});
