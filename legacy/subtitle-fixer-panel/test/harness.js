/* Offline stress test for srt.js + claude.js, run with plain Node.
 * Loads the real panel source unmodified, mocks https.request, and exercises
 * parsing/batching/retry/timestamp-preservation edge cases. */
'use strict';

global.window = global;

const path = require('path');
const assert = require('assert');

require(path.join(__dirname, '..', 'js', 'srt.js'));
require(path.join(__dirname, '..', 'js', 'claude.js'));

const https = require('https');

let PASS = 0, FAIL = 0;
function check(name, fn) {
  try { fn(); PASS++; console.log('  ok   ' + name); }
  catch (e) { FAIL++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function section(name) { console.log('\n== ' + name + ' =='); }

// ---------------------------------------------------------------- SRT.parse

section('SRT.parse / SRT.build round trips');

const BASIC =
  '1\r\n00:00:01,000 --> 00:00:03,500\r\nfazemos estampa em de teif\r\n\r\n' +
  '2\r\n00:00:03,600 --> 00:00:06,000\r\naqui na quatro s estampas\r\n\r\n';

check('parses basic CRLF srt into 2 blocks', () => {
  const blocks = SRT.parse(BASIC);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].timing, '00:00:01,000 --> 00:00:03,500');
  assert.strictEqual(blocks[0].text, 'fazemos estampa em de teif');
});

check('build() reproduces timing lines byte-for-byte', () => {
  const blocks = SRT.parse(BASIC);
  const rebuilt = SRT.build(blocks);
  assert.ok(rebuilt.indexOf('00:00:01,000 --> 00:00:03,500') !== -1);
  assert.ok(rebuilt.indexOf('00:00:03,600 --> 00:00:06,000') !== -1);
});

check('handles UTF-8 BOM + LF-only line endings', () => {
  const withBom = '﻿1\n00:00:00,000 --> 00:00:01,000\ntexto\n\n';
  const blocks = SRT.parse(withBom);
  assert.strictEqual(blocks.length, 1);
  assert.strictEqual(blocks[0].text, 'texto');
});

check('preserves internal line breaks inside a cue', () => {
  const twoLine = '1\r\n00:00:00,000 --> 00:00:02,000\r\nlinha um\r\nlinha dois\r\n\r\n';
  const blocks = SRT.parse(twoLine);
  assert.strictEqual(blocks[0].text, 'linha um\nlinha dois');
});

check('skips cues with no numeric index but keeps timing (num falls back to position)', () => {
  const noIndex = '00:00:00,000 --> 00:00:01,000\r\nsem numero\r\n\r\n' +
                   '2\r\n00:00:01,000 --> 00:00:02,000\r\ncom numero\r\n\r\n';
  const blocks = SRT.parse(noIndex);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].num, '1'); // synthesized
  assert.strictEqual(blocks[1].num, '2'); // real, from file
});

check('drops garbage chunks that are not real cues', () => {
  const withGarbage = '1\r\n00:00:00,000 --> 00:00:01,000\r\nok\r\n\r\n' +
                       'nao eh uma legenda\r\nsem timing aqui\r\n\r\n';
  const blocks = SRT.parse(withGarbage);
  assert.strictEqual(blocks.length, 1);
});

check('handles cue position/alignment suffix on the timing line untouched', () => {
  const withPos = '1\r\n00:00:00,000 --> 00:00:01,000 X1:100 X2:200 Y1:50 Y2:80\r\ntexto\r\n\r\n';
  const blocks = SRT.parse(withPos);
  const rebuilt = SRT.build(blocks);
  assert.ok(rebuilt.indexOf('X1:100 X2:200 Y1:50 Y2:80') !== -1, 'position coords must survive verbatim');
});

check('empty file yields zero blocks (caller should show the "no cues" error)', () => {
  assert.strictEqual(SRT.parse('').length, 0);
  assert.strictEqual(SRT.parse('   \r\n\r\n  ').length, 0);
});

check('SRT.batch splits into correct-size chunks', () => {
  const blocks = SRT.parse(BASIC.repeat(23)); // 46 blocks after renumbering by parse
  const batches = SRT.batch(blocks, 20);
  assert.strictEqual(batches.length, Math.ceil(blocks.length / 20));
  assert.strictEqual(batches[0].length, 20);
});

// ------------------------------------------------------------- Claude.correctAll

section('Claude.correctAll batching / retry / fallback behaviour (network mocked)');

function fakeResponse(statusCode, bodyObj) {
  return { statusCode, body: JSON.stringify(bodyObj) };
}

function mockHttps(sequence) {
  // sequence: array of fakeResponse(...) or 'ECONNRESET', consumed one per request
  let calls = [];
  https.request = function (opts, cb) {
    calls.push(JSON.parse('{}')); // placeholder, real payload captured via req.write below
    let reqBody = '';
    const req = {
      write(chunk) { reqBody += chunk; },
      end() {
        const next = sequence.shift();
        if (next === 'ECONNRESET') {
          setImmediate(() => req._onError && req._onError(new Error('read ECONNRESET')));
          return;
        }
        const res = {
          statusCode: next.statusCode,
          setEncoding() {},
          _handlers: {},
          on(ev, fn) {
            if (ev === 'data') setImmediate(() => fn(next.body));
            if (ev === 'end') setImmediate(() => fn());
            return res;
          }
        };
        setImmediate(() => cb(res));
      },
      on(ev, fn) { if (ev === 'error') req._onError = fn; return req; },
      destroy() {}
    };
    req._lastBody = () => reqBody;
    calls[calls.length - 1] = { get body() { return reqBody; } };
    req.capturedBodyRef = calls[calls.length - 1];
    mockHttps.lastReq = req;
    return req;
  };
  return calls;
}

function correctedBlocksResponse(items, usage) {
  return fakeResponse(200, {
    stop_reason: 'end_turn',
    usage: usage || { input_tokens: 100, output_tokens: 50 },
    content: [{ type: 'text', text: JSON.stringify({ corrected_blocks: items }) }]
  });
}

// Tests share a monkey-patched https.request, so they must run strictly
// sequentially (not Promise.all) or one test's mock stomps another's.
let chain = Promise.resolve();
function run(name, fn) {
  chain = chain.then(() => Promise.resolve().then(fn))
    .then(() => { PASS++; console.log('  ok   ' + name); })
    .catch((e) => { FAIL++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); });
  return chain;
}

const profile = {
  client_name: '4S Estampas',
  subtitle_glossary: {
    terms: [{ wrong: 'de teif', correct: 'DTF' }, { wrong: 'quatro s estampas', correct: '4S Estampas' }],
    proper_nouns: ['4S Estampas e Uniformes', 'Brusque'],
    product_names: ['DTF', 'sublimação têxtil']
  },
  tone_profile: { voice: 'direto, técnico', formality: 'informal-profissional', avoid: ['gírias'], notes: 'B2B' },
  style_examples: { before_after: [{ before: 'a gente faz estampa em de teif', after: 'a gente faz estampa em DTF' }] }
};

const blocks46 = SRT.parse(BASIC.repeat(23)); // 46 blocks

let tests = [];

tests.push(run('happy path: 46 blocks / batchSize 20 -> 3 batches, all corrected', () => {
  mockHttps([
    correctedBlocksResponse(blocks46.slice(0, 20).map(b => ({ index: b.index, text: b.text.toUpperCase() }))),
    correctedBlocksResponse(blocks46.slice(20, 40).map(b => ({ index: b.index, text: b.text.toUpperCase() }))),
    correctedBlocksResponse(blocks46.slice(40, 46).map(b => ({ index: b.index, text: b.text.toUpperCase() })))
  ]);
  let progressCalls = [];
  return Claude.correctAll(blocks46, profile, { apiKey: 'sk-test', model: 'claude-sonnet-5', batchSize: 20 },
    (done, total) => progressCalls.push([done, total]))
    .then((res) => {
      assert.strictEqual(res.blocks.length, 46);
      assert.ok(res.blocks.every(b => b.text === b.original.toUpperCase()));
      assert.deepStrictEqual(progressCalls, [[1, 3], [2, 3], [3, 3]]);
      assert.strictEqual(res.usage.input_tokens, 300);
      assert.strictEqual(res.usage.output_tokens, 150);
    });
}));

tests.push(run('timestamps are never sent to the model (only index+text)', () => {
  mockHttps([correctedBlocksResponse([{ index: 1, text: 'x' }])]);
  return Claude.correctAll([blocks46[0]], profile, { apiKey: 'k', model: 'claude-sonnet-5', batchSize: 20 }, () => {})
    .then(() => {
      const sentBody = JSON.parse(mockHttps.lastReq.capturedBodyRef.body);
      const userMsg = sentBody.messages[0].content;
      assert.ok(userMsg.indexOf('00:00:01,000') === -1, 'timing string leaked into the prompt payload');
    });
}));

tests.push(run('block the model omits from corrected_blocks keeps original text (no data loss)', () => {
  mockHttps([correctedBlocksResponse([{ index: 1, text: 'CORRIGIDO' }])]); // block #2 missing
  const two = blocks46.slice(0, 2);
  return Claude.correctAll(two, profile, { apiKey: 'k', model: 'claude-sonnet-5', batchSize: 20 }, () => {})
    .then((res) => {
      assert.strictEqual(res.blocks[0].text, 'CORRIGIDO');
      assert.strictEqual(res.blocks[1].text, res.blocks[1].original, 'omitted block must fall back to original');
    });
}));

tests.push(run('429 then success -> retried transparently, result correct', () => {
  mockHttps([fakeResponse(429, { error: { message: 'rate limited' } }), correctedBlocksResponse([{ index: 1, text: 'OK' }])]);
  return Claude.correctAll([blocks46[0]], profile, { apiKey: 'k', model: 'claude-sonnet-5', batchSize: 20 }, () => {})
    .then((res) => { assert.strictEqual(res.blocks[0].text, 'OK'); });
}));

tests.push(run('network ECONNRESET then success -> retried transparently', () => {
  mockHttps(['ECONNRESET', correctedBlocksResponse([{ index: 1, text: 'OK2' }])]);
  return Claude.correctAll([blocks46[0]], profile, { apiKey: 'k', model: 'claude-sonnet-5', batchSize: 20 }, () => {})
    .then((res) => { assert.strictEqual(res.blocks[0].text, 'OK2'); });
}));

tests.push(run('3 consecutive 500s -> batch fails, error surfaces (caller must not overwrite original file)', () => {
  mockHttps([fakeResponse(500, {}), fakeResponse(500, {}), fakeResponse(500, {})]);
  return Claude.correctAll([blocks46[0]], profile, { apiKey: 'k', model: 'claude-sonnet-5', batchSize: 20 }, () => {})
    .then(() => { throw new Error('expected rejection, got success'); })
    .catch((e) => {
      if (e.message === 'expected rejection, got success') throw e;
      assert.ok(/HTTP 500/.test(e.message));
    });
}));

tests.push(run('400 (non-retryable) fails immediately without 3 retries', () => {
  const calls = mockHttps([fakeResponse(400, { error: { message: 'bad request' } })]);
  return Claude.correctAll([blocks46[0]], profile, { apiKey: 'k', model: 'claude-sonnet-5', batchSize: 20 }, () => {})
    .then(() => { throw new Error('expected rejection, got success'); })
    .catch((e) => {
      if (e.message === 'expected rejection, got success') throw e;
      assert.ok(/HTTP 400/.test(e.message));
    });
}));

tests.push(run('model refusal surfaces as a specific, readable error', () => {
  mockHttps([fakeResponse(200, { stop_reason: 'refusal', stop_details: { category: 'x' }, usage: {}, content: [] })]);
  return Claude.correctAll([blocks46[0]], profile, { apiKey: 'k', model: 'claude-sonnet-5', batchSize: 20 }, () => {})
    .then(() => { throw new Error('expected rejection, got success'); })
    .catch((e) => {
      if (e.message === 'expected rejection, got success') throw e;
      assert.ok(/recusou/.test(e.message));
    });
}));

tests.push(run('system prompt embeds glossary, protected terms and tone (no client data silently dropped)', () => {
  const prompt = Claude.buildSystemPrompt(profile);
  assert.ok(prompt.indexOf('de teif') !== -1 && prompt.indexOf('DTF') !== -1, 'glossary term missing');
  assert.ok(prompt.indexOf('4S Estampas e Uniformes') !== -1, 'protected proper noun missing');
  assert.ok(prompt.indexOf('Brusque') !== -1, 'protected proper noun missing');
  assert.ok(prompt.indexOf('B2B') !== -1, 'tone notes missing');
}));

tests.push(run('buildSystemPrompt with no profile still returns the base rules (no crash)', () => {
  const prompt = Claude.buildSystemPrompt(null);
  assert.ok(prompt.indexOf('REGRAS') !== -1);
}));

chain.then(() => {
  console.log('\n----------------------------------------');
  console.log(PASS + ' passed, ' + FAIL + ' failed');
  process.exit(FAIL ? 1 : 0);
});
