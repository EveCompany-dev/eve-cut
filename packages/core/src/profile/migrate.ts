import type { z } from 'zod';

import { ProfileSchema, slugify } from './schema.js';
import type { Profile } from './schema.js';

/** A profile file that could not be read as v1 or v2; the message is meant for the panel. */
export class ProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileError';
  }
}

/**
 * Read a profile in any known format and return it as v2.
 *
 * v1 is the prototype's format (no `schema_version`). Its terms were always applied literally and
 * typed by hand, hence `match: "exata"` and `source: "manual"`. `slug` names the profile when the
 * JSON has none (v1 never had one); the store passes the file name.
 */
export function migrate(json: unknown, slug?: string): Profile {
  if (!isRecord(json)) {
    throw new ProfileError('O perfil não é um objeto JSON.');
  }

  const version = json['schema_version'];
  if (version === undefined) return parseV2(fromV1(json, slug));
  if (version === 2) return parseV2(slug !== undefined && json['slug'] === undefined ? { ...json, slug } : json);
  throw new ProfileError(`Versão de perfil desconhecida: ${String(version)}.`);
}

function fromV1(v1: Record<string, unknown>, slug: string | undefined): Record<string, unknown> {
  const clientName = typeof v1['client_name'] === 'string' ? v1['client_name'] : '';
  const glossary = isRecord(v1['subtitle_glossary']) ? v1['subtitle_glossary'] : {};
  const terms = Array.isArray(glossary['terms']) ? glossary['terms'] : [];

  return {
    ...v1,
    schema_version: 2,
    slug: slug ?? slugify(clientName),
    subtitle_glossary: {
      ...glossary,
      terms: terms.map((term) => (isRecord(term) ? { ...term, match: 'exata', source: 'manual' } : term)),
    },
  };
}

function parseV2(json: unknown): Profile {
  const result = ProfileSchema.safeParse(json);
  if (!result.success) {
    throw new ProfileError(`Perfil inválido: ${describeIssue(result.error)}`);
  }
  return result.data;
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'formato desconhecido.';
  const where = issue.path.length ? issue.path.join('.') : 'raiz';
  return `${where}: ${issue.message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
