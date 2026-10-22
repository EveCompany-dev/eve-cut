import type { CaptionsExport, PremiereAdapter, PremiereStatus } from './adapter.js';
import { callHost } from './host.js';

export class CepAdapter implements PremiereAdapter {
  status(): Promise<PremiereStatus> {
    return callHost<PremiereStatus>('evePing', null);
  }

  exportCaptionsSrt(outPath: string, eprPath: string): Promise<CaptionsExport> {
    return callHost<CaptionsExport>('eveExportCaptionsSrt', { outPath, eprPath });
  }
}
