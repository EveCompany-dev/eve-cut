export interface SequenceInfo {
  name: string;
  id: string;
}

export interface PremiereStatus {
  /** `app.version`, e.g. "26.0.0". */
  appVersion: string;
  projectPath: string | null;
  sequence: SequenceInfo | null;
}

/**
 * The only door to Premiere. Everything in the panel goes through this interface, so a future UXP
 * adapter can replace CEP without touching the UI or the bridge.
 */
export interface PremiereAdapter {
  status(): Promise<PremiereStatus>;
}
