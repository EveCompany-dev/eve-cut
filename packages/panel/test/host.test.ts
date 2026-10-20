import { afterEach, describe, expect, it } from 'vitest';

import { callHost } from '../src/premiere/host.js';
import type { CepApi } from '../src/premiere/host.js';

const globalWithCep = globalThis as typeof globalThis & { __adobe_cep__?: CepApi };

/** Fake CEP: records the generated script and answers with `raw`. */
function fakeCep(raw: string | ((script: string) => string)): { api: CepApi; scripts: string[] } {
  const scripts: string[] = [];
  const api: CepApi = {
    evalScript(script, callback) {
      scripts.push(script);
      callback(typeof raw === 'function' ? raw(script) : raw);
    },
  };
  return { api, scripts };
}

/** Recover the argument the host would receive: two JSON decodes, like a JS literal + JSON.parse. */
function hostArgument(script: string): unknown {
  const literal = script.slice(script.indexOf('(') + 1, script.lastIndexOf(')'));
  return JSON.parse(JSON.parse(literal) as string) as unknown;
}

afterEach(() => {
  delete globalWithCep.__adobe_cep__;
});

describe('callHost', () => {
  it('delivers quotes, backslashes, newlines, U+2028 and accents intact', async () => {
    const payload = {
      text: 'aspas "duplas" e \'simples\'; barra \\ invertida\nsegunda linha\u2028fim; ação e coração',
    };
    const { api, scripts } = fakeCep(JSON.stringify({ ok: true, data: { received: true } }));
    globalWithCep.__adobe_cep__ = api;

    await expect(callHost('evePing', payload)).resolves.toEqual({ received: true });

    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('evePing(');
    expect(hostArgument(scripts[0]!)).toEqual(payload);
    // U+2028 is a line terminator in ES3 literals: it must travel escaped, never raw.
    expect(scripts[0]).not.toContain('\u2028');
    expect(scripts[0]).toContain('\\u2028');
  });

  it('resolves the host data when the response is ok', async () => {
    const { api } = fakeCep(
      JSON.stringify({
        ok: true,
        data: { appVersion: '26.0.0', projectPath: null, sequence: { name: 'Reels 4S', id: 'abc' } },
      }),
    );
    globalWithCep.__adobe_cep__ = api;

    await expect(callHost('evePing', null)).resolves.toEqual({
      appVersion: '26.0.0',
      projectPath: null,
      sequence: { name: 'Reels 4S', id: 'abc' },
    });
  });

  it('rejects with the error message from the host', async () => {
    const { api } = fakeCep(JSON.stringify({ ok: false, error: 'nenhum projeto aberto' }));
    globalWithCep.__adobe_cep__ = api;

    await expect(callHost('evePing', null)).rejects.toThrow('nenhum projeto aberto');
  });

  it('turns an invalid host response into a readable error', async () => {
    const { api } = fakeCep('undefined');
    globalWithCep.__adobe_cep__ = api;

    await expect(callHost('evePing', null)).rejects.toThrow(
      'Resposta inválida do host: undefined',
    );
  });

  it('rejects when the panel is not running inside Premiere', async () => {
    await expect(callHost('evePing', null)).rejects.toThrow('Fora do Premiere');
  });
});
