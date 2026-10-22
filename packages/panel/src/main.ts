import { startBridgeServer, type BridgeServer } from './bridge/server.js';
import { runClaudeProbe } from './lab/claude-probe.js';
import { CepAdapter } from './premiere/cep-adapter.js';
import { callHost } from './premiere/host.js';
import { setupCaptions } from './ui/captions/view.js';
import { SettingsStore, setupSettings } from './ui/settings/view.js';

const adapter = new CepAdapter();
const settings = new SettingsStore();
let bridge: BridgeServer | null = null;
let previousView: string | null = null;

function showModel(): void {
  const model = document.getElementById('foot-model');
  if (model) model.textContent = `Claude ${settings.get().claude.model}`;
}

function setFooterError(message: string): void {
  const text = document.getElementById('foot-text');
  const dot = document.getElementById('foot-dot');
  if (!text || !dot) return;

  text.textContent = message;
  dot.classList.add('err');
}

function setupTabs(): void {
  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      const viewId = tab.dataset.view;
      if (!viewId) return;

      for (const other of tabs) {
        other.classList.toggle('active', other === tab);
      }
      for (const view of document.querySelectorAll<HTMLElement>('.view')) {
        view.classList.toggle('visible', view.id === viewId);
      }
    });
  }
}

async function showPremiereStatus(): Promise<void> {
  const text = document.getElementById('foot-text');
  const dot = document.getElementById('foot-dot');
  if (!text || !dot) return;

  try {
    const status = await adapter.status();
    const sequence = status.sequence?.name ?? 'sem sequência';
    text.textContent = `Premiere ${status.appVersion} · ${sequence}`;
    dot.classList.add('ok');
  } catch (error) {
    setFooterError(error instanceof Error ? error.message : String(error));
  }
}

async function startBridge(): Promise<void> {
  try {
    bridge = await startBridgeServer({ adapter });
  } catch (error) {
    setFooterError(error instanceof Error ? error.message : String(error));
  }
}

/* ---------- Lab (F0-05) ---------- */

function toggleLab(force?: boolean): void {
  const lab = document.getElementById('view-lab');
  if (!lab) return;

  const open = force ?? !lab.classList.contains('visible');

  if (open) {
    previousView = document.querySelector<HTMLElement>('.view.visible:not(#view-lab)')?.id ?? null;
    for (const view of document.querySelectorAll<HTMLElement>('.view')) {
      view.classList.remove('visible');
    }
    lab.classList.add('visible');
    return;
  }

  lab.classList.remove('visible');
  const target = previousView
    ? document.getElementById(previousView)
    : document.getElementById('view-legendas');
  target?.classList.add('visible');
}

function inputValue(id: string): string {
  const element = document.getElementById(id) as HTMLInputElement | null;
  return element?.value.trim() ?? '';
}

function selectValue(id: string): string {
  const element = document.getElementById(id) as HTMLSelectElement | null;
  return element?.value ?? '';
}

function isChecked(id: string): boolean {
  const element = document.getElementById(id) as HTMLInputElement | null;
  return element?.checked ?? false;
}

function setLabResult(text: string): void {
  const result = document.getElementById('lab-result');
  if (result) result.textContent = text;
  const box = document.getElementById('lab-result-box');
  if (box) box.hidden = text === '';
}

/**
 * Copy the Lab result. `execCommand` first: inside CEP the async clipboard API may be missing or
 * refuse a file:// page, and the copy must happen inside the click.
 */
async function copyLabResult(button: HTMLElement): Promise<void> {
  const text = document.getElementById('lab-result')?.textContent ?? '';
  let copied: boolean;

  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();

  if (!copied && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
  }

  button.textContent = copied ? 'Copiado ✓' : 'Não deu: selecione e use Ctrl+C';
  button.classList.toggle('done', copied);
  window.setTimeout(() => {
    button.textContent = 'Copiar';
    button.classList.remove('done');
  }, 1500);
}

async function runProbe(label: string, probe: () => Promise<unknown>): Promise<void> {
  setLabResult(`// ${label}\nrodando…`);

  try {
    setLabResult(`// ${label}\n${JSON.stringify(await probe(), null, 2)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setLabResult(`// ${label}\n${JSON.stringify({ ok: false, error: message }, null, 2)}`);
  }
}

function setupLab(): void {
  const on = (id: string, handler: () => void): void => {
    document.getElementById(id)?.addEventListener('click', handler);
  };

  on('lab-close', () => toggleLab(false));
  on('lab-copy', () => {
    const button = document.getElementById('lab-copy');
    if (button) void copyLabResult(button);
  });

  on('lab-p1-run', () => {
    void runProbe('P1', () =>
      callHost('eveLabP1', {
        eprPath: inputValue('lab-p1-epr'),
        mediaPath: inputValue('lab-p1-media'),
        xmlPath: inputValue('lab-p1-xml'),
      }),
    );
  });

  on('lab-p2-run', () => {
    void runProbe('P2', () =>
      callHost('eveLabP2', {
        srtPath: inputValue('lab-p2-srt'),
        startMode: selectValue('lab-p2-start'),
        startSeconds: Number(inputValue('lab-p2-seconds')) || 0,
      }),
    );
  });

  on('lab-p3-run', () => {
    void runProbe('P3', () => callHost('eveLabP3', null));
  });

  on('lab-p4-run', () => {
    void runProbe('P4', () =>
      callHost('eveLabP4', {
        seconds: Number(inputValue('lab-p4-seconds')) || 1,
        deleteAfter: isChecked('lab-p4-delete'),
      }),
    );
  });

  on('lab-p5-run', () => {
    void runProbe('P5', () =>
      callHost('eveLabP5', {
        eprPath: inputValue('lab-p5-epr'),
        outPath: inputValue('lab-p5-out'),
      }),
    );
  });

  on('lab-p6a-run', () => {
    void runProbe('P6A', () =>
      callHost('eveLabP6A', {
        startSeconds: Number(inputValue('lab-p6-start')) || 1,
        relativeTimecode: isChecked('lab-p6-relative'),
      }),
    );
  });

  on('lab-p6b-run', () => {
    void runProbe('P6B', () => callHost('eveLabP6B', { xmlPath: inputValue('lab-p6-xml') }));
  });

  on('lab-p7-run', () => {
    void runProbe('P7', () =>
      runClaudeProbe({
        claudeExe: inputValue('lab-p7-exe'),
        model: inputValue('lab-p7-model') || 'sonnet',
        blocks: Number(inputValue('lab-p7-blocks')) || 40,
      }),
    );
  });

  on('lab-p8-run', () => {
    void runProbe('P8', () =>
      callHost('eveLabP8', {
        mogrtPath: inputValue('lab-p8-mogrt'),
        text: inputValue('lab-p8-text'),
      }),
    );
  });

  on('lab-p9-run', () => {
    void runProbe('P9', () =>
      callHost('eveLabP9', { stylePath: inputValue('lab-p9-style') }),
    );
  });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.shiftKey && (event.key === 'L' || event.key === 'l')) {
      event.preventDefault();
      toggleLab();
      return;
    }
    if (event.key === 'Escape' && document.getElementById('view-lab')?.classList.contains('visible')) {
      toggleLab(false);
    }
  });
}

setupTabs();
setupLab();
setupSettings(settings);
settings.onChange(showModel);
showModel();
try {
  setupCaptions({ adapter, settings });
} catch (error) {
  setFooterError(error instanceof Error ? error.message : String(error));
}
window.addEventListener('beforeunload', () => {
  void bridge?.close();
});
void showPremiereStatus();
void startBridge();
