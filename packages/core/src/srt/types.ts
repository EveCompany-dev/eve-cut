/**
 * One cue of an .srt file.
 *
 * `timing` is kept verbatim (including any position/alignment suffix Premiere appends) because the
 * text corrections must never change the timeline.
 */
export interface SrtBlock {
  /** 1-based position in the file; always the current order. */
  index: number;
  /** Number line written back to the file. Synthesized from `index` when the file omits it. */
  num: string;
  /** Full timing line, e.g. `00:00:01,000 --> 00:00:03,500 X1:100 X2:200`. */
  timing: string;
  /** Cue text, lines joined with `\n` and trimmed. */
  text: string;
}
