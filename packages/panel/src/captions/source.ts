import { readdirSync, readFileSync, statSync } from 'node:fs';
import { win32 } from 'node:path';

/** How long the panel waits for the sidecar `.srt` after "No Error" (P1: it may never come). */
export const SIDECAR_WAIT_MS = 10_000;
/** Plan B: how long the panel watches the folders for an `.srt` exported by hand (SPEC §5.1). */
export const WATCH_MS = 120_000;

/** `file:///C:/Users/.../eve-cut/index.html` → `C:\Users\...\eve-cut`. */
export function extensionDir(href: string): string {
  const url = new URL(href);
  const path = decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const host = url.host ? `\\\\${url.host}` : '';
  return win32.dirname(`${host}${path}`.replace(/\//g, '\\'));
}

/** Starts like an `.srt`: a block number and a timing line, after an optional BOM. */
export function looksLikeSrt(text: string): boolean {
  return /^\uFEFF?\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text);
}

export interface FoundSrt {
  path: string;
  modifiedMs: number;
}

/**
 * `.srt` files in `dirs` written since `sinceMs`, newest first. Only files that already look like a
 * caption file count, so a half-written one is picked on the next look. The sidecar name may carry
 * a suffix (language, track), so the match is by folder and time.
 */
export function findNewSrts(dirs: readonly (string | null | undefined)[], sinceMs: number): FoundSrt[] {
  const found: FoundSrt[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    if (!dir) continue;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/\.srt$/i.test(name)) continue;
      const path = win32.join(dir, name);
      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const stat = statSync(path);
        // File times can trail the clock by a moment; two seconds of slack.
        if (!stat.isFile() || stat.mtimeMs < sinceMs - 2000 || stat.size === 0) continue;
        if (!looksLikeSrt(readFileSync(path, 'utf8').slice(0, 400))) continue;
        found.push({ path, modifiedMs: stat.mtimeMs });
      } catch {
        continue;
      }
    }
  }
  return found.sort((a, b) => b.modifiedMs - a.modifiedMs);
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs?: number;
  signal?: AbortSignal;
  /** Extra filter on the full path, e.g. the sidecar of one export. */
  match?: (path: string) => boolean;
}

/** The newest `.srt` written since `sinceMs` in any of `dirs`, or `null` on timeout or abort. */
export async function waitForSrt(
  dirs: readonly (string | null | undefined)[],
  sinceMs: number,
  options: WaitOptions,
): Promise<string | null> {
  const deadline = Date.now() + options.timeoutMs;
  const interval = options.intervalMs ?? 500;

  for (;;) {
    if (options.signal?.aborted) return null;
    const found = findNewSrts(dirs, sinceMs).find((srt) => !options.match || options.match(srt.path));
    if (found) return found.path;
    if (Date.now() >= deadline) return null;
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())), options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
