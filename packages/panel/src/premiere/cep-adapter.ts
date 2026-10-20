import type { PremiereAdapter, PremiereStatus } from './adapter.js';
import { callHost } from './host.js';

export class CepAdapter implements PremiereAdapter {
  status(): Promise<PremiereStatus> {
    return callHost<PremiereStatus>('evePing', null);
  }
}
