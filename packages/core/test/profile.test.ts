import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultProfilesDir,
  LEGACY_SEED_PROFILES,
  migrate,
  ProfileError,
  ProfileStore,
  slugify,
  toJson,
  toMarkdown,
  type Profile,
} from '../src/profile/index.js';

const LEGACY_DIR = new URL('../../../legacy/subtitle-fixer-panel/profiles/', import.meta.url);

function legacy(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, LEGACY_DIR), 'utf8'));
}

describe('migrate', () => {
  it('converts the prototype 4S profile to v2', () => {
    const profile = migrate(legacy('4s-estampas.json'), '4s-estampas');

    expect(profile.schema_version).toBe(2);
    expect(profile.slug).toBe('4s-estampas');
    expect(profile.client_name).toBe('4S Estampas e Uniformes');
    expect(profile.subtitle_glossary.terms).toHaveLength(5);
    for (const term of profile.subtitle_glossary.terms) {
      expect(term.match).toBe('exata');
      expect(term.source).toBe('manual');
    }
    expect(profile.subtitle_glossary.terms[2]).toMatchObject({ wrong: 'de teif', correct: 'DTF' });
    expect(profile.subtitle_glossary.proper_nouns).toContain('Brusque');
    expect(profile.subtitle_glossary.product_names).toEqual([]);
    expect(profile.subtitle_glossary.ignored_suggestions).toEqual([]);
    expect(profile.tone_profile.remove_fillers_in_captions).toBe(false);
    expect(profile.style_examples.before_after).toHaveLength(2);
    expect(profile.cleanup).toEqual({ sensitivity: 'media', silence_min_ms: 600, padding_ms: 120 });
    expect(profile.template).toEqual({ package: null });
    expect(profile.hub_client_id).toBeNull();
    expect(profile.aliases).toEqual([]);
  });

  it('converts the prototype default profile to v2', () => {
    const profile = migrate(legacy('padrao.json'), 'padrao');

    expect(profile.slug).toBe('padrao');
    expect(profile.client_name).toBe('Padrão (sem glossário)');
    expect(profile.subtitle_glossary.terms).toEqual([]);
    expect(profile.tone_profile.voice).toBe('natural, como a pessoa falou');
  });

  it('derives the slug from the client name when v1 has no file name', () => {
    expect(migrate(legacy('4s-estampas.json')).slug).toBe('4s-estampas-e-uniformes');
  });

  it('reads v2 as is and fills the defaults', () => {
    const profile = migrate({
      schema_version: 2,
      slug: 'cliente-x',
      client_name: 'Cliente X',
      subtitle_glossary: { terms: [{ wrong: 'ex', correct: 'X', match: 'fonetica', source: 'aprendido' }] },
    });

    expect(profile.subtitle_glossary.terms[0]).toEqual({
      wrong: 'ex',
      correct: 'X',
      match: 'fonetica',
      source: 'aprendido',
      added_at: null,
    });
    expect(profile.tone_profile.avoid).toEqual([]);
  });

  it('is idempotent: migrating v2 output gives the same profile', () => {
    const once = migrate(legacy('4s-estampas.json'), '4s-estampas');

    expect(migrate(JSON.parse(toJson(once)))).toEqual(once);
  });

  it('rejects unknown versions and broken profiles with a readable error', () => {
    expect(() => migrate({ schema_version: 3, client_name: 'x' })).toThrow(/Versão de perfil desconhecida/);
    expect(() => migrate([])).toThrow(ProfileError);
    expect(() => migrate({ schema_version: 2, slug: 'x' })).toThrow(/client_name/);
    expect(() =>
      migrate({ schema_version: 2, slug: 'x', client_name: 'X', subtitle_glossary: { terms: [{ wrong: 'a' }] } }),
    ).toThrow(/subtitle_glossary\.terms\.0\.correct/);
  });
});

describe('slugify', () => {
  it('ports the prototype behaviour', () => {
    expect(slugify('4S Estampas e Uniformes')).toBe('4s-estampas-e-uniformes');
    expect(slugify('Padrão (sem glossário)')).toBe('padrao-sem-glossario');
    expect(slugify('  Ação & Cia.  ')).toBe('acao-cia');
    expect(slugify('***')).toBe('cliente');
  });
});

describe('seed profiles', () => {
  it('match the prototype files', () => {
    expect(LEGACY_SEED_PROFILES['4s-estampas']).toEqual(legacy('4s-estampas.json'));
    expect(LEGACY_SEED_PROFILES['padrao']).toEqual(legacy('padrao.json'));
  });
});

describe('ProfileStore', () => {
  let dir: string;
  let store: ProfileStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eve-cut-profiles-'));
    store = new ProfileStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('defaults to %APPDATA%\\eve-cut\\profiles', () => {
    expect(defaultProfilesDir({ APPDATA: 'C:\\Users\\jose\\AppData\\Roaming' })).toBe(
      'C:\\Users\\jose\\AppData\\Roaming\\eve-cut\\profiles',
    );
  });

  it('seeds the prototype profiles on first run, only once', () => {
    expect(store.seed()).toBe(2);
    expect(store.seed()).toBe(0);

    const list = store.list();
    expect(list.map((entry) => entry.slug)).toEqual(['4s-estampas', 'padrao']);
    expect(list[0]!.profile!.subtitle_glossary.terms[0]!.match).toBe('exata');
    expect(JSON.parse(readFileSync(join(dir, 'padrao.json'), 'utf8')).schema_version).toBe(2);
  });

  it('does not seed a folder that already has profiles', () => {
    store.save({ schema_version: 2, slug: 'outro', client_name: 'Outro' });

    expect(store.seed()).toBe(0);
    expect(store.list()).toHaveLength(1);
  });

  it('round-trips load/save', () => {
    const original = migrate(legacy('4s-estampas.json'), '4s-estampas');
    const edited: Profile = {
      ...original,
      aliases: ['4S'],
      subtitle_glossary: {
        ...original.subtitle_glossary,
        terms: [
          ...original.subtitle_glossary.terms,
          { wrong: 'ex tampa', correct: 'estampa', match: 'fonetica', source: 'aprendido', added_at: '2026-10-21' },
        ],
      },
    };

    store.save(edited);

    expect(store.load('4s-estampas')).toEqual(edited);
    expect(readdirSync(dir)).toEqual(['4s-estampas.json']);
  });

  it('reads a v1 file dropped in the folder', () => {
    writeFileSync(join(dir, '4s-estampas.json'), readFileSync(new URL('4s-estampas.json', LEGACY_DIR)));

    const profile = store.load('4s-estampas');

    expect(profile.schema_version).toBe(2);
    expect(profile.slug).toBe('4s-estampas');
  });

  it('uses the file name as the slug', () => {
    writeFileSync(join(dir, 'novo.json'), JSON.stringify({ schema_version: 2, slug: 'antigo', client_name: 'N' }));

    expect(store.load('novo').slug).toBe('novo');
  });

  it('lists a broken file as "(JSON inválido)" without dropping the others', () => {
    store.seed();
    writeFileSync(join(dir, 'quebrado.json'), '{ "client_name": ');
    writeFileSync(join(dir, 'sem-nome.json'), JSON.stringify({ schema_version: 2 }));

    const list = store.list();

    expect(list).toHaveLength(4);
    const broken = list.find((entry) => entry.slug === 'quebrado')!;
    expect(broken.name).toBe('quebrado (JSON inválido)');
    expect(broken.profile).toBeNull();
    expect(broken.error).toMatch(/não é um JSON válido/);
    expect(list.find((entry) => entry.slug === 'sem-nome')!.name).toBe('sem-nome (JSON inválido)');
    expect(list.find((entry) => entry.slug === '4s-estampas')!.profile).not.toBeNull();
  });

  it('sorts by client name in pt-BR order', () => {
    store.save({ schema_version: 2, slug: 'zeta', client_name: 'Zeta' });
    store.save({ schema_version: 2, slug: 'acai', client_name: 'Açaí da Praia' });
    store.save({ schema_version: 2, slug: 'beta', client_name: 'Beta' });

    expect(store.list().map((entry) => entry.name)).toEqual(['Açaí da Praia', 'Beta', 'Zeta']);
  });

  it('refuses invalid profiles and slugs without writing anything', () => {
    expect(() => store.save({ schema_version: 2, slug: '../fora', client_name: 'X' })).toThrow(ProfileError);
    expect(() => store.save({ schema_version: 2, slug: 'ok', client_name: '' })).toThrow(ProfileError);
    expect(() => store.load('../fora')).toThrow(/Nome de perfil inválido/);
    expect(() => store.load('nao-existe')).toThrow(/não existe/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('replaces an existing profile without leaving temp files behind', () => {
    store.save({ schema_version: 2, slug: 'x', client_name: 'Antes' });
    store.save({ schema_version: 2, slug: 'x', client_name: 'Depois' });

    expect(store.load('x').client_name).toBe('Depois');
    expect(readdirSync(dir)).toEqual(['x.json']);
    expect(existsSync(join(dir, 'x.json'))).toBe(true);
  });
});

describe('export', () => {
  it('toJson writes the stored profile, importable back', () => {
    const profile = migrate(legacy('padrao.json'), 'padrao');
    const json = toJson(profile);

    expect(json.endsWith('}\n')).toBe(true);
    expect(migrate(JSON.parse(json))).toEqual(profile);
  });

  it('toMarkdown matches the SPEC §6 example for 4S', () => {
    const migrated = migrate(legacy('4s-estampas.json'), '4s-estampas');
    const term = (wrong: string) => migrated.subtitle_glossary.terms.find((t) => t.wrong === wrong)!;
    // The SPEC example lists two of the five terms; the rest of the profile is the prototype's.
    const profile: Profile = {
      ...migrated,
      subtitle_glossary: { ...migrated.subtitle_glossary, terms: [term('de teif'), term('quatro s estampas')] },
    };

    expect(toMarkdown(profile, new Date(2026, 9, 20))).toBe(
      [
        '# Glossário de legendas — 4S Estampas e Uniformes',
        'Atualizado em 20/10/2026 pelo eve-cut.',
        '',
        '## Como o cliente fala',
        '- Fala **DTF**, não "de teif".',
        '- Fala **4S Estampas**, não "quatro s estampas".',
        '',
        '## Nunca alterar',
        '4S Estampas e Uniformes, Brusque, DTF, sublimação têxtil, silkscreen',
        '',
        '## Tom de voz',
        '- Voz: direto, técnico mas acessível',
        '- Formalidade: informal-profissional',
        '- Evitar: gírias regionais fortes, jargão excessivo',
        '',
      ].join('\n'),
    );
  });

  it('toMarkdown merges product names into "Nunca alterar" and skips empty sections', () => {
    const profile = migrate({
      schema_version: 2,
      slug: 'x',
      client_name: 'X',
      subtitle_glossary: { proper_nouns: ['Brusque'], product_names: ['DTF', 'Brusque'] },
    });

    expect(toMarkdown(profile, new Date(2026, 0, 5))).toBe(
      '# Glossário de legendas — X\nAtualizado em 05/01/2026 pelo eve-cut.\n\n## Nunca alterar\nBrusque, DTF\n',
    );
  });
});
