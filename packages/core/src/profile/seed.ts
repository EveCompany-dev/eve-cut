/**
 * The prototype's bundled profiles (`legacy/subtitle-fixer-panel/profiles/*.json`), kept here in
 * their original v1 shape so the first run goes through the same migration as an imported file.
 * They are copied instead of read from `legacy/` because the installed panel does not ship that
 * folder. A test checks that they still match the files.
 */
export const LEGACY_SEED_PROFILES: Readonly<Record<string, unknown>> = {
  '4s-estampas': {
    client_name: '4S Estampas e Uniformes',
    subtitle_glossary: {
      terms: [
        { wrong: 'esfumação', correct: 'sublimação' },
        { wrong: 'quatro s estampas', correct: '4S Estampas' },
        { wrong: 'de teif', correct: 'DTF' },
        { wrong: 'dtf', correct: 'DTF' },
        { wrong: 'silk screen', correct: 'silkscreen' },
      ],
      proper_nouns: ['4S Estampas e Uniformes', 'Brusque', 'DTF', 'sublimação têxtil', 'silkscreen'],
    },
    tone_profile: {
      voice: 'direto, técnico mas acessível',
      formality: 'informal-profissional',
      avoid: ['gírias regionais fortes', 'jargão excessivo'],
      notes: 'Estamparia industrial em Brusque/SC, público B2B (lojistas e empresas que compram uniforme).',
    },
    style_examples: {
      before_after: [
        { before: 'a gente faz estampa em de teif', after: 'a gente faz estampa em DTF' },
        { before: 'aqui na quatro s estampas', after: 'aqui na 4S Estampas' },
      ],
    },
  },
  padrao: {
    client_name: 'Padrão (sem glossário)',
    subtitle_glossary: {
      terms: [],
      proper_nouns: [],
    },
    tone_profile: {
      voice: 'natural, como a pessoa falou',
      formality: 'neutro',
      avoid: [],
      notes: 'Sem perfil de cliente: corrigir apenas erros óbvios de transcrição, ortografia e pontuação.',
    },
    style_examples: {
      before_after: [],
    },
  },
};
