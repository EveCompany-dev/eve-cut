import type { SrtBlock } from './types.js';

/**
 * Rebuild an .srt from blocks. Timing lines are written back byte-for-byte.
 *
 * Same shape as the prototype: CRLF everywhere, one blank line between cues and no blank line after
 * the last one. Keeping that trailing detail is what makes `build(parse(x))` byte-identical to a file
 * that ends with a single CRLF; a blank line at the end of the input is normalized away.
 */
export function build(blocks: readonly SrtBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    out.push(block.num, block.timing, block.text, '');
  }
  return out.join('\r\n').replace(/\n/g, '\r\n').replace(/\r\r\n/g, '\r\n');
}
