import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, win32 } from 'node:path';

import { appDataDir } from '../bridge/paths.js';
import { migrate, ProfileError } from './migrate.js';
import { ProfileSchema, SlugSchema } from './schema.js';
import type { Profile, ProfileInput } from './schema.js';
import { LEGACY_SEED_PROFILES } from './seed.js';

export interface ProfileListEntry {
  slug: string;
  /** Client name, or `<slug> (JSON inválido)` when the file could not be read. */
  name: string;
  profile: Profile | null;
  error?: string;
}

/** `%APPDATA%\eve-cut\profiles`. */
export function defaultProfilesDir(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(appDataDir(env), 'eve-cut', 'profiles');
}

/**
 * Profiles on disk, one `<slug>.json` per client. The folder is injected so tests use a temp dir;
 * the file name is the slug, whatever the JSON inside says.
 */
export class ProfileStore {
  constructor(readonly dir: string = defaultProfilesDir()) {}

  /** Every profile, sorted by client name. A broken file is listed, never thrown. */
  list(): ProfileListEntry[] {
    const out: ProfileListEntry[] = this.slugs().map((slug) => {
      try {
        const profile = this.load(slug);
        return { slug, name: profile.client_name, profile };
      } catch (err) {
        return { slug, name: `${slug} (JSON inválido)`, profile: null, error: (err as Error).message };
      }
    });
    return out.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  load(slug: string): Profile {
    const file = this.fileFor(slug);
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ProfileError(`O perfil "${slug}" não existe.`);
      }
      throw new ProfileError(`O perfil "${slug}" não é um JSON válido.`);
    }
    return { ...migrate(json, slug), slug };
  }

  /**
   * Validate and write the profile. It goes to a temp file first and is renamed over the old one,
   * so a crash mid-write never leaves a half-written profile behind.
   */
  save(input: ProfileInput): Profile {
    const result = ProfileSchema.safeParse(input);
    if (!result.success) {
      throw new ProfileError(`Perfil inválido: ${result.error.issues[0]?.message ?? 'formato desconhecido.'}`);
    }

    const profile = result.data;
    const file = this.fileFor(profile.slug);
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;

    mkdirSync(this.dir, { recursive: true });
    try {
      writeFileSync(tmp, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
      renameSync(tmp, file);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
    return profile;
  }

  /**
   * First run: when the folder has no profile yet, write the prototype's profiles converted to v2.
   * Returns how many were written.
   */
  seed(): number {
    if (this.slugs().length > 0) return 0;
    let written = 0;
    for (const [slug, v1] of Object.entries(LEGACY_SEED_PROFILES)) {
      this.save(migrate(v1, slug));
      written++;
    }
    return written;
  }

  private slugs(): string[] {
    mkdirSync(this.dir, { recursive: true });
    return readdirSync(this.dir)
      .filter((name) => /\.json$/i.test(name))
      .map((name) => name.replace(/\.json$/i, ''));
  }

  private fileFor(slug: string): string {
    // The slug becomes a path: anything outside the slug alphabet could escape the folder.
    if (!SlugSchema.safeParse(slug).success) {
      throw new ProfileError(`Nome de perfil inválido: "${slug}".`);
    }
    return join(this.dir, `${slug}.json`);
  }
}
