import type { Batch } from '../batch/batch.js';
import type { Profile } from '../profile/schema.js';
import type { ChangeKind, ModelChange } from '../prompt/schema.js';
import { normalizedDistance } from './distance.js';

export type ChangeSource = 'regra' | 'claude';

/** A proposed change after the automatic checks (SPEC §5.5). */
export interface ReviewedChange {
  index: number;
  /** Text the change starts from (already through the exact glossary); `''` for an unknown block. */
  before: string;
  after: string;
  kind: ChangeKind;
  source: ChangeSource;
  note?: string;
  /** `rejeitada_auto` shows up collapsed in the review; José can still accept it by hand. */
  status: 'pendente' | 'rejeitada_auto';
  /** Why it was rejected; `null` when it passed. */
  reason: string | null;
}

export interface ValidateOptions {
  /** Where the dropped duplicates are reported. */
  log?: (message: string) => void;
}

/** Above this, the change is a rewrite, not a correction. */
export const MAX_DISTANCE = 0.6;

const TIMING = /-->|\d{1,2}:\d{2}:\d{2}[,.]\d{3}/;
const NUMBER_LINE = /^\s*\d+\s*$/;

/**
 * Check every change the model (button or conversation) proposed for a batch, in the order of
 * SPEC §5.5; the first rule that fails gives the reason. When the same index comes twice, the first
 * one counts and the second only goes to the log.
 */
export function validateChanges(
  batch: Batch,
  changes: readonly ModelChange[],
  profile: Profile | null,
  options: ValidateOptions = {},
): ReviewedChange[] {
  const items = new Map(batch.items.map((item) => [item.index, item]));
  const protectedTerms = profile
    ? [...profile.subtitle_glossary.proper_nouns, ...profile.subtitle_glossary.product_names].filter((t) => t.trim())
    : [];
  const seen = new Set<number>();
  const out: ReviewedChange[] = [];

  for (const change of changes) {
    if (seen.has(change.index)) {
      options.log?.(`Mudança repetida para o bloco #${change.index} ignorada: vale a primeira.`);
      continue;
    }
    seen.add(change.index);

    const item = items.get(change.index);
    const before = item?.text ?? '';
    const reason = item
      ? item.editable
        ? checkText(before, change.text, protectedTerms)
        : `O bloco #${change.index} é só contexto neste lote.`
      : `O bloco #${change.index} não está neste lote.`;

    out.push({
      index: change.index,
      before,
      after: change.text,
      kind: change.kind,
      source: 'claude',
      ...(change.note !== undefined ? { note: change.note } : {}),
      status: reason ? 'rejeitada_auto' : 'pendente',
      reason,
    });
  }
  return out;
}

/** Rules 2 to 7 for one block; `null` when the new text passes. */
function checkText(before: string, after: string, protectedTerms: readonly string[]): string | null {
  if (!after.trim()) return 'O texto novo está vazio.';
  if (after === before) return 'O texto novo é igual ao atual.';

  const linesBefore = before.split('\n').length;
  const linesAfter = after.split('\n').length;
  if (linesAfter !== linesBefore) return `Mudou o número de linhas (${linesBefore} → ${linesAfter}).`;

  const lengthBefore = Array.from(before).length;
  const lengthAfter = Array.from(after).length;
  if (lengthAfter > Math.max(lengthBefore * 1.25, lengthBefore + 12)) {
    return `Texto longo demais (${lengthBefore} → ${lengthAfter} caracteres).`;
  }

  const lost = protectedTerms.find((term) => before.includes(term) && !after.includes(term));
  if (lost !== undefined) return `Removeu o termo protegido "${lost}".`;

  const oldNumberLines = new Set(before.split('\n').filter((line) => NUMBER_LINE.test(line)));
  const newNumberLine = after.split('\n').some((line) => NUMBER_LINE.test(line) && !oldNumberLines.has(line));
  if (TIMING.test(after) || newNumberLine) return 'O texto parece ter tempo ou número de bloco.';

  const distance = normalizedDistance(before, after);
  if (distance > MAX_DISTANCE) {
    return `Mudou demais: parece reescrita, não correção (distância ${distance.toFixed(2).replace('.', ',')}).`;
  }
  return null;
}
