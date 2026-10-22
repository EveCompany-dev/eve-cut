import type { CaptionJob, JobChange } from '@eve-cut/core';
import { parseTiming } from '@eve-cut/core';

/** "12 alterações · 3 regra · 9 Claude" (SPEC §11); auto-rejected changes are counted apart. */
export function summaryText(job: CaptionJob): string {
  const active = job.changes.filter((change) => change.status !== 'rejeitada_auto');
  const rule = active.filter((change) => change.source === 'regra').length;
  const claude = active.length - rule;
  const rejected = job.changes.length - active.length;

  const parts = [`${active.length} ${active.length === 1 ? 'alteração' : 'alterações'}`, `${rule} regra`, `${claude} Claude`];
  if (rejected > 0) parts.push(`${rejected} ${rejected === 1 ? 'recusada' : 'recusadas'} automaticamente`);
  return parts.join(' · ');
}

/**
 * The message for a job that ended with errors, or `null` when every batch went through. A fatal
 * error (limit, login, executable) repeats on every remaining batch, so each message shows once.
 */
export function errorText(job: CaptionJob): string | null {
  if (job.errors.length === 0) return null;
  const messages = [...new Set(job.errors.map((error) => error.message))];
  const head =
    job.batchCount > 1
      ? `${job.errors.length} de ${job.batchCount} lotes ficaram sem a correção do Claude (esses blocos continuam como estavam).`
      : null;
  return [head, ...messages].filter(Boolean).join('\n');
}

/** The glossary-only fallback is offered whenever the Claude part did not fully run. */
export function offerGlossaryOnly(job: CaptionJob): boolean {
  return job.mode === 'claude' && (job.errors.length > 0 || job.cancelled);
}

/** `00:00:12,345 --> …` → `00:00:12`. */
export function startTimecode(job: CaptionJob, change: JobChange): string {
  const block = job.blocks.find((candidate) => candidate.index === change.index);
  if (!block) return '';
  try {
    const seconds = Math.floor(parseTiming(block.timing).startMs / 1000);
    const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '';
  }
}

/** The text the change proposes (José's edit wins over the model's). */
export function proposedText(change: JobChange): string {
  return change.editedText ?? change.after;
}
