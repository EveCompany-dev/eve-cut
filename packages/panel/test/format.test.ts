import type { CaptionJob } from '@eve-cut/core';
import { describe, expect, it } from 'vitest';

import { errorText, offerGlossaryOnly, proposedText, startTimecode, summaryText } from '../src/ui/captions/format.js';

function job(partial: Partial<CaptionJob> = {}): CaptionJob {
  return {
    profileSlug: null,
    mode: 'claude',
    blocks: [{ index: 4, num: '4', timing: '00:01:12,900 --> 00:01:14,000 X1:1', text: 'de teif' }],
    changes: [],
    batchCount: 1,
    errors: [],
    notRun: [],
    cancelled: false,
    log: [],
    ...partial,
  };
}

const base = { before: 'de teif', ruleText: null, review: 'pendente', editedText: null, reason: null } as const;

describe('captions format', () => {
  it('counts rule, Claude and auto-rejected changes', () => {
    const j = job({
      changes: [
        { ...base, id: '4:regra', index: 4, after: 'DTF', kind: 'glossario', source: 'regra', status: 'pendente' },
        { ...base, id: '5:claude', index: 5, after: 'x', kind: 'outro', source: 'claude', status: 'pendente' },
        { ...base, id: '6:claude', index: 6, after: 'y', kind: 'outro', source: 'claude', status: 'rejeitada_auto' },
      ],
    });
    expect(summaryText(j)).toBe('2 alterações · 1 regra · 1 Claude · 1 recusada automaticamente');
    expect(summaryText(job())).toBe('0 alterações · 0 regra · 0 Claude');
  });

  it('shows each error message once and offers the glossary only after a failure', () => {
    const limit = { kind: 'limit', message: 'Limite atingido.' } as const;
    const failed = job({
      batchCount: 3,
      errors: [
        { batch: 1, from: 1, to: 40, ...limit },
        { batch: 2, from: 41, to: 80, ...limit },
      ],
    });

    expect(errorText(failed)).toBe(
      '2 de 3 lotes ficaram sem a correção do Claude (esses blocos continuam como estavam).\nLimite atingido.',
    );
    expect(errorText(job())).toBeNull();
    expect(offerGlossaryOnly(failed)).toBe(true);
    expect(offerGlossaryOnly(job())).toBe(false);
    expect(offerGlossaryOnly(job({ mode: 'glossario', errors: failed.errors }))).toBe(false);
  });

  it('formats the start time and the proposed text', () => {
    const change = { ...base, id: '4:regra', index: 4, after: 'DTF', kind: 'glossario', source: 'regra', status: 'pendente' } as const;
    expect(startTimecode(job(), change)).toBe('00:01:12');
    expect(startTimecode(job(), { ...change, index: 9 })).toBe('');
    expect(proposedText(change)).toBe('DTF');
    expect(proposedText({ ...change, editedText: 'D.T.F.' })).toBe('D.T.F.');
  });
});
