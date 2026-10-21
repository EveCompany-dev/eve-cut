import type { Profile } from './schema.js';

/** `<slug>.eve-cut.json`: the profile as stored, so it can be imported back as is. */
export function toJson(profile: Profile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

/**
 * `<slug>.glossario.md`, meant to be pasted in the Hub (Acervo → Configurações) until the Hub has
 * its own field (F4). Format of SPEC §6; empty sections are left out.
 */
export function toMarkdown(profile: Profile, date: Date): string {
  const lines: string[] = [
    `# Glossário de legendas — ${profile.client_name}`,
    `Atualizado em ${formatDate(date)} pelo eve-cut.`,
  ];

  const terms = profile.subtitle_glossary.terms;
  if (terms.length) {
    lines.push('', '## Como o cliente fala');
    for (const term of terms) lines.push(`- Fala **${term.correct}**, não "${term.wrong}".`);
  }

  const protectedTerms = unique([...profile.subtitle_glossary.proper_nouns, ...profile.subtitle_glossary.product_names]);
  if (protectedTerms.length) {
    lines.push('', '## Nunca alterar', protectedTerms.join(', '));
  }

  const tone = profile.tone_profile;
  const toneLines = [
    tone.voice && `- Voz: ${tone.voice}`,
    tone.formality && `- Formalidade: ${tone.formality}`,
    tone.avoid.length > 0 && `- Evitar: ${tone.avoid.join(', ')}`,
  ].filter((line): line is string => typeof line === 'string' && line !== '');
  if (toneLines.length) {
    lines.push('', '## Tom de voz', ...toneLines);
  }

  return `${lines.join('\n')}\n`;
}

function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
