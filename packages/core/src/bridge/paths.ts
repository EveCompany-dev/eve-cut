import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, win32 } from 'node:path';

/** Contents of `%APPDATA%\eve-cut\bridge.json`, rewritten by the panel every time it opens. */
export interface BridgeInfo {
  port: number;
  /** 64 hex chars, new on every panel open (`crypto.randomBytes(32)`). */
  token: string;
  pid: number;
  startedAt: string;
}

/** `%APPDATA%` on Windows; tests and non-Windows development keep the same layout under the home. */
export function appDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const appData = env['APPDATA'];
  if (appData) return appData;
  return win32.join(homedir(), 'AppData', 'Roaming');
}

export function bridgeFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(appDataDir(env), 'eve-cut', 'bridge.json');
}

export function readBridgeInfo(filePath: string = bridgeFilePath()): BridgeInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`Não achei a ponte do eve-cut (${filePath}). Abra o painel no Premiere.`);
  }

  const info = parsed as Partial<BridgeInfo>;
  if (typeof info.port !== 'number' || typeof info.token !== 'string') {
    throw new Error(`O arquivo da ponte está inválido: ${filePath}`);
  }

  return {
    port: info.port,
    token: info.token,
    pid: typeof info.pid === 'number' ? info.pid : 0,
    startedAt: typeof info.startedAt === 'string' ? info.startedAt : '',
  };
}

export function writeBridgeInfo(info: BridgeInfo, filePath: string = bridgeFilePath()): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}
