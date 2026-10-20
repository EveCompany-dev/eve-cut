/** Split blocks into consecutive chunks of at most `size`. */
export function batch<T>(blocks: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`Tamanho de lote inválido: ${size}`);
  }

  const out: T[][] = [];
  for (let i = 0; i < blocks.length; i += size) {
    out.push(blocks.slice(i, i + size));
  }
  return out;
}
