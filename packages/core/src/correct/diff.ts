export type DiffOp = 'igual' | 'removido' | 'inserido';

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

// Words, runs of spaces and single punctuation marks: "estampa," → "estampa" + ",".
const TOKEN = /[\p{L}\p{N}]+|\s+|[^\p{L}\p{N}\s]/gu;

/**
 * Word diff for the review (SPEC §5.6): LCS over tokens. Joining the `igual` and `removido`
 * segments gives `before`; joining `igual` and `inserido` gives `after`. A space between two changed
 * words is folded into the change, so "de teif" → "DTF" shows as one swap, not two.
 */
export function wordDiff(before: string, after: string): DiffSegment[] {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  const ops = absorbSpaces(lcsOps(a, b));

  const out: DiffSegment[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i]!.op === 'igual') {
      let text = '';
      while (i < ops.length && ops[i]!.op === 'igual') text += ops[i++]!.text;
      out.push({ op: 'igual', text });
      continue;
    }
    let removed = '';
    let inserted = '';
    while (i < ops.length && ops[i]!.op !== 'igual') {
      const op = ops[i++]!;
      if (op.op === 'removido') removed += op.text;
      else inserted += op.text;
    }
    if (removed) out.push({ op: 'removido', text: removed });
    if (inserted) out.push({ op: 'inserido', text: inserted });
  }
  return out;
}

interface TokenOp {
  op: DiffOp;
  text: string;
}

function lcsOps(a: readonly string[], b: readonly string[]): TokenOp[] {
  // lengths[i][j] = LCS of a[i..] and b[j..]
  const lengths = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] =
        a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }

  const ops: TokenOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ op: 'igual', text: a[i]! });
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
      ops.push({ op: 'removido', text: a[i++]! });
    } else {
      ops.push({ op: 'inserido', text: b[j++]! });
    }
  }
  while (i < a.length) ops.push({ op: 'removido', text: a[i++]! });
  while (j < b.length) ops.push({ op: 'inserido', text: b[j++]! });
  return ops;
}

/** An unchanged space between two changes becomes part of both sides of the change. */
function absorbSpaces(ops: TokenOp[]): TokenOp[] {
  const out: TokenOp[] = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k]!;
    const between = op.op === 'igual' && /^\s+$/.test(op.text) && out.length > 0 && out[out.length - 1]!.op !== 'igual';
    const next = ops[k + 1];
    if (between && next && next.op !== 'igual') {
      out.push({ op: 'removido', text: op.text }, { op: 'inserido', text: op.text });
    } else {
      out.push(op);
    }
  }
  return out;
}
