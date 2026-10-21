import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { win32 } from 'node:path';

export interface LocateOptions {
  /** Path typed in ⚙ → Claude Code; wins when it exists. */
  configured?: string;
  /** `where.exe claude` output, one path per line. Injected by tests. */
  where?: () => Promise<string[]>;
  exists?: (path: string) => boolean;
}

/**
 * Find `claude.exe`: the configured path, then `where.exe claude`. The npm install puts a
 * `claude.cmd` shim on the PATH; the runner needs the real executable behind it, because spawning a
 * `.cmd` requires a shell and the shell drops empty arguments such as `--tools ""`.
 */
export async function locateClaude(options: LocateOptions = {}): Promise<string | null> {
  const exists = options.exists ?? existsSync;
  const configured = options.configured?.trim();
  if (configured && exists(configured)) return configured;

  let found: string[];
  try {
    found = await (options.where ?? whereClaude)();
  } catch {
    return null;
  }

  const candidates = found.map((line) => line.trim()).filter(Boolean);
  for (const candidate of candidates) {
    if (/\.exe$/i.test(candidate) && exists(candidate)) return candidate;
  }
  for (const candidate of candidates) {
    const exe = exeBehindShim(candidate);
    if (exe && exists(exe)) return exe;
  }
  return null;
}

/** `<npm global>\claude.cmd` (or the `.ps1` / extensionless twins) → the `claude.exe` it runs. */
export function exeBehindShim(shim: string): string | null {
  if (!/(^|[\\/])claude(\.cmd|\.ps1)?$/i.test(shim)) return null;
  return win32.join(win32.dirname(shim), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
}

function whereClaude(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile('where.exe', ['claude'], { windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.split(/\r?\n/));
    });
  });
}
