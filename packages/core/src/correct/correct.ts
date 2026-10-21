import { makeBatches } from '../batch/batch.js';
import type { Batch } from '../batch/batch.js';
import type { ClaudeErrorKind } from '../claude/errors.js';
import { MAX_CONCURRENT_RUNS, RunQueue } from '../claude/queue.js';
import type { ClaudeRunResult } from '../claude/runner.js';
import { applyGlossary } from '../glossary/apply.js';
import type { GlossaryChange } from '../glossary/apply.js';
import type { Profile } from '../profile/schema.js';
import { buildSystemPrompt, buildUserPrompt } from '../prompt/build.js';
import { ModelResponseSchema } from '../prompt/schema.js';
import type { SrtBlock } from '../srt/types.js';
import { validateChanges } from '../validate/validate.js';
import type { ReviewedChange } from '../validate/validate.js';

/** What José decided about a change in the review (SPEC §5.6). */
export type ReviewState = 'pendente' | 'aceita' | 'recusada' | 'editada';

/** One item of the review. */
export interface JobChange extends ReviewedChange {
  /** `<index>:regra` or `<index>:claude`. */
  id: string;
  /** The block text in the original `.srt`; the diff goes from here to `after`. */
  before: string;
  /**
   * Text after the exact glossary when the rule also changed this block. A Claude change always
   * starts from it, so accepting the Claude change keeps the glossary swaps.
   */
  ruleText: string | null;
  review: ReviewState;
  /** José's text when `review` is `editada`. */
  editedText: string | null;
}

export interface BatchError {
  /** 1-based batch number, as shown in the progress. */
  batch: number;
  /** First and last editable block of the batch. */
  from: number;
  to: number;
  kind: ClaudeErrorKind;
  message: string;
}

export interface CaptionJob {
  profileSlug: string | null;
  /** `glossario` = the glossary-only mode, without Claude. */
  mode: 'claude' | 'glossario';
  /** The blocks as read from the `.srt`; never modified. */
  blocks: SrtBlock[];
  /**
   * Sorted by block. A block has at most one item that is not `rejeitada_auto`; when Claude's
   * change was rejected, the glossary change of the same block stays as its own item.
   */
  changes: JobChange[];
  batchCount: number;
  errors: BatchError[];
  /** Batches with no result because the job was cancelled (not started, or still running). */
  notRun: number[];
  cancelled: boolean;
  log: string[];
}

export type BatchRunner = (request: { systemPrompt: string; userPrompt: string; batch: Batch }) => Promise<ClaudeRunResult>;

export interface CorrectProgress {
  done: number;
  total: number;
  /** 1-based number of the batch that just finished. */
  batch: number;
  ok: boolean;
}

export interface CorrectOptions {
  /** `null` = glossary-only mode. The panel passes `runClaude` with the schema and the settings. */
  runner: BatchRunner | null;
  batchSize?: number;
  context?: number;
  concurrency?: number;
  onProgress?: (progress: CorrectProgress) => void;
  /** Stops the batches that have not started; what already came back is kept. */
  signal?: AbortSignal;
}

/** After these, the other batches would fail the same way; they are not even started. */
const FATAL_KINDS: readonly ClaudeErrorKind[] = ['limit', 'auth', 'not_found'];

/**
 * Correct the captions (SPEC §5.2–§5.5): exact glossary → batches → runner (in parallel, capped by
 * the queue) → validation → one `CaptionJob`. A block the model leaves out keeps its text, and a
 * failed batch only loses its own blocks' Claude changes.
 */
export async function correctCaptions(
  blocks: readonly SrtBlock[],
  profile: Profile | null,
  options: CorrectOptions,
): Promise<CaptionJob> {
  const log: string[] = [];
  const glossary = profile ? applyGlossary(blocks, profile) : { blocks: [...blocks], changes: [] };
  const job: CaptionJob = {
    profileSlug: profile?.slug ?? null,
    mode: options.runner ? 'claude' : 'glossario',
    blocks: [...blocks],
    changes: [],
    batchCount: 0,
    errors: [],
    notRun: [],
    cancelled: false,
    log,
  };

  const claudeChanges: ReviewedChange[] = [];
  if (options.runner) {
    const batches = makeBatches(glossary.blocks, options.batchSize ?? 40, options.context ?? 3);
    job.batchCount = batches.length;
    await runBatches(batches, profile, options.runner, options, job, claudeChanges);
  }

  job.changes = assemble(blocks, glossary.changes, claudeChanges);
  return job;
}

async function runBatches(
  batches: Batch[],
  profile: Profile | null,
  runner: BatchRunner,
  options: CorrectOptions,
  job: CaptionJob,
  claudeChanges: ReviewedChange[],
): Promise<void> {
  const systemPrompt = buildSystemPrompt(profile);
  const queue = new RunQueue(options.concurrency ?? MAX_CONCURRENT_RUNS);
  const finished = new Set<number>();
  let fatal: { kind: ClaudeErrorKind; message: string } | null = null;
  let closed = false;
  let done = 0;

  const settle = (i: number, error: { kind: ClaudeErrorKind; message: string } | null): void => {
    if (closed) return;
    finished.add(i);
    if (error) job.errors.push({ batch: i + 1, ...editableRange(batches[i]!), ...error });
    done++;
    options.onProgress?.({ done, total: batches.length, batch: i + 1, ok: !error });
  };

  const tasks = batches.map((batch, i) =>
    queue.run(async () => {
      if (closed || options.signal?.aborted) return;
      if (fatal) return settle(i, fatal);

      let result: ClaudeRunResult;
      try {
        result = await runner({ systemPrompt, userPrompt: buildUserPrompt(batch), batch });
      } catch (err) {
        result = { ok: false, kind: 'failed', message: (err as Error).message, retryable: false };
      }
      if (closed) return;

      if (!result.ok) {
        if (FATAL_KINDS.includes(result.kind)) fatal = { kind: result.kind, message: result.message };
        return settle(i, { kind: result.kind, message: result.message });
      }
      const parsed = ModelResponseSchema.safeParse(result.data);
      if (!parsed.success) {
        return settle(i, {
          kind: 'invalid',
          message: 'A resposta do Claude veio num formato inválido e nada foi alterado. Tente de novo.',
        });
      }
      claudeChanges.push(...validateChanges(batch, parsed.data.changes, profile, { log: (m) => job.log.push(m) }));
      settle(i, null);
    }),
  );

  await untilDoneOrAborted(Promise.all(tasks), options.signal);
  closed = true;
  if (options.signal?.aborted) {
    job.cancelled = true;
    job.notRun = batches.map((_, i) => i + 1).filter((n) => !finished.has(n - 1));
  }
}

/** Resolves when every batch settled or as soon as the signal aborts, whichever comes first. */
async function untilDoneOrAborted(all: Promise<unknown>, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) {
    await all;
    return;
  }
  let onAbort: () => void = () => {};
  const aborted = new Promise<void>((resolve) => {
    onAbort = resolve;
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([all, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function editableRange(batch: Batch): { from: number; to: number } {
  const editable = batch.items.filter((item) => item.editable);
  return { from: editable[0]?.index ?? 0, to: editable[editable.length - 1]?.index ?? 0 };
}

/** One review item per changed block, combining the rule and Claude when both touched it. */
function assemble(
  blocks: readonly SrtBlock[],
  ruleChanges: readonly GlossaryChange[],
  claudeChanges: readonly ReviewedChange[],
): JobChange[] {
  const original = new Map(blocks.map((block) => [block.index, block.text]));
  const rules = new Map(ruleChanges.map((change) => [change.index, change]));
  // A block can come back from two batches (editable in one, context in the next): the change that
  // passed validation wins over the rejected one.
  const claude = new Map<number, ReviewedChange>();
  for (const change of claudeChanges) {
    const current = claude.get(change.index);
    if (!current || (current.status === 'rejeitada_auto' && change.status === 'pendente')) claude.set(change.index, change);
  }
  const indexes = [...new Set([...rules.keys(), ...claude.keys()])].sort((a, b) => a - b);

  const out: JobChange[] = [];
  for (const index of indexes) {
    const rule = rules.get(index);
    const fromClaude = claude.get(index);
    const before = original.get(index) ?? '';

    if (rule && (!fromClaude || fromClaude.status === 'rejeitada_auto')) {
      out.push({
        ...rule,
        id: `${index}:regra`,
        status: 'pendente',
        reason: null,
        ruleText: null,
        review: 'pendente',
        editedText: null,
      });
    }
    if (fromClaude) {
      out.push({
        ...fromClaude,
        id: `${index}:claude`,
        before,
        ruleText: rule?.after ?? null,
        review: 'pendente',
        editedText: null,
      });
    }
  }
  return out;
}
