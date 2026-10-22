import { win32 } from 'node:path';

import { checkModelResponse, RESPONSE_SCHEMA } from '@eve-cut/core';
import type { BatchRunner } from '@eve-cut/core';
import { appDataDir } from '@eve-cut/core/bridge';
import { CLAUDE_MESSAGES, locateClaude, runClaude } from '@eve-cut/core/claude';
import type { ClaudeErrorKind } from '@eve-cut/core/claude';
import type { Settings } from '@eve-cut/core/settings';

/** Per batch: 40 blocks took about 40 s in the prototype; the runner tries invalid answers twice. */
const BATCH_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 60_000;

const TEST_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};

/** `%APPDATA%\eve-cut\work`: cwd of `claude -p` and home of the exported `.srt`. */
export function workDir(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(appDataDir(env), 'eve-cut', 'work');
}

/** Runs each batch through `claude -p` with the model from ⚙. */
export function makeBatchRunner(claudeExe: string, settings: Settings): BatchRunner {
  return ({ systemPrompt, userPrompt }) =>
    runClaude({
      systemPrompt,
      userPrompt,
      schema: RESPONSE_SCHEMA,
      model: settings.claude.model,
      timeoutMs: BATCH_TIMEOUT_MS,
      claudeExe,
      workDir: workDir(),
      validate: checkModelResponse,
    });
}

export type ClaudeTestResult =
  | { ok: true; claudeExe: string; durationMs: number }
  | { ok: false; kind: ClaudeErrorKind; message: string };

/** "Testar Claude" (⚙): the smallest prompt that still goes through the schema path. */
export async function testClaude(settings: Settings): Promise<ClaudeTestResult> {
  const claudeExe = await locateClaude({ configured: settings.claude.exePath });
  if (!claudeExe) {
    return { ok: false, kind: 'not_found', message: CLAUDE_MESSAGES.not_found };
  }
  const result = await runClaude({
    systemPrompt: 'Responda só com o JSON pedido.',
    userPrompt: 'Responda {"ok": true}.',
    schema: TEST_SCHEMA,
    model: settings.claude.model,
    timeoutMs: TEST_TIMEOUT_MS,
    claudeExe,
    workDir: workDir(),
  });
  if (!result.ok) return { ok: false, kind: result.kind, message: result.message };
  return { ok: true, claudeExe, durationMs: result.durationMs };
}
