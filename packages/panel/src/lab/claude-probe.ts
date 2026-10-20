import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { win32 } from 'node:path';

import { appDataDir } from '@eve-cut/core/bridge';

const TIMEOUT_MS = 120_000;

const SCHEMA = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          text: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['ortografia', 'pontuacao', 'glossario', 'nome_proprio', 'concordancia', 'outro'],
          },
        },
        required: ['index', 'text', 'kind'],
        additionalProperties: false,
      },
    },
  },
  required: ['changes'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  'Você corrige legendas de vídeos falados em português do Brasil.',
  'Devolva só os blocos alterados em changes[], cada um com index, text e kind.',
  'Nunca mude o número de linhas de um bloco. Não junte, não divida, não traduza.',
  'Termos protegidos: 4S Estampas e Uniformes, Brusque, DTF.',
  'Glossário: "de teif" -> "DTF"; "quatro s estampas" -> "4S Estampas".',
].join('\n');

export interface ClaudeProbeOptions {
  claudeExe?: string;
  model?: string;
  blocks?: number;
}

interface Attempt {
  variant: 'file' | 'inline';
  command: string;
  args: string[];
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  parsed: unknown;
  parseError: string | null;
  hasStructuredOutput: boolean;
  error: string | null;
}

export interface ClaudeProbeResult {
  claudeExe: string;
  model: string;
  blocks: number;
  workDir: string;
  systemPromptChars: number;
  attempts: Attempt[];
  structuredOutputSeen: boolean;
  note: string;
}

/**
 * P7: run `claude -p` from the panel's Node, with the same arguments the runner will use.
 *
 * It is a probe, not the runner (that arrives with F1): it only answers whether the executable is
 * reachable, whether `--system-prompt-file` works without `--bare` and whether the JSON output
 * carries `structured_output`. Each attempt consumes the subscription, so there are at most two.
 */
export async function runClaudeProbe(options: ClaudeProbeOptions = {}): Promise<ClaudeProbeResult> {
  const claudeExe = options.claudeExe?.trim() || 'claude';
  const model = options.model?.trim() || 'sonnet';
  const blocks = Math.min(Math.max(Math.round(options.blocks ?? 40), 1), 200);
  const workDir = win32.join(appDataDir(), 'eve-cut', 'work');
  mkdirSync(workDir, { recursive: true });

  const systemPromptFile = win32.join(workDir, 'system-prompt-p7.txt');
  writeFileSync(systemPromptFile, SYSTEM_PROMPT, 'utf8');

  const userPrompt = JSON.stringify({ blocks: sampleBlocks(blocks) }, null, 2);
  const schema = JSON.stringify(SCHEMA);
  const commonArgs = [
    '-p',
    '--safe-mode',
    '--tools',
    '',
    '--no-session-persistence',
    '--output-format',
    'json',
    '--model',
    model,
    '--json-schema',
    schema,
  ];

  const attempts: Attempt[] = [];
  const fileAttempt = await runOnce(
    {
      variant: 'file',
      command: claudeExe,
      args: [...commonArgs, '--system-prompt-file', systemPromptFile],
    },
    userPrompt,
  );
  attempts.push(fileAttempt);

  const fileOptionRejected =
    /system-prompt-file|unknown option|unrecognized|invalid option/i.test(fileAttempt.stderr) ||
    /system-prompt-file/i.test(fileAttempt.error ?? '');
  if (fileOptionRejected) {
    attempts.push(
      await runOnce(
        {
          variant: 'inline',
          command: claudeExe,
          args: [...commonArgs, '--system-prompt', SYSTEM_PROMPT],
        },
        userPrompt,
      ),
    );
  }

  return {
    claudeExe,
    model,
    blocks,
    workDir,
    systemPromptChars: SYSTEM_PROMPT.length,
    attempts,
    structuredOutputSeen: attempts.some((attempt) => attempt.hasStructuredOutput),
    note: 'Cada tentativa consome o limite da assinatura. Copie o resultado bruto para docs/PROVAS.md.',
  };
}

interface AttemptSpec {
  variant: 'file' | 'inline';
  command: string;
  args: string[];
}

function runOnce(spec: AttemptSpec, prompt: string): Promise<Attempt> {
  return new Promise<Attempt>((resolve) => {
    const started = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(spec.command, spec.args, { windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      resolve({
        ...spec,
        exitCode: null,
        timedOut,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        parsed: null,
        parseError: null,
        hasStructuredOutput: false,
        error: error.message,
      });
    });
    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      const { parsed, parseError } = parseStdout(stdout);
      resolve({
        ...spec,
        exitCode: code,
        timedOut,
        durationMs: Date.now() - started,
        stdout,
        stderr,
        parsed,
        parseError,
        hasStructuredOutput: hasStructuredOutput(parsed),
        error: null,
      });
    });

    child.stdin.end(prompt);
  });
}

function parseStdout(stdout: string): { parsed: unknown; parseError: string | null } {
  try {
    return { parsed: JSON.parse(stdout), parseError: null };
  } catch {
    return { parsed: null, parseError: 'stdout não é um JSON único' };
  }
}

function hasStructuredOutput(parsed: unknown): boolean {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    Object.prototype.hasOwnProperty.call(parsed, 'structured_output')
  );
}

function sampleBlocks(count: number): Array<{ index: number; text: string }> {
  const texts = [
    'a gente faz estampa em de teif',
    'aqui na quatro s estampas a gente atende Brusque',
    'o tecido sai da sublimação e chega pronto',
  ];

  const blocks: Array<{ index: number; text: string }> = [];
  for (let index = 1; index <= count; index++) {
    blocks.push({ index, text: `${texts[(index - 1) % texts.length]} (bloco ${index})` });
  }
  return blocks;
}
