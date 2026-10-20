import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { batch, build, decode, formatMs, parse, parseTiming } from '../src/srt/index.js';

const FIXTURE = new URL('../../../fixtures/srt/premiere-exemplo.srt', import.meta.url);

const BASIC =
  '1\r\n00:00:01,000 --> 00:00:03,500\r\nfazemos estampa em de teif\r\n\r\n' +
  '2\r\n00:00:03,600 --> 00:00:06,000\r\naqui na quatro s estampas\r\n\r\n';

describe('parse', () => {
  it('parses a basic CRLF srt into blocks', () => {
    const blocks = parse(BASIC);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.timing).toBe('00:00:01,000 --> 00:00:03,500');
    expect(blocks[0]!.text).toBe('fazemos estampa em de teif');
    expect(blocks[1]!.index).toBe(2);
  });

  it('handles a UTF-8 BOM and LF-only line endings', () => {
    const blocks = parse('\uFEFF1\n00:00:00,000 --> 00:00:01,000\ntexto\n\n');

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('texto');
  });

  it('preserves line breaks inside a cue', () => {
    const twoLine = '1\r\n00:00:00,000 --> 00:00:02,000\r\nlinha um\r\nlinha dois\r\n\r\n';

    expect(parse(twoLine)[0]!.text).toBe('linha um\nlinha dois');
  });

  it('synthesizes the number when the cue has no numeric index', () => {
    const noIndex =
      '00:00:00,000 --> 00:00:01,000\r\nsem numero\r\n\r\n' +
      '2\r\n00:00:01,000 --> 00:00:02,000\r\ncom numero\r\n\r\n';

    const blocks = parse(noIndex);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.num).toBe('1');
    expect(blocks[1]!.num).toBe('2');
  });

  it('drops garbage chunks that are not cues', () => {
    const withGarbage =
      '1\r\n00:00:00,000 --> 00:00:01,000\r\nok\r\n\r\n' +
      'nao eh uma legenda\r\nsem timing aqui\r\n\r\n';

    expect(parse(withGarbage)).toHaveLength(1);
  });

  it('keeps the cue position/alignment suffix on the timing line', () => {
    const withPos =
      '1\r\n00:00:00,000 --> 00:00:01,000 X1:100 X2:200 Y1:50 Y2:80\r\ntexto\r\n\r\n';

    const rebuilt = build(parse(withPos));

    expect(rebuilt).toContain('X1:100 X2:200 Y1:50 Y2:80');
  });

  it('yields zero blocks for empty or blank input', () => {
    expect(parse('')).toHaveLength(0);
    expect(parse('   \r\n\r\n  ')).toHaveLength(0);
  });
});

describe('build', () => {
  it('writes timing lines back byte-for-byte', () => {
    const rebuilt = build(parse(BASIC));

    expect(rebuilt).toContain('00:00:01,000 --> 00:00:03,500');
    expect(rebuilt).toContain('00:00:03,600 --> 00:00:06,000');
  });

  it('uses CRLF and one blank line between cues', () => {
    const rebuilt = build(parse(BASIC));

    expect(rebuilt).toContain('de teif\r\n\r\n2\r\n');
    expect(rebuilt.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('round-trips the Premiere fixture byte for byte', () => {
    const original = readFileSync(FIXTURE);
    const rebuilt = Buffer.from(build(parse(decode(original))), 'utf8');

    expect(rebuilt.equals(original)).toBe(true);
  });

  // Same as the prototype: a blank line at the end of the input is not written back.
  it('normalizes the trailing blank line to a single CRLF', () => {
    expect(build(parse(BASIC))).toBe(BASIC.slice(0, -2));
  });
});

describe('batch', () => {
  it('splits blocks into correct-size chunks', () => {
    const blocks = parse(BASIC.repeat(23));

    const batches = batch(blocks, 20);

    expect(blocks).toHaveLength(46);
    expect(batches).toHaveLength(Math.ceil(blocks.length / 20));
    expect(batches[0]).toHaveLength(20);
    expect(batches[2]).toHaveLength(6);
  });

  it('rejects an invalid batch size', () => {
    expect(() => batch([], 0)).toThrow(RangeError);
  });
});

describe('decode', () => {
  it('decodes UTF-8', () => {
    expect(decode(new TextEncoder().encode('confecção'))).toBe('confecção');
  });

  it('drops the UTF-8 BOM', () => {
    const bytes = new TextEncoder().encode('\uFEFFsublimação');

    expect(decode(bytes)).toBe('sublimação');
  });

  it('falls back to windows-1252 when the bytes are not valid UTF-8', () => {
    const cp1252 = Uint8Array.from([0x63, 0x6f, 0x6e, 0x66, 0x65, 0x63, 0xe7, 0xe3, 0x6f]);

    expect(decode(cp1252)).toBe('confecção');
  });
});

describe('time', () => {
  it('parses a timing line into milliseconds', () => {
    expect(parseTiming('00:00:01,000 --> 00:00:03,500')).toEqual({ startMs: 1000, endMs: 3500 });
  });

  it('ignores the position suffix', () => {
    const timing = '01:02:03,456 --> 01:02:04,000 X1:100 X2:200 Y1:50 Y2:80';

    expect(parseTiming(timing)).toEqual({ startMs: 3_723_456, endMs: 3_724_000 });
  });

  it('formats milliseconds as HH:MM:SS,mmm', () => {
    expect(formatMs(0)).toBe('00:00:00,000');
    expect(formatMs(1000)).toBe('00:00:01,000');
    expect(formatMs(3_723_456)).toBe('01:02:03,456');
  });

  it('round-trips through parse and format', () => {
    const timing = '02:13:45,678 --> 02:13:46,000';

    expect(formatMs(parseTiming(timing).startMs)).toBe('02:13:45,678');
  });

  it('rejects values that are not timing lines', () => {
    expect(() => parseTiming('sem tempo')).toThrow('Linha de tempo inválida');
    expect(() => formatMs(-1)).toThrow(RangeError);
  });
});
