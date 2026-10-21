import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { makeBatches } from '../src/batch/index.js';
import { migrate } from '../src/profile/index.js';
import {
  buildSystemPrompt,
  buildUserPrompt,
  CHANGE_KINDS,
  checkModelResponse,
  RESPONSE_SCHEMA,
} from '../src/prompt/index.js';
import { parse } from '../src/srt/index.js';

const LEGACY_4S = new URL('../../../legacy/subtitle-fixer-panel/profiles/4s-estampas.json', import.meta.url);
const FIXTURE = new URL('../../../fixtures/srt/premiere-exemplo.srt', import.meta.url);

const profile4s = migrate(JSON.parse(readFileSync(LEGACY_4S, 'utf8')), '4s-estampas');

describe('buildSystemPrompt', () => {
  it('matches the snapshot for 4S', () => {
    expect(buildSystemPrompt(profile4s)).toMatchSnapshot();
  });

  it('contains every term, protected term and the tone notes', () => {
    const prompt = buildSystemPrompt(profile4s);

    for (const term of profile4s.subtitle_glossary.terms) {
      expect(prompt).toContain(`"${term.wrong}" -> "${term.correct}"`);
    }
    for (const name of profile4s.subtitle_glossary.proper_nouns) expect(prompt).toContain(name);
    expect(prompt).toContain(profile4s.tone_profile.notes);
    expect(prompt).toContain('"a gente faz estampa em de teif" -> "a gente faz estampa em DTF"');
  });

  it('flags phonetic terms and lists product names as protected', () => {
    const prompt = buildSystemPrompt(
      migrate({
        schema_version: 2,
        slug: 'x',
        client_name: 'X',
        subtitle_glossary: {
          terms: [{ wrong: 'ex tampa', correct: 'estampa', match: 'fonetica' }],
          product_names: ['Camiseta Pro'],
        },
      }),
    );

    expect(prompt).toMatch(/"ex tampa" -> "estampa" \(som parecido/);
    expect(prompt).toContain('Camiseta Pro');
  });

  it('works without a profile', () => {
    const prompt = buildSystemPrompt(null);

    expect(prompt).toContain('REGRAS');
    expect(prompt).not.toContain('PERFIL DO CLIENTE');
    expect(buildSystemPrompt()).toBe(prompt);
  });

  it('keeps fillers unless the profile asks to remove them', () => {
    const keep = buildSystemPrompt(profile4s);
    const remove = buildSystemPrompt({
      ...profile4s,
      tone_profile: { ...profile4s.tone_profile, remove_fillers_in_captions: true },
    });

    expect(keep).toContain('Mantenha os vícios de fala');
    expect(remove).toContain('pede para tirar vícios de fala');
  });
});

describe('buildUserPrompt', () => {
  const blocks = parse(readFileSync(FIXTURE, 'utf8'));
  const batches = makeBatches(blocks, 2, 1);

  it('sends index, text and editable, never the timing', () => {
    for (const batch of batches) {
      const prompt = buildUserPrompt(batch);
      expect(prompt).toMatch(/^Revise estes blocos/);
      expect(prompt).not.toContain('-->');
      for (const block of blocks) expect(prompt).not.toContain(block.timing);
    }
  });

  it('embeds the items as JSON the model can read back', () => {
    const prompt = buildUserPrompt(batches[1]!);
    const json = JSON.parse(prompt.slice(prompt.indexOf('{')));

    expect(json).toEqual({ items: batches[1]!.items });
  });
});

describe('RESPONSE_SCHEMA', () => {
  it('only allows the documented kinds and fields', () => {
    const item = RESPONSE_SCHEMA.properties.changes.items;

    expect(item.properties.kind.enum).toEqual([...CHANGE_KINDS]);
    expect(item.required).toEqual(['index', 'text', 'kind']);
    expect(item.additionalProperties).toBe(false);
    expect(RESPONSE_SCHEMA.required).toEqual(['changes']);
  });
});

describe('checkModelResponse', () => {
  it('accepts a valid answer and explains an invalid one', () => {
    expect(checkModelResponse({ changes: [] })).toBeNull();
    expect(checkModelResponse({ changes: [{ index: 1, text: 'DTF', kind: 'glossario', note: 'sigla' }] })).toBeNull();
    expect(checkModelResponse({ changes: [{ index: 1, text: 'x', kind: 'estilo' }] })).toMatch(/changes\.0\.kind/);
    expect(checkModelResponse({ changes: [{ index: 1.5, text: 'x', kind: 'outro' }] })).toMatch(/changes\.0\.index/);
    expect(checkModelResponse({ changes: [], extra: true })).not.toBeNull();
    expect(checkModelResponse('{"changes":[]}')).not.toBeNull();
  });
});
