import type { SrtBlock } from '../srt/types.js';

/** What the model sees of a block: never the timing line (SPEC §5.3). */
export interface BatchItem {
  index: number;
  text: string;
  /** `false` for the context blocks around the batch: read-only, there so cut sentences make sense. */
  editable: boolean;
}

export interface Batch {
  items: BatchItem[];
}

/**
 * Split the blocks into batches of `size` editable blocks, each with up to `context` read-only
 * blocks before and after. Every block is editable in exactly one batch.
 */
export function makeBatches(blocks: readonly SrtBlock[], size = 40, context = 3): Batch[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`Tamanho de lote inválido: ${size}`);
  }
  if (!Number.isInteger(context) || context < 0) {
    throw new RangeError(`Contexto inválido: ${context}`);
  }

  const item = (block: SrtBlock, editable: boolean): BatchItem => ({ index: block.index, text: block.text, editable });
  const batches: Batch[] = [];
  for (let start = 0; start < blocks.length; start += size) {
    const end = Math.min(start + size, blocks.length);
    batches.push({
      items: [
        ...blocks.slice(Math.max(0, start - context), start).map((b) => item(b, false)),
        ...blocks.slice(start, end).map((b) => item(b, true)),
        ...blocks.slice(end, end + context).map((b) => item(b, false)),
      ],
    });
  }
  return batches;
}
