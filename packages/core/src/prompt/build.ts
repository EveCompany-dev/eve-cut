import type { Batch } from '../batch/batch.js';
import type { Profile } from '../profile/schema.js';
import { buildRules } from './rules.js';

/** Rules + the client profile, as in the prototype's `buildSystemPrompt`. */
export function buildSystemPrompt(profile?: Profile | null): string {
  const rules = buildRules({ removeFillers: profile?.tone_profile.remove_fillers_in_captions ?? false });
  if (!profile) return rules;

  const glossary = profile.subtitle_glossary;
  const tone = profile.tone_profile;
  const lines = [rules, '', `--- PERFIL DO CLIENTE: ${profile.client_name} ---`];

  const terms = glossary.terms.filter((term) => term.wrong.trim() && term.correct.trim());
  if (terms.length) {
    lines.push('', 'GLOSSÁRIO (o que o Premiere costuma errar -> forma correta):');
    for (const term of terms) {
      const hint = term.match === 'fonetica' ? ' (som parecido: confira pelo contexto antes de trocar)' : '';
      lines.push(`  "${term.wrong}" -> "${term.correct}"${hint}`);
    }
  }

  const protectedTerms = [...new Set([...glossary.proper_nouns, ...glossary.product_names])].filter((t) => t.trim());
  if (protectedTerms.length) {
    lines.push('', 'TERMOS PROTEGIDOS (grafia exata, nunca alterar nem "corrigir"):');
    lines.push(`  ${protectedTerms.join(', ')}`);
  }

  const toneLines = [
    tone.voice && `Voz: ${tone.voice}`,
    tone.formality && `Formalidade: ${tone.formality}`,
    tone.avoid.length > 0 && `Evitar: ${tone.avoid.join(', ')}`,
    tone.notes && `Notas: ${tone.notes}`,
  ].filter((line): line is string => typeof line === 'string' && line !== '');
  if (toneLines.length) {
    // The tone guides spelling and word choice among equivalent transcriptions, never a rewrite.
    lines.push('', 'TOM DE VOZ DA MARCA (referência; não reescreva a fala para mudar o tom):');
    for (const line of toneLines) lines.push(`  ${line}`);
  }

  const examples = profile.style_examples.before_after.filter((ex) => ex.before.trim() && ex.after.trim());
  if (examples.length) {
    lines.push('', 'EXEMPLOS APROVADOS PELO CLIENTE:');
    for (const ex of examples) lines.push(`  "${ex.before}" -> "${ex.after}"`);
  }

  return lines.join('\n');
}

/** The batch as the model sees it: index and text only, never the timing. */
export function buildUserPrompt(batch: Batch): string {
  const items = batch.items.map(({ index, text, editable }) => ({ index, text, editable }));
  return [
    'Revise estes blocos de legenda seguindo as regras. Devolva em "changes" só os blocos editáveis que',
    'você corrigiu.',
    '',
    JSON.stringify({ items }, null, 2),
  ].join('\n');
}
