import { describe, expect, it } from 'vitest';

import { applyGlossary } from '../src/glossary/index.js';
import { migrate, type Profile } from '../src/profile/index.js';
import type { SrtBlock } from '../src/srt/index.js';

function profileWith(glossary: {
  terms?: { wrong: string; correct: string; match?: 'exata' | 'fonetica' }[];
  proper_nouns?: string[];
  product_names?: string[];
}): Profile {
  return migrate({ schema_version: 2, slug: 'teste', client_name: 'Teste', subtitle_glossary: glossary });
}

function blocks(...texts: string[]): SrtBlock[] {
  return texts.map((text, i) => ({
    index: i + 1,
    num: String(i + 1),
    timing: `00:00:0${i},000 --> 00:00:0${i},900 X1:100 Y1:200`,
    text,
  }));
}

const DTF = profileWith({
  terms: [
    { wrong: 'de teif', correct: 'DTF' },
    { wrong: 'dtf', correct: 'DTF' },
  ],
});

function fix(profile: Profile, ...texts: string[]): string[] {
  return applyGlossary(blocks(...texts), profile).blocks.map((b) => b.text);
}

describe('applyGlossary', () => {
  it('replaces a multi-word term', () => {
    expect(fix(DTF, 'fazemos estampa em de teif')).toEqual(['fazemos estampa em DTF']);
  });

  it('ignores case in the match and writes the correct form', () => {
    expect(fix(DTF, 'Dtf é rápido', 'DE TEIF também')).toEqual(['DTF é rápido', 'DTF também']);
  });

  it('accepts flexible spacing inside multi-word terms', () => {
    expect(fix(DTF, 'em de   teif')).toEqual(['em DTF']);
  });

  it('does not replace inside a word', () => {
    expect(fix(DTF, 'dtfx e xdtf')).toEqual(['dtfx e xdtf']);
  });

  it('works with accents and "ç", with Unicode word boundaries', () => {
    const profile = profileWith({
      terms: [
        { wrong: 'esfumação', correct: 'sublimação' },
        { wrong: 'ç', correct: 'cê' },
        { wrong: 'cao', correct: 'cão' },
      ],
    });

    expect(fix(profile, 'a Esfumação é boa', 'esfumaçãoes', 'ação', 'o cao e o caoção')).toEqual([
      'a sublimação é boa',
      'esfumaçãoes',
      'ação',
      'o cão e o caoção',
    ]);
  });

  it('leaves occurrences that cross a line break to the model', () => {
    expect(fix(DTF, 'estampa em de\nteif', 'dtf\nlinha dois')).toEqual(['estampa em de\nteif', 'DTF\nlinha dois']);
  });

  it('never changes a protected term, even when a wrong falls inside it', () => {
    const profile = profileWith({
      terms: [
        { wrong: 'estampas', correct: 'Estampas Ltda' },
        { wrong: 'brusque', correct: 'BRUSQUE' },
      ],
      proper_nouns: ['4S Estampas e Uniformes'],
      product_names: ['Brusque'],
    });

    expect(fix(profile, 'a 4S Estampas e Uniformes faz estampas', 'em Brusque e brusque')).toEqual([
      'a 4S Estampas e Uniformes faz Estampas Ltda',
      'em Brusque e BRUSQUE',
    ]);
  });

  it('ignores phonetic terms', () => {
    const profile = profileWith({ terms: [{ wrong: 'de teif', correct: 'DTF', match: 'fonetica' }] });

    expect(applyGlossary(blocks('em de teif'), profile).changes).toEqual([]);
  });

  it('prefers the longest term and never re-replaces its own output', () => {
    const profile = profileWith({
      terms: [
        { wrong: 'estampas', correct: 'estampa' },
        { wrong: 'quatro s estampas', correct: '4S Estampas' },
      ],
    });

    expect(fix(profile, 'aqui na quatro s estampas fazemos estampas')).toEqual([
      'aqui na 4S Estampas fazemos estampa',
    ]);
  });

  it('records one change per block with the whole text, and keeps timing untouched', () => {
    const input = blocks('nada aqui', 'em de teif e dtf');
    const result = applyGlossary(input, DTF);

    expect(result.changes).toEqual([
      { index: 2, before: 'em de teif e dtf', after: 'em DTF e DTF', kind: 'glossario', source: 'regra' },
    ]);
    expect(result.blocks.map((b) => b.timing)).toEqual(input.map((b) => b.timing));
    expect(result.blocks[0]).toBe(input[0]);
    expect(input[1]!.text).toBe('em de teif e dtf');
  });

  it('does not record a change when the text already has the correct form', () => {
    expect(applyGlossary(blocks('já é DTF'), DTF).changes).toEqual([]);
  });

  it('treats regex characters in terms literally', () => {
    const profile = profileWith({ terms: [{ wrong: 'c++', correct: 'C++' }, { wrong: 'a.b', correct: 'AB' }] });

    expect(fix(profile, 'axb e a.b')).toEqual(['axb e AB']);
  });
});
