import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, win32 } from 'node:path';

import { appDataDir } from '../bridge/paths.js';
import { CLAUDE_MODELS } from '../claude/runner.js';
import type { ClaudeModel } from '../claude/runner.js';

export const BATCH_SIZE_MIN = 10;
export const BATCH_SIZE_MAX = 80;
export const BATCH_SIZE_DEFAULT = 40;

/** `%APPDATA%\eve-cut\settings.json` (SPEC §10). */
export interface Settings {
  version: 1;
  claude: {
    /** Empty = find it with `where.exe claude`. */
    exePath: string;
    model: ClaudeModel;
    batchSize: number;
  };
  captions: {
    /** Slug of the client picked last time. */
    lastClient: string | null;
    /** Folder of the last `.srt` opened by hand; watched when the automatic export fails. */
    lastFolder: string | null;
  };
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    claude: { exePath: '', model: 'sonnet', batchSize: BATCH_SIZE_DEFAULT },
    captions: { lastClient: null, lastFolder: null },
  };
}

export function settingsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(appDataDir(env), 'eve-cut', 'settings.json');
}

/**
 * Settings from whatever is in the file. Field by field: one bad value falls back to its default
 * without throwing the rest away.
 */
export function normalizeSettings(raw: unknown): Settings {
  const out = defaultSettings();
  const root = asRecord(raw);
  const claude = asRecord(root['claude']);
  const captions = asRecord(root['captions']);

  if (typeof claude['exePath'] === 'string') out.claude.exePath = claude['exePath'].trim();
  if (CLAUDE_MODELS.includes(claude['model'] as ClaudeModel)) out.claude.model = claude['model'] as ClaudeModel;
  out.claude.batchSize = clampBatchSize(claude['batchSize']);

  if (typeof captions['lastClient'] === 'string' && captions['lastClient']) out.captions.lastClient = captions['lastClient'];
  if (typeof captions['lastFolder'] === 'string' && captions['lastFolder']) out.captions.lastFolder = captions['lastFolder'];
  return out;
}

/** Whole number between 10 and 80; anything else is the default 40. */
export function clampBatchSize(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return BATCH_SIZE_DEFAULT;
  return Math.min(BATCH_SIZE_MAX, Math.max(BATCH_SIZE_MIN, Math.round(n)));
}

/** A missing or broken file gives the defaults; the broken file stays until the next save. */
export function loadSettings(file: string = settingsFilePath()): Settings {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return defaultSettings();
  }
}

/** Temp file + rename, so a crash mid-write never leaves half a settings file. */
export function saveSettings(settings: Settings, file: string = settingsFilePath()): Settings {
  const clean = normalizeSettings(settings);
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  try {
    writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
  return clean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
