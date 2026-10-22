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

export interface CaptionsExport {
  /** What `exportAsMediaDirect` returned; "No Error" even when no `.srt` came out (P1). */
  result: string;
  sequence: string;
  durationMs: number;
}

/**
 * The only door to Premiere. Everything in the panel goes through this interface, so a future UXP
 * adapter can replace CEP without touching the UI or the bridge.
 */
export interface PremiereAdapter {
  status(): Promise<PremiereStatus>;
  /**
   * Render the active sequence to `outPath` (a `.wav`) with the captions preset; Premiere writes the
   * C1 captions next to it as a sidecar `.srt`. The caller waits for that file (SPEC §5.1).
   */
  exportCaptionsSrt(outPath: string, eprPath: string): Promise<CaptionsExport>;
}
