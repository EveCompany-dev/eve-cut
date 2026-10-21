import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CLAUDE_MESSAGES, classifyErrorResult, classifyNoJson, failure } from './errors.js';
import type { ClaudeFailure, ClaudeResultJson } from './errors.js';
import { MAX_CONCURRENT_RUNS, RunQueue } from './queue.js';

export const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'fable'] as const;
export type ClaudeModel = (typeof CLAUDE_MODELS)[number];

export interface RunClaudeOptions {
  systemPrompt: string;
  userPrompt: string;
  /** JSON Schema for `--json-schema`. */
  schema: object;
  model: string;
  timeoutMs: number;
  claudeExe: string;
  /** Empty folder used as `cwd` and for the temporary system prompt file. */
  workDir: string;
  /** Arguments placed before the Claude flags; tests use it to run `node fake-claude.mjs`. */
  exeArgs?: string[];
  /**
   * `file` = `--system-prompt-file` (default). `inline` = `--system-prompt`, the fallback if P7
   * shows the file option needs `--bare`.
   */
  systemPromptMode?: 'file' | 'inline';
  /** Checks the data against what the caller expects; returns the reason when it does not match. */
  validate?: (data: unknown) => string | null;
}

export interface ClaudeSuccess {
  ok: true;
  data: unknown;
  durationMs: number;
  raw: object;
}

export type ClaudeRunResult = ClaudeSuccess | ClaudeFailure;

/** Inline system prompts go on the command line, which Windows caps at 32 767 characters. */
const INLINE_PROMPT_LIMIT = 30_000;

const sharedQueue = new RunQueue(MAX_CONCURRENT_RUNS);

/**
 * Run `claude -p` once for a prompt and a JSON schema (SPEC §4.3), through the shared queue.
 *
 * One more try for an invalid answer and for an overloaded / 5xx API; never for the usage limit,
 * a missing login or a missing executable.
 */
export function runClaude(options: RunClaudeOptions, queue: RunQueue = sharedQueue): Promise<ClaudeRunResult> {
  return queue.run(async () => {
    const first = await runOnce(options);
    if (first.ok || !first.retryable) return first;
    return runOnce(options);
  });
}

export function claudeArgs(options: RunClaudeOptions, systemPromptFile: string | null): string[] {
  const args = [
    ...(options.exeArgs ?? []),
    '-p',
    // No CLAUDE.md, hooks, plugins or user MCPs: they must not steer the correction.
    '--safe-mode',
    // Empty on purpose: no tools, the answer is only the JSON.
    '--tools',
    '',
    '--no-session-persistence',
    '--output-format',
    'json',
    '--model',
    options.model,
  ];
  if (systemPromptFile) args.push('--system-prompt-file', systemPromptFile);
  else args.push('--system-prompt', options.systemPrompt);
  args.push('--json-schema', JSON.stringify(options.schema));
  return args;
}

async function runOnce(options: RunClaudeOptions): Promise<ClaudeRunResult> {
  const inline = options.systemPromptMode === 'inline';
  if (inline && options.systemPrompt.length > INLINE_PROMPT_LIMIT) {
    return failure('failed', CLAUDE_MESSAGES.failed('prompt grande demais para a linha de comando'));
  }

  mkdirSync(options.workDir, { recursive: true });
  const promptFile = inline ? null : join(options.workDir, `system-prompt-${randomBytes(6).toString('hex')}.txt`);
  if (promptFile) writeFileSync(promptFile, options.systemPrompt, 'utf8');

  try {
    const started = Date.now();
    const exit = await spawnClaude(options, claudeArgs(options, promptFile));
    return interpret(exit, options, Date.now() - started);
  } finally {
    if (promptFile) rmSync(promptFile, { force: true });
  }
}

interface ProcessExit {
  spawnError: NodeJS.ErrnoException | null;
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function spawnClaude(options: RunClaudeOptions, args: string[]): Promise<ProcessExit> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let spawnError: NodeJS.ErrnoException | null = null;

    // An API key in the environment would make Claude Code bill the API instead of the subscription.
    const env = { ...process.env };
    delete env['ANTHROPIC_API_KEY'];

    // No shell: with one, the empty argument after `--tools` disappears.
    const child = spawn(options.claudeExe, args, { cwd: options.workDir, env, windowsHide: true, shell: false });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    // A child that dies before reading stdin makes the write fail; the exit code tells the story.
    child.stdin.on('error', () => {});
    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = error;
    });
    child.on('close', (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({ spawnError, timedOut, exitCode, stdout, stderr });
    });

    child.stdin.end(options.userPrompt, 'utf8');
  });
}

function interpret(exit: ProcessExit, options: RunClaudeOptions, elapsedMs: number): ClaudeRunResult {
  if (exit.spawnError) {
    if (exit.spawnError.code === 'ENOENT' || exit.spawnError.code === 'EACCES') {
      return failure('not_found', CLAUDE_MESSAGES.not_found);
    }
    return failure('failed', CLAUDE_MESSAGES.failed(exit.spawnError.message));
  }
  if (exit.timedOut) return failure('timeout', CLAUDE_MESSAGES.timeout);

  const json = parseResult(exit.stdout);
  if (!json) return classifyNoJson(exit.exitCode, exit.stderr);
  if (json.is_error) return classifyErrorResult(json);

  const data = extractData(json);
  if (data === undefined) return failure('invalid', CLAUDE_MESSAGES.invalid, json, true);
  const problem = options.validate?.(data) ?? null;
  if (problem) return failure('invalid', CLAUDE_MESSAGES.invalid, json, true);

  return { ok: true, data, durationMs: json.duration_ms ?? elapsedMs, raw: json };
}

function parseResult(stdout: string): ClaudeResultJson | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as ClaudeResultJson) : null;
  } catch {
    return null;
  }
}

/** `structured_output` when present (P7); otherwise the `result` text parsed as JSON. */
function extractData(json: ClaudeResultJson): unknown {
  if (json.structured_output !== undefined && json.structured_output !== null) return json.structured_output;
  if (typeof json.result !== 'string') return undefined;
  try {
    return JSON.parse(stripCodeFence(json.result)) as unknown;
  } catch {
    return undefined;
  }
}

function stripCodeFence(text: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(text);
  return fenced ? fenced[1]! : text;
}
