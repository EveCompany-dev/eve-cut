import type { Profile } from '../profile/schema.js';
import type { SrtBlock } from '../srt/types.js';

/** A change made by the deterministic glossary step (SPEC §5.2). */
export interface GlossaryChange {
  index: number;
  /** Whole block text before and after; one change per block, covering every swap in it. */
  before: string;
  after: string;
  kind: 'glossario';
  source: 'regra';
}

export interface GlossaryResult {
  /** Same blocks, same timing; only `text` differs where a term matched. */
  blocks: SrtBlock[];
  changes: GlossaryChange[];
}

interface Span {
  start: number;
  end: number;
}

interface Replacement extends Span {
  text: string;
}

// `\b` only knows ASCII, so "ç" or "ã" would count as a boundary; these look-arounds do not.
const BEFORE = '(?<![\\p{L}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{N}])';

/**
 * Apply the exact-match terms of the glossary (SPEC §5.2): case-insensitive, Unicode word
 * boundaries, flexible spaces in multi-word terms. Skipped, and left to the model: occurrences that
 * cross a line break, and occurrences that touch a protected term (proper nouns and product names).
 */
export function applyGlossary(blocks: readonly SrtBlock[], profile: Profile): GlossaryResult {
  const glossary = profile.subtitle_glossary;
  // Longest first, so "quatro s estampas" wins over a shorter term inside it.
  const terms = glossary.terms
    .filter((term) => term.match === 'exata' && term.wrong.trim() && term.correct.trim())
    .map((term) => ({ pattern: termPattern(term.wrong, 'giu'), correct: term.correct, length: term.wrong.trim().length }))
    .sort((a, b) => b.length - a.length);
  const protectedPatterns = [...glossary.proper_nouns, ...glossary.product_names]
    .filter((name) => name.trim())
    .map((name) => termPattern(name, 'gu'));

  const changes: GlossaryChange[] = [];
  const out = blocks.map((block) => {
    const taken: Span[] = protectedPatterns.flatMap((pattern) => findAll(pattern, block.text));
    const replacements: Replacement[] = [];

    for (const term of terms) {
      for (const match of block.text.matchAll(term.pattern)) {
        const span = { start: match.index, end: match.index + match[0].length };
        if (match[0].includes('\n') || taken.some((other) => overlaps(span, other))) continue;
        taken.push(span);
        if (match[0] !== term.correct) replacements.push({ ...span, text: term.correct });
      }
    }

    if (!replacements.length) return block;
    const after = splice(block.text, replacements);
    if (after === block.text) return block;
    changes.push({ index: block.index, before: block.text, after, kind: 'glossario', source: 'regra' });
    return { ...block, text: after };
  });

  return { blocks: out, changes };
}

function termPattern(term: string, flags: string): RegExp {
  const words = term.trim().split(/\s+/).map(escapeRegExp);
  return new RegExp(`${BEFORE}${words.join('\\s+')}${AFTER}`, flags);
}

function findAll(pattern: RegExp, text: string): Span[] {
  return [...text.matchAll(pattern)].map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

function splice(text: string, replacements: Replacement[]): string {
  let out = '';
  let cursor = 0;
  for (const r of [...replacements].sort((a, b) => a.start - b.start)) {
    out += text.slice(cursor, r.start) + r.text;
    cursor = r.end;
  }
  return out + text.slice(cursor);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
