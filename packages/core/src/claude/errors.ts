/** Why a `claude -p` run failed (SPEC §4.3). */
export type ClaudeErrorKind = 'not_found' | 'auth' | 'limit' | 'timeout' | 'invalid' | 'failed';

export interface ClaudeFailure {
  ok: false;
  kind: ClaudeErrorKind;
  /** Short pt-BR sentence for the panel (SPEC §12). */
  message: string;
  raw?: object;
  /** Worth one more try: an invalid answer or an overloaded / 5xx API. Never set for limit or auth. */
  retryable: boolean;
}

export const CLAUDE_MESSAGES = {
  not_found: 'Não achei o Claude Code neste PC. Confira o caminho em ⚙ → Claude Code.',
  auth: 'O Claude Code não está logado. Abra um terminal, rode `claude` e entre na sua conta.',
  limit: (detail: string) =>
    `Limite da assinatura do Claude atingido (${detail}). Dá para corrigir só com o glossário do cliente agora.`,
  timeout: 'O Claude demorou demais neste lote. Tente de novo ou diminua os blocos por lote em ⚙.',
  invalid: 'A resposta do Claude veio num formato inválido e nada foi alterado. Tente de novo.',
  failed: (detail: string) => `O Claude Code falhou${detail ? ` (${detail})` : ''}. Tente de novo.`,
} as const;

/** The parts of the `--output-format json` result the runner looks at. */
export interface ClaudeResultJson {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  api_error?: string;
  api_error_status?: number;
  result?: string;
  structured_output?: unknown;
  duration_ms?: number;
}

const AUTH_PATTERN = /not logged in|log ?in|\/login|authenticat|unauthori[sz]ed|invalid api key|oauth|credential/i;
const OVERLOAD_PATTERN = /overloaded|internal server error|service unavailable|bad gateway|timed? ?out/i;

export function failure(kind: ClaudeErrorKind, message: string, raw?: object, retryable = false): ClaudeFailure {
  return raw === undefined ? { ok: false, kind, message, retryable } : { ok: false, kind, message, raw, retryable };
}

/**
 * Map a result with `is_error: true` to a failure. `subtype` says "success" even then, so only
 * `is_error` and the API fields count.
 */
export function classifyErrorResult(json: ClaudeResultJson): ClaudeFailure {
  const detail = (json.result ?? '').trim();
  const status = json.api_error_status;

  if (json.api_error === 'usage_limit_reached') {
    return failure('limit', CLAUDE_MESSAGES.limit(detail || 'sem detalhe'), json);
  }
  if (status === 401 || status === 403 || json.api_error === 'authentication_error' || AUTH_PATTERN.test(detail)) {
    return failure('auth', CLAUDE_MESSAGES.auth, json);
  }
  const overloaded = (status !== undefined && status >= 500) || json.api_error === 'overloaded_error' || OVERLOAD_PATTERN.test(detail);
  return failure('failed', CLAUDE_MESSAGES.failed(shorten(detail || json.api_error || '')), json, overloaded);
}

/** A run that exited without a JSON result: missing login shows up on stderr. */
export function classifyNoJson(exitCode: number | null, stderr: string): ClaudeFailure {
  if (AUTH_PATTERN.test(stderr)) return failure('auth', CLAUDE_MESSAGES.auth);
  const detail = shorten(stderr.trim().split(/\r?\n/).pop() ?? '') || `código de saída ${String(exitCode)}`;
  return failure('failed', CLAUDE_MESSAGES.failed(detail), undefined, OVERLOAD_PATTERN.test(stderr));
}

function shorten(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
