/* srt.js - parse and rebuild .srt without ever touching the timing lines. */
(function (global) {
  'use strict';

  var TIMING = /-->/;

  /**
   * Parse an .srt into blocks.
   * Each block keeps the timing line verbatim, so anything Premiere appended to
   * it (position/alignment coordinates) survives the round trip untouched.
   *
   * @returns {Array<{index:number, num:string, timing:string, text:string}>}
   */
  function parse(raw) {
    var src = String(raw)
      .replace(/^﻿/, '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    var chunks = src.split(/\n[ \t]*\n+/);
    var blocks = [];

    for (var c = 0; c < chunks.length; c++) {
      var lines = chunks[c].split('\n');

      // drop leading/trailing blank lines inside the chunk
      while (lines.length && !lines[0].trim()) lines.shift();
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      if (!lines.length) continue;

      var num = null;
      if (/^\d+$/.test(lines[0].trim()) && lines.length > 1 && TIMING.test(lines[1])) {
        num = lines.shift().trim();
      }

      if (!lines.length || !TIMING.test(lines[0])) continue; // not a cue - skip

      var timing = lines.shift();
      var text = lines.join('\n').trim();

      blocks.push({
        index: blocks.length + 1,
        num: num === null ? String(blocks.length + 1) : num,
        timing: timing,
        text: text
      });
    }

    return blocks;
  }

  /** Rebuild an .srt from blocks. Timing lines are written back byte-for-byte. */
  function build(blocks) {
    var out = [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      out.push(b.num);
      out.push(b.timing);
      out.push(b.text);
      out.push('');
    }
    return out.join('\r\n').replace(/\n/g, '\r\n').replace(/\r\r\n/g, '\r\n');
  }

  /** Split blocks into batches of n. */
  function batch(blocks, n) {
    var out = [];
    for (var i = 0; i < blocks.length; i += n) out.push(blocks.slice(i, i + n));
    return out;
  }

  /** "00:00:12,340 --> 00:00:14,100" -> "00:00:12" (for the diff list). */
  function startOf(timing) {
    var m = String(timing).match(/(\d{1,2}:\d{2}:\d{2})/);
    return m ? m[1] : '';
  }

  global.SRT = { parse: parse, build: build, batch: batch, startOf: startOf };
})(window);
