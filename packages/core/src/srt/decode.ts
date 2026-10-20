/**
 * Decode an .srt file read from disk.
 *
 * Premiere writes UTF-8, but files that went through other tools still show up as windows-1252.
 * Decode strict UTF-8 first so invalid bytes are not silently replaced, then fall back.
 */
export function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
