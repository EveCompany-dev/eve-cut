import type { SrtBlock } from './types.js';

const TIMING = /-->/;
const BOM = /^\uFEFF/;
const NUMBER_ONLY = /^\d+$/;

/**
 * Parse an .srt into blocks.
 *
 * Port of `legacy/subtitle-fixer-panel/js/srt.js`, keeping its guarantees:
 * - BOM stripped and CRLF/CR normalized to LF (only the timing line bytes matter downstream);
 * - the timing line is stored verbatim;
 * - a missing number is synthesized from the block position;
 * - chunks that are not cues (no `-->` line) are dropped.
 */
export function parse(raw: string): SrtBlock[] {
  const src = raw.replace(BOM, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const chunks = src.split(/\n[ \t]*\n+/);
  const blocks: SrtBlock[] = [];

  for (const chunk of chunks) {
    const lines = chunk.split('\n');

    while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
    while (lines.length > 0 && !lines[lines.length - 1]!.trim()) lines.pop();
    if (lines.length === 0) continue;

    let num: string | null = null;
    if (NUMBER_ONLY.test(lines[0]!.trim()) && lines.length > 1 && TIMING.test(lines[1]!)) {
      num = lines.shift()!.trim();
    }

    // Not a cue: the prototype drops the chunk instead of inventing a timing line.
    if (lines.length === 0 || !TIMING.test(lines[0]!)) continue;

    const timing = lines.shift()!;
    const text = lines.join('\n').trim();
    const index = blocks.length + 1;

    blocks.push({ index, num: num ?? String(index), timing, text });
  }

  return blocks;
}
