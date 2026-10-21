import { z } from 'zod';

/**
 * Client profile, schema v2 (SPEC §6).
 *
 * Every optional field has a default so a profile written by an older build, or by hand, always
 * comes back complete. `cleanup` (F2) and `template` (F3) exist from v1 on but are ignored until then.
 */

export const TermMatchSchema = z.enum(['exata', 'fonetica']);
export const TermSourceSchema = z.enum(['manual', 'aprendido']);

export const GlossaryTermSchema = z.object({
  wrong: z.string(),
  correct: z.string(),
  match: TermMatchSchema.default('exata'),
  source: TermSourceSchema.default('manual'),
  added_at: z.string().nullable().default(null),
});

export const IgnoredSuggestionSchema = z.object({
  wrong: z.string(),
  correct: z.string(),
});

export const SubtitleGlossarySchema = z.object({
  terms: z.array(GlossaryTermSchema).default([]),
  proper_nouns: z.array(z.string()).default([]),
  product_names: z.array(z.string()).default([]),
  ignored_suggestions: z.array(IgnoredSuggestionSchema).default([]),
});

export const ToneProfileSchema = z.object({
  voice: z.string().default(''),
  formality: z.string().default(''),
  avoid: z.array(z.string()).default([]),
  notes: z.string().default(''),
  remove_fillers_in_captions: z.boolean().default(false),
});

export const StyleExampleSchema = z.object({
  before: z.string(),
  after: z.string(),
});

export const StyleExamplesSchema = z.object({
  before_after: z.array(StyleExampleSchema).default([]),
});

export const CleanupSettingsSchema = z.object({
  sensitivity: z.enum(['baixa', 'media', 'alta']).default('media'),
  silence_min_ms: z.number().int().nonnegative().default(600),
  padding_ms: z.number().int().nonnegative().default(120),
});

export const TemplateSettingsSchema = z.object({
  package: z.string().nullable().default(null),
});

/** Slugs become file names, so they are restricted to what `slugify` produces. */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug inválido');

export const ProfileSchema = z.object({
  schema_version: z.literal(2),
  slug: SlugSchema,
  client_name: z.string().min(1),
  hub_client_id: z.string().nullable().default(null),
  aliases: z.array(z.string()).default([]),
  // `prefault` runs the nested defaults when the whole section is missing.
  subtitle_glossary: SubtitleGlossarySchema.prefault({}),
  tone_profile: ToneProfileSchema.prefault({}),
  style_examples: StyleExamplesSchema.prefault({}),
  cleanup: CleanupSettingsSchema.prefault({}),
  template: TemplateSettingsSchema.prefault({}),
});

export type TermMatch = z.infer<typeof TermMatchSchema>;
export type TermSource = z.infer<typeof TermSourceSchema>;
export type GlossaryTerm = z.infer<typeof GlossaryTermSchema>;
export type IgnoredSuggestion = z.infer<typeof IgnoredSuggestionSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
/** What a caller may hand in: anything with a default can be left out. */
export type ProfileInput = z.input<typeof ProfileSchema>;

/** Port of the prototype's `slugify`: accents dropped, lowercase, anything else becomes `-`. */
export function slugify(name: string): string {
  return (
    String(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cliente'
  );
}
