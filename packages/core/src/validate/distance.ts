/** Levenshtein distance over code points, so an accented letter counts as one character. */
export function editDistance(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (!x.length) return y.length;
  if (!y.length) return x.length;

  let previous = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[y.length]!;
}

/** 0 = same text, 1 = nothing in common. */
export function normalizedDistance(a: string, b: string): number {
  const longest = Math.max(Array.from(a).length, Array.from(b).length);
  return longest === 0 ? 0 : editDistance(a, b) / longest;
}
