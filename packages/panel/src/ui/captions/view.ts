import { win32 } from 'node:path';

import type { BatchRunner, CaptionJob, JobChange } from '@eve-cut/core';
import { ProfileStore } from '@eve-cut/core/profile';
import type { Profile } from '@eve-cut/core/profile';
import { CLAUDE_MESSAGES, locateClaude } from '@eve-cut/core/claude';

import { EXPORT_FAILED_MESSAGE, exportSequenceSrt, watchedFolders, watchForSrt } from '../../captions/export.js';
import { extensionDir } from '../../captions/source.js';
import { batchTotal, InputError, readSrt, runJob, srtFromBytes } from '../../jobs/flow.js';
import type { SrtInput } from '../../jobs/flow.js';
import { makeBatchRunner, workDir } from '../../jobs/run.js';
import { JobStore } from '../../jobs/store.js';
import type { JobRecord } from '../../jobs/store.js';
import type { PremiereAdapter } from '../../premiere/adapter.js';
import type { SettingsStore } from '../settings/view.js';
import { errorText, offerGlossaryOnly, proposedText, startTimecode, summaryText } from './format.js';

const NO_CLIENT = '';

interface CepFs {
  showOpenDialogEx?: (
    allowMultiple: boolean,
    chooseDirectory: boolean,
    title: string,
    initialPath: string,
    fileTypes: string[],
  ) => { err: number; data: string[] };
}

declare global {
  interface Window {
    cep?: { fs?: CepFs };
  }
}

type Busy = { kind: 'job'; controller: AbortController } | { kind: 'watch'; controller: AbortController } | null;

export interface CaptionsDeps {
  adapter: PremiereAdapter;
  settings: SettingsStore;
  profiles?: ProfileStore;
  jobs?: JobStore;
}

/** The Legendas tab (F1-08): input, progress, errors and the saved job. The review UI is F1-09. */
export function setupCaptions(deps: CaptionsDeps): void {
  const profiles = deps.profiles ?? new ProfileStore();
  const jobs = deps.jobs ?? new JobStore();
  const el = elements();
  let busy: Busy = null;
  /** What "Corrigir de novo" and "Corrigir só com o glossário" run on. */
  let current: SrtInput | null = null;

  /* ---------- client ---------- */

  function fillClients(): void {
    try {
      profiles.seed();
    } catch {
      // A read-only folder must not stop the tab; the list below says what it found.
    }
    const entries = safeList(profiles);
    const last = deps.settings.get().captions.lastClient;
    el.client.replaceChildren(option(NO_CLIENT, 'Nenhum (só regras gerais)'));
    for (const entry of entries) {
      const item = option(entry.slug, entry.name);
      item.disabled = entry.profile === null;
      el.client.append(item);
    }
    const usable = entries.filter((entry) => entry.profile);
    el.client.value = usable.some((entry) => entry.slug === last) ? (last as string) : (usable[0]?.slug ?? NO_CLIENT);
  }

  function selectedProfile(): Profile | null {
    const slug = el.client.value;
    if (!slug) return null;
    return profiles.load(slug);
  }

  el.client.addEventListener('change', () => {
    deps.settings.update((s) => {
      s.captions.lastClient = el.client.value || null;
    });
  });

  /* ---------- status and busy state ---------- */

  function setStatus(kind: 'ok' | 'err' | 'warn' | null, text = ''): void {
    el.status.className = kind ? `status visible ${kind}` : 'status';
    el.status.textContent = text;
  }

  function setBusy(next: Busy): void {
    busy = next;
    const on = next !== null;
    el.exportBtn.disabled = on;
    el.client.disabled = on;
    el.drop.classList.toggle('disabled', on);
    el.glossaryBtn.disabled = on;
    el.rerunBtn.disabled = on;
    el.progress.classList.toggle('visible', on);
    el.cancel.textContent = next?.kind === 'watch' ? 'Parar' : 'Cancelar';
    if (!on) setProgress(0, 0, '');
  }

  function setProgress(done: number, total: number, label: string): void {
    el.bar.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
    el.progressText.textContent = label;
  }

  function setActions(glossary: boolean, rerun: boolean): void {
    el.glossaryBtn.hidden = !glossary;
    el.rerunBtn.hidden = !rerun;
    el.actions.hidden = !glossary && !rerun;
  }

  el.cancel.addEventListener('click', () => {
    busy?.controller.abort();
  });

  /* ---------- review summary (provisional until F1-09) ---------- */

  function showRecord(record: JobRecord): void {
    const job = record.job;
    el.review.hidden = false;
    el.fileName.textContent = win32.basename(record.srtPath);
    el.fileName.title = record.srtPath;
    el.fileMeta.textContent = [record.sequenceName, `${job.blocks.length} blocos`, clientLabel(job)].filter(Boolean).join(' · ');
    el.summary.textContent = summaryText(job);
    renderChanges(el.diff, job);
  }

  function clientLabel(job: CaptionJob): string {
    if (job.mode === 'glossario') return job.profileSlug ? `${job.profileSlug} · só glossário` : 'só glossário';
    return job.profileSlug ?? 'sem cliente';
  }

  /** After a run or a restore: errors, fallback and "again" buttons. */
  function showOutcome(record: JobRecord, restored: boolean): void {
    showRecord(record);
    const job = record.job;
    const errors = errorText(job);
    const canRerun = current !== null && current.hash === record.srtHash;

    if (job.cancelled) {
      setStatus('warn', `Cancelado. O que já tinha voltado foi mantido (${job.notRun.length} lotes não rodaram).`);
    } else if (errors) {
      setStatus('err', errors);
    } else if (restored) {
      setStatus('ok', `Este arquivo já foi corrigido em ${formatDate(record.updatedAt)}. A revisão foi restaurada.`);
    } else {
      setStatus('ok', job.changes.length > 0 ? 'Pronto. Confira a revisão abaixo.' : 'Pronto. Nenhuma alteração sugerida.');
    }
    setActions(canRerun && offerGlossaryOnly(job), canRerun);
  }

  /* ---------- running a job ---------- */

  async function correct(input: SrtInput, glossaryOnly: boolean): Promise<void> {
    if (busy) return;
    current = input;
    const settings = deps.settings.get();

    let profile: Profile | null;
    try {
      profile = selectedProfile();
    } catch (err) {
      setStatus('err', (err as Error).message);
      return;
    }

    const controller = new AbortController();
    setBusy({ kind: 'job', controller });
    setActions(false, false);
    setStatus(null);

    let runner: BatchRunner | null = null;
    if (!glossaryOnly) {
      setProgress(0, 0, 'Procurando o Claude Code…');
      const exe = await locateClaude({ configured: settings.claude.exePath });
      runner = exe
        ? makeBatchRunner(exe, settings)
        : async () => ({ ok: false, kind: 'not_found', message: CLAUDE_MESSAGES.not_found, retryable: false });
    }

    const total = runner ? batchTotal(input.blocks, settings.claude.batchSize) : 0;
    setProgress(0, total, runner ? `Lote 0 de ${total}` : 'Aplicando o glossário…');

    try {
      const record = await runJob({
        input,
        profile,
        runner,
        batchSize: settings.claude.batchSize,
        store: jobs,
        signal: controller.signal,
        onProgress: (p) => setProgress(p.done, p.total, `Lote ${p.done} de ${p.total}`),
      });
      setBusy(null);
      showOutcome(record, false);
    } catch (err) {
      setBusy(null);
      setStatus('err', `Não consegui corrigir: ${(err as Error).message}`);
      setActions(false, true);
    }
  }

  /** A new `.srt` came in: restore its job if it was corrected before, otherwise correct it. */
  function open(input: SrtInput): void {
    current = input;
    const saved = jobs.findByHash(input.hash);
    if (saved) {
      showOutcome(saved, true);
      return;
    }
    void correct(input, false);
  }

  function rememberFolder(path: string): void {
    const folder = win32.dirname(path);
    if (!folder || folder === '.') return;
    deps.settings.update((s) => {
      s.captions.lastFolder = folder;
    });
  }

  function openPath(path: string, source: JobRecord['source'], sequenceName: string | null = null): void {
    try {
      const input = readSrt(path, source, sequenceName);
      if (source === 'arquivo') rememberFolder(path);
      open(input);
    } catch (err) {
      setStatus('err', err instanceof InputError ? err.message : `Não consegui abrir o arquivo: ${(err as Error).message}`);
    }
  }

  el.glossaryBtn.addEventListener('click', () => {
    if (current) void correct(current, true);
  });
  el.rerunBtn.addEventListener('click', () => {
    if (current) void correct(current, false);
  });

  /* ---------- from the sequence ---------- */

  el.exportBtn.addEventListener('click', () => {
    void fromSequence();
  });

  async function fromSequence(): Promise<void> {
    if (busy) return;
    const controller = new AbortController();
    setBusy({ kind: 'watch', controller });
    setActions(false, false);
    setStatus(null);
    setProgress(0, 0, 'Exportando as legendas da sequência…');

    let projectPath: string | null;
    let sequenceName: string | null;
    try {
      const status = await deps.adapter.status();
      projectPath = status.projectPath;
      sequenceName = status.sequence?.name ?? null;
      if (!sequenceName) throw new Error('Abra um projeto e uma sequência no Premiere.');

      const srt = await exportSequenceSrt({ adapter: deps.adapter, extensionDir: extensionDir(location.href), workDir: workDir() });
      if (srt) {
        setBusy(null);
        openPath(srt, 'sequencia', sequenceName);
        return;
      }
    } catch (err) {
      setBusy(null);
      setStatus('err', (err as Error).message);
      return;
    }

    // Plan B (SPEC §5.1): José exports by hand and the panel picks the file up.
    const since = Date.now();
    const dirs = watchedFolders(projectPath, deps.settings.get().captions.lastFolder);
    setStatus('warn', EXPORT_FAILED_MESSAGE);
    setProgress(0, 0, dirs.length > 0 ? 'Vigiando a pasta do projeto por 2 min…' : 'Salve o projeto para eu vigiar a pasta dele.');
    const found = dirs.length > 0 ? await watchForSrt(dirs, since, controller.signal) : null;
    setBusy(null);
    if (found) {
      setStatus(null);
      openPath(found, 'arquivo', sequenceName);
    } else {
      setStatus('warn', `${EXPORT_FAILED_MESSAGE}\nParei de vigiar. Arraste o .srt aqui ou clique para escolher.`);
    }
  }

  /* ---------- drop and pick ---------- */

  el.drop.addEventListener('click', () => pickFile());
  el.drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickFile();
    }
  });

  function pickFile(): void {
    if (busy) return;
    const dialog = window.cep?.fs?.showOpenDialogEx;
    if (dialog) {
      const initial = deps.settings.get().captions.lastFolder ?? '';
      const result = dialog(false, false, 'Escolha o .srt', initial, ['srt']);
      const path = result.err === 0 ? result.data[0] : undefined;
      if (path) openPath(path, 'arquivo');
      return;
    }
    el.fileInput.click();
  }

  el.fileInput.addEventListener('change', () => {
    const file = el.fileInput.files?.[0];
    el.fileInput.value = '';
    if (file) void openFile(file);
  });

  // Without this the panel navigates to the dropped file and the UI is gone.
  for (const type of ['dragover', 'drop'] as const) {
    document.addEventListener(type, (event) => event.preventDefault());
  }
  el.drop.addEventListener('dragover', () => el.drop.classList.add('over'));
  el.drop.addEventListener('dragleave', () => el.drop.classList.remove('over'));
  el.drop.addEventListener('drop', (event) => {
    el.drop.classList.remove('over');
    const file = event.dataTransfer?.files[0];
    if (file && !busy) void openFile(file);
  });

  async function openFile(file: File): Promise<void> {
    if (!/\.srt$/i.test(file.name)) {
      setStatus('err', 'Esse arquivo não é um .srt.');
      return;
    }
    // CEP's Chromium may expose the real path (like Electron); without it the bytes still work.
    const path = (file as File & { path?: string }).path;
    if (path) {
      openPath(path, 'arquivo');
      return;
    }
    try {
      open(srtFromBytes(new Uint8Array(await file.arrayBuffer()), file.name, 'arquivo'));
    } catch (err) {
      setStatus('err', (err as Error).message);
    }
  }

  /* ---------- start ---------- */

  fillClients();
  const last = jobs.latestOpen();
  if (last) {
    try {
      current = readSrt(last.srtPath, last.source, last.sequenceName);
      if (current.hash !== last.srtHash) current = null;
    } catch {
      current = null;
    }
    showOutcome(last, true);
    if (!last.job.cancelled && errorText(last.job) === null) setStatus(null);
  }
}

function renderChanges(container: HTMLElement, job: CaptionJob): void {
  container.replaceChildren();
  if (job.changes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Nenhuma alteração.';
    container.append(empty);
    return;
  }
  for (const change of job.changes) container.append(changeItem(job, change));
}

function changeItem(job: CaptionJob, change: JobChange): HTMLElement {
  const item = document.createElement('div');
  item.className = change.status === 'rejeitada_auto' ? 'diff-item rejected' : 'diff-item';

  const head = document.createElement('div');
  head.className = 'tc';
  const where = document.createElement('span');
  where.textContent = `#${change.index} · ${startTimecode(job, change)}`;
  const tag = document.createElement('span');
  tag.textContent = `${change.kind} · ${change.source === 'regra' ? 'regra' : 'Claude'}`;
  head.append(where, tag);

  const before = document.createElement('div');
  before.className = 'before';
  before.textContent = change.before;
  const after = document.createElement('div');
  after.className = 'after';
  after.textContent = proposedText(change);
  item.append(head, before, after);

  if (change.reason) {
    const reason = document.createElement('div');
    reason.className = 'reason';
    reason.textContent = `Recusada automaticamente: ${change.reason}`;
    item.append(reason);
  }
  return item;
}

function option(value: string, label: string): HTMLOptionElement {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  return item;
}

function safeList(profiles: ProfileStore): ReturnType<ProfileStore['list']> {
  try {
    return profiles.list();
  } catch {
    return [];
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} às ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function elements() {
  const get = <T extends HTMLElement>(id: string): T => {
    const found = document.getElementById(id);
    if (!found) throw new Error(`#${id} não existe no index.html`);
    return found as T;
  };
  return {
    client: get<HTMLSelectElement>('cap-client'),
    exportBtn: get<HTMLButtonElement>('cap-export'),
    drop: get<HTMLElement>('cap-drop'),
    fileInput: get<HTMLInputElement>('cap-file'),
    progress: get<HTMLElement>('cap-progress'),
    bar: get<HTMLElement>('cap-bar'),
    progressText: get<HTMLElement>('cap-progress-text'),
    cancel: get<HTMLElement>('cap-cancel'),
    status: get<HTMLElement>('cap-status'),
    actions: get<HTMLElement>('cap-actions'),
    glossaryBtn: get<HTMLButtonElement>('cap-glossary'),
    rerunBtn: get<HTMLButtonElement>('cap-rerun'),
    review: get<HTMLElement>('cap-review'),
    fileName: get<HTMLElement>('cap-file-name'),
    fileMeta: get<HTMLElement>('cap-file-meta'),
    summary: get<HTMLElement>('cap-summary'),
    diff: get<HTMLElement>('cap-diff'),
  };
}
