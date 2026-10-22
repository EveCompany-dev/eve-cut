import { locateClaude } from '@eve-cut/core/claude';
import type { ClaudeModel } from '@eve-cut/core/claude';
import { clampBatchSize, loadSettings, saveSettings } from '@eve-cut/core/settings';
import type { Settings } from '@eve-cut/core/settings';

import { testClaude } from '../../jobs/run.js';

/** The settings in memory, saved on every change. */
export class SettingsStore {
  private value: Settings;
  private readonly listeners: Array<(settings: Settings) => void> = [];

  constructor(private readonly file?: string) {
    this.value = loadSettings(file);
  }

  get(): Settings {
    return JSON.parse(JSON.stringify(this.value)) as Settings;
  }

  update(change: (draft: Settings) => void): Settings {
    const draft = this.get();
    change(draft);
    try {
      this.value = saveSettings(draft, this.file);
    } catch {
      // Keep working with the new values even if the disk refused them; they are lost on reopen.
      this.value = draft;
    }
    for (const listener of this.listeners) listener(this.get());
    return this.get();
  }

  onChange(listener: (settings: Settings) => void): void {
    this.listeners.push(listener);
  }
}

/** The ⚙ tab: Claude Code path, model, batch size and "Testar Claude" (SPEC §10). */
export function setupSettings(store: SettingsStore): void {
  const exe = document.getElementById('set-exe') as HTMLInputElement;
  const detect = document.getElementById('set-detect') as HTMLButtonElement;
  const model = document.getElementById('set-model') as HTMLSelectElement;
  const batch = document.getElementById('set-batch') as HTMLInputElement;
  const test = document.getElementById('set-test') as HTMLButtonElement;
  const status = document.getElementById('set-status') as HTMLElement;

  const setStatus = (kind: 'ok' | 'err' | 'warn' | null, text = ''): void => {
    status.className = kind ? `status visible ${kind}` : 'status';
    status.textContent = text;
  };

  const show = (settings: Settings): void => {
    exe.value = settings.claude.exePath;
    model.value = settings.claude.model;
    batch.value = String(settings.claude.batchSize);
  };
  show(store.get());

  exe.addEventListener('change', () => {
    store.update((s) => {
      s.claude.exePath = exe.value.trim();
    });
  });
  model.addEventListener('change', () => {
    store.update((s) => {
      s.claude.model = model.value as ClaudeModel;
    });
  });
  batch.addEventListener('change', () => {
    const saved = store.update((s) => {
      s.claude.batchSize = clampBatchSize(batch.value);
    });
    batch.value = String(saved.claude.batchSize);
  });

  detect.addEventListener('click', () => {
    void (async () => {
      detect.disabled = true;
      // Search the PATH even when a path is typed: that is what "Detectar" is for.
      const found = await locateClaude();
      detect.disabled = false;
      if (!found) {
        setStatus('err', 'Não achei o Claude Code neste PC. Instale com npm install -g @anthropic-ai/claude-code ou cole o caminho do claude.exe.');
        return;
      }
      exe.value = found;
      store.update((s) => {
        s.claude.exePath = found;
      });
      setStatus('ok', `Achei o Claude Code em ${found}.`);
    })();
  });

  test.addEventListener('click', () => {
    void (async () => {
      test.disabled = true;
      setStatus(null);
      test.textContent = 'Testando…';
      try {
        const result = await testClaude(store.get());
        if (result.ok) {
          const seconds = (result.durationMs / 1000).toFixed(1).replace('.', ',');
          setStatus('ok', `O Claude respondeu em ${seconds} s (${store.get().claude.model}).\n${result.claudeExe}`);
        } else {
          setStatus(result.kind === 'limit' ? 'warn' : 'err', result.message);
        }
      } catch (err) {
        setStatus('err', (err as Error).message);
      } finally {
        test.disabled = false;
        test.textContent = 'Testar Claude';
      }
    })();
  });
}
