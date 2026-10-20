const TIMESTAMP = /(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})/g;

/**
 * `00:00:01,000 --> 00:00:03,500 X1:100 X2:200` -> `{ startMs: 1000, endMs: 3500 }`.
 *
 * Anything after the two timestamps (Premiere's position suffix) is ignored.
 */
export function parseTiming(timing: string): { startMs: number; endMs: number } {
  TIMESTAMP.lastIndex = 0;
  const start = TIMESTAMP.exec(timing);
  const end = start === null ? null : TIMESTAMP.exec(timing);

  if (start === null || end === null) {
    throw new Error(`Linha de tempo inválida: ${timing}`);
  }

  return { startMs: toMs(start), endMs: toMs(end) };
}

/** `3723456` -> `01:02:03,456`. */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`Tempo inválido: ${ms}`);
  }

  const total = Math.round(ms);
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor(total / 60_000) % 60;
  const seconds = Math.floor(total / 1000) % 60;
  const millis = total % 1000;

  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(millis, 3)}`;
}

function toMs(match: RegExpExecArray): number {
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]!.padEnd(3, '0'));
  return hours * 3_600_000 + minutes * 60_000 + seconds * 1000 + millis;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}
