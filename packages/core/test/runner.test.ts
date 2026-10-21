import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { exeBehindShim, locateClaude, RunQueue, runClaude, type RunClaudeOptions } from '../src/claude/index.js';
import { checkModelResponse, RESPONSE_SCHEMA } from '../src/prompt/index.js';

const FAKE = fileURLToPath(new URL('./fake-claude/fake-claude.mjs', import.meta.url));

interface Call {
  argv: string[];
  stdin: string;
  systemPrompt: string | null;
  cwd: string;
  apiKey: string | null;
  pid: number;
}

let dir: string;
let workDir: string;
let logFile: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'eve-cut-runner-'));
  workDir = join(dir, 'work');
  logFile = join(dir, 'calls.log');
  process.env['FAKE_CLAUDE_LOG'] = logFile;
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(dir, { recursive: true, force: true });
});

function scenario(name: string): void {
  process.env['FAKE_CLAUDE_SCENARIO'] = name;
}

function calls(): Call[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Call);
}

function options(overrides: Partial<RunClaudeOptions> = {}): RunClaudeOptions {
  return {
    systemPrompt: 'regras do sistema',
    userPrompt: 'Revise estes blocos: [{"index":1,"text":"fazemos estampa em de teif"}]',
    schema: RESPONSE_SCHEMA,
    model: 'sonnet',
    timeoutMs: 10_000,
    claudeExe: process.execPath,
    exeArgs: [FAKE],
    workDir,
    validate: checkModelResponse,
    ...overrides,
  };
}

const CHANGES = { changes: [{ index: 1, text: 'fazemos estampa em DTF', kind: 'glossario' }] };

describe('runClaude', () => {
  it('returns structured_output on success', async () => {
    scenario('success');

    const result = await runClaude(options());

    expect(result).toMatchObject({ ok: true, data: CHANGES, durationMs: 1234 });
    expect(calls()).toHaveLength(1);
  });

  it('falls back to parsing `result` when there is no structured_output', async () => {
    scenario('success-result');
    expect(await runClaude(options())).toMatchObject({ ok: true, data: CHANGES });

    scenario('success-fenced');
    expect(await runClaude(options())).toMatchObject({ ok: true, data: CHANGES });
  });

  it('passes the safe arguments, without a shell, and the prompts', async () => {
    scenario('success');

    await runClaude(options());

    const [call] = calls();
    const argv = call!.argv;
    expect(argv.slice(0, 2)).toEqual(['-p', '--safe-mode']);
    expect(argv[argv.indexOf('--tools') + 1]).toBe('');
    expect(argv).toContain('--no-session-persistence');
    expect(argv[argv.indexOf('--output-format') + 1]).toBe('json');
    expect(argv[argv.indexOf('--model') + 1]).toBe('sonnet');
    expect(JSON.parse(argv[argv.indexOf('--json-schema') + 1]!)).toEqual(RESPONSE_SCHEMA);
    expect(call!.systemPrompt).toBe('regras do sistema');
    expect(call!.stdin).toBe(options().userPrompt);
    expect(call!.cwd).toBe(workDir);
  });

  it('removes the temporary system prompt file', async () => {
    scenario('success');

    await runClaude(options());

    expect(readdirSync(workDir)).toEqual([]);
  });

  it('can send the system prompt inline', async () => {
    scenario('success');

    await runClaude(options({ systemPromptMode: 'inline' }));

    const argv = calls()[0]!.argv;
    expect(argv).not.toContain('--system-prompt-file');
    expect(argv[argv.indexOf('--system-prompt') + 1]).toBe('regras do sistema');
  });

  it('never hands an API key to Claude Code', async () => {
    scenario('success');
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-nao-usar';

    await runClaude(options());

    expect(calls()[0]!.apiKey).toBeNull();
  });

  it('maps the usage limit to `limit` with the reset text, without retrying', async () => {
    scenario('limit');

    const result = await runClaude(options());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('limit');
    expect(result.message).toContain("You've hit your weekly limit · resets Oct 23, 2am");
    expect(result.message).toMatch(/^Limite da assinatura do Claude atingido/);
    expect(result.raw).toMatchObject({ api_error: 'usage_limit_reached' });
    expect(calls()).toHaveLength(1);
  });

  it('maps a missing login to `auth`, without retrying', async () => {
    scenario('auth');

    const result = await runClaude(options());

    expect(result).toMatchObject({ ok: false, kind: 'auth' });
    expect(calls()).toHaveLength(1);
  });

  it('retries once an answer outside the schema, then gives `invalid`', async () => {
    scenario('invalid-schema');

    const result = await runClaude(options());

    expect(result).toMatchObject({
      ok: false,
      kind: 'invalid',
      message: 'A resposta do Claude veio num formato inválido e nada foi alterado. Tente de novo.',
    });
    expect(calls()).toHaveLength(2);
  });

  it('succeeds when the retry of an invalid answer is valid', async () => {
    scenario('invalid-then-ok');

    expect(await runClaude(options())).toMatchObject({ ok: true, data: CHANGES });
    expect(calls()).toHaveLength(2);
  });

  it('retries once an overloaded API', async () => {
    scenario('overloaded-then-ok');

    expect(await runClaude(options())).toMatchObject({ ok: true });
    expect(calls()).toHaveLength(2);
  });

  it('gives `timeout` and kills the process', async () => {
    scenario('slow');

    const result = await runClaude(options({ timeoutMs: 500 }));

    expect(result).toMatchObject({ ok: false, kind: 'timeout' });
    const pid = calls()[0]!.pid;
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('gives `not_found` for a missing executable', async () => {
    const result = await runClaude(options({ claudeExe: join(dir, 'nao-existe', 'claude.exe'), exeArgs: [] }));

    expect(result).toMatchObject({
      ok: false,
      kind: 'not_found',
      message: 'Não achei o Claude Code neste PC. Confira o caminho em ⚙ → Claude Code.',
    });
  });

  it('gives `failed` with the stderr line on exit 1 without JSON', async () => {
    scenario('exit1');

    const result = await runClaude(options());

    expect(result).toMatchObject({ ok: false, kind: 'failed' });
    if (!result.ok) expect(result.message).toContain('something broke');
  });

  it('refuses an inline system prompt too long for the command line', async () => {
    scenario('success');

    const result = await runClaude(options({ systemPromptMode: 'inline', systemPrompt: 'x'.repeat(30_001) }));

    expect(result).toMatchObject({ ok: false, kind: 'failed' });
    expect(calls()).toHaveLength(0);
  });

  it('runs at most two processes at once', async () => {
    scenario('delay');
    process.env['FAKE_CLAUDE_DELAY_MS'] = '300';
    const queue = new RunQueue(2);

    const started = Date.now();
    const results = await Promise.all([1, 2, 3, 4].map(() => runClaude(options(), queue)));
    const elapsed = Date.now() - started;

    expect(results.every((r) => r.ok)).toBe(true);
    // 4 runs of ~300 ms two at a time take at least two rounds.
    expect(elapsed).toBeGreaterThanOrEqual(600);
  });
});

describe('RunQueue', () => {
  it('never exceeds the limit and runs everything in order', async () => {
    const queue = new RunQueue(2);
    let running = 0;
    let peak = 0;
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        queue.run(async () => {
          running++;
          peak = Math.max(peak, running);
          order.push(n);
          await new Promise((resolve) => setTimeout(resolve, 20));
          running--;
        }),
      ),
    );

    expect(peak).toBe(2);
    expect(order).toEqual([1, 2, 3, 4, 5]);
  });

  it('frees the slot when a task throws', async () => {
    const queue = new RunQueue(1);

    await expect(queue.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(queue.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('locateClaude', () => {
  const NPM = 'C:\\Users\\jose\\AppData\\Roaming\\npm';
  const EXE = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;

  it('uses the configured path when it exists', async () => {
    const found = await locateClaude({
      configured: 'D:\\tools\\claude.exe',
      exists: (p) => p === 'D:\\tools\\claude.exe',
      where: async () => [],
    });

    expect(found).toBe('D:\\tools\\claude.exe');
  });

  it('derives claude.exe from the npm shim found by where.exe', async () => {
    const found = await locateClaude({
      configured: '',
      where: async () => [`${NPM}\\claude`, `${NPM}\\claude.cmd`, ''],
      exists: (p) => p === EXE,
    });

    expect(found).toBe(EXE);
  });

  it('prefers a claude.exe on the PATH', async () => {
    const native = 'C:\\Users\\jose\\.local\\bin\\claude.exe';

    const found = await locateClaude({ where: async () => [`${NPM}\\claude.cmd`, native], exists: () => true });

    expect(found).toBe(native);
  });

  it('returns null when nothing is found', async () => {
    expect(await locateClaude({ where: () => Promise.reject(new Error('INFO: no files')) })).toBeNull();
    expect(await locateClaude({ where: async () => [`${NPM}\\claude.cmd`], exists: () => false })).toBeNull();
  });

  it('only derives from files named claude', () => {
    expect(exeBehindShim(`${NPM}\\claude.cmd`)).toBe(EXE);
    expect(exeBehindShim(`${NPM}\\claude.ps1`)).toBe(EXE);
    expect(exeBehindShim(`${NPM}\\notclaude.cmd`)).toBeNull();
  });
});
