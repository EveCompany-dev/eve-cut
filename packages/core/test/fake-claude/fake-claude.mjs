// Stand-in for claude.exe in the runner tests. The scenario comes from FAKE_CLAUDE_SCENARIO; every
// call appends { argv, stdin, apiKey } to FAKE_CLAUDE_LOG (one JSON per line) so tests can count
// runs and inspect the arguments.
import { appendFileSync, readFileSync } from 'node:fs';

const scenario = process.env.FAKE_CLAUDE_SCENARIO ?? 'success';
const log = process.env.FAKE_CLAUDE_LOG;

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (stdin += chunk));
process.stdin.on('end', main);

function previousCalls() {
  if (!log) return 0;
  try {
    return readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function result(fields) {
  return JSON.stringify({ type: 'result', subtype: 'success', duration_ms: 1234, session_id: 'fake', ...fields });
}

const CHANGES = { changes: [{ index: 1, text: 'fazemos estampa em DTF', kind: 'glossario' }] };
const OVERLOADED = result({ is_error: true, api_error_status: 529, api_error: 'overloaded_error', result: 'Overloaded' });

function main() {
  const calls = previousCalls();
  if (log) {
    const argv = process.argv.slice(2);
    const fileIndex = argv.indexOf('--system-prompt-file');
    const systemPrompt = fileIndex >= 0 ? readFileSync(argv[fileIndex + 1], 'utf8') : null;
    appendFileSync(
      log,
      `${JSON.stringify({ argv, stdin, systemPrompt, cwd: process.cwd(), apiKey: process.env.ANTHROPIC_API_KEY ?? null, pid: process.pid })}\n`,
    );
  }

  switch (scenario) {
    case 'success':
      return out(result({ is_error: false, result: '', structured_output: CHANGES }));
    case 'success-result':
      return out(result({ is_error: false, result: JSON.stringify(CHANGES) }));
    case 'success-fenced':
      return out(result({ is_error: false, result: '```json\n' + JSON.stringify(CHANGES) + '\n```' }));
    case 'limit':
      process.stdout.write(
        result({
          is_error: true,
          api_error_status: 429,
          api_error: 'usage_limit_reached',
          result: "You've hit your weekly limit · resets Oct 23, 2am (America/Sao_Paulo)",
          terminal_reason: 'api_error',
          num_turns: 1,
          total_cost_usd: 0,
        }),
      );
      return process.exit(1);
    case 'auth':
      process.stdout.write(result({ is_error: true, result: 'Not logged in · Please run /login' }));
      return process.exit(1);
    case 'invalid-schema':
      return out(result({ is_error: false, structured_output: { changes: [{ index: 'um', texto: 'x' }] } }));
    case 'invalid-then-ok':
      return calls === 0
        ? out(result({ is_error: false, result: 'não é JSON' }))
        : out(result({ is_error: false, structured_output: CHANGES }));
    case 'overloaded-then-ok':
      return calls === 0 ? (process.stdout.write(OVERLOADED), process.exit(1)) : out(result({ is_error: false, structured_output: CHANGES }));
    case 'slow':
      setTimeout(() => out(result({ is_error: false, structured_output: CHANGES })), 30_000);
      return;
    case 'delay':
      setTimeout(() => out(result({ is_error: false, structured_output: CHANGES })), Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 200));
      return;
    case 'exit1':
      process.stderr.write('Error: something broke\n');
      return process.exit(1);
    default:
      process.stderr.write(`unknown scenario ${scenario}\n`);
      return process.exit(2);
  }
}

function out(text) {
  process.stdout.write(text);
}
