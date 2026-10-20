export interface CepApi {
  evalScript(script: string, callback: (result: string) => void): void;
}

type HostResponse<T> = { ok: true; data?: T } | { ok: false; error: string };

export function cepApi(): CepApi | undefined {
  return (globalThis as { __adobe_cep__?: CepApi }).__adobe_cep__;
}

/**
 * Call an ExtendScript function, passing one JSON string as its only argument.
 *
 * The argument travels as a JavaScript string literal. It is JSON-encoded twice: once to make the
 * payload JSON, once to make it a literal the ES3 engine can parse. U+2028/U+2029 are line
 * terminators inside ES3 string literals and must be escaped or the call would break mid-line.
 */
export function callHost<T>(fn: string, arg: unknown): Promise<T> {
  const literal = JSON.stringify(JSON.stringify(arg ?? null))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return new Promise<T>((resolve, reject) => {
    const cep = cepApi();
    if (!cep) {
      reject(new Error('Fora do Premiere'));
      return;
    }

    cep.evalScript(`${fn}(${literal})`, (raw) => {
      let response: HostResponse<T>;
      try {
        response = JSON.parse(raw) as HostResponse<T>;
      } catch {
        reject(new Error(`Resposta inválida do host: ${raw}`));
        return;
      }

      if (response.ok) {
        resolve(response.data as T);
      } else {
        reject(new Error(response.error));
      }
    });
  });
}
