import { CepAdapter } from './premiere/cep-adapter.js';

const adapter = new CepAdapter();

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
    text.textContent = error instanceof Error ? error.message : String(error);
    dot.classList.add('err');
  }
}

setupTabs();
void showPremiereStatus();
