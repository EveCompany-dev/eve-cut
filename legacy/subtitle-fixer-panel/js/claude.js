/* claude.js - Anthropic Messages API over Node's https (CEP has no CORS escape
 * hatch for XHR, and Node avoids shipping node_modules with the panel).
 *
 * Only the text of each block is ever sent; timings stay on this side.
 */
(function (global) {
  'use strict';

  var https = require('https');

  var API_HOST = 'api.anthropic.com';
  var API_PATH = '/v1/messages';
  var API_VERSION = '2023-06-01';

  // The model must return one entry per block it was given, keyed by index.
  var SCHEMA = {
    type: 'object',
    properties: {
      corrected_blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            text: { type: 'string' }
          },
          required: ['index', 'text'],
          additionalProperties: false
        }
      }
    },
    required: ['corrected_blocks'],
    additionalProperties: false
  };

  var RULES = [
    'Você revisa legendas geradas automaticamente pelo Speech-to-Text do Adobe Premiere Pro.',
    'A transcrição é feita de ouvido, então os erros típicos são: palavras foneticamente parecidas,',
    'nomes próprios e marcas escritos errado, siglas soletradas ("de teif" em vez de "DTF"),',
    'pontuação ausente ou trocada e jargão do cliente mal transcrito.',
    '',
    'REGRAS (todas obrigatórias):',
    '1. Corrija apenas erros de transcrição, ortografia, acentuação e pontuação, e aplique o glossário do cliente.',
    '2. NUNCA mude o significado, NUNCA reescreva a fala, NUNCA traduza e NUNCA acrescente informação.',
    '3. Mantenha o comprimento próximo do original — legenda longa demais não cabe na tela. Não junte nem divida blocos.',
    '4. Preserve as quebras de linha dentro do bloco (o caractere \\n) exatamente como vieram.',
    '5. A fala pode estar cortada no meio entre um bloco e o outro. Isso é normal: não "complete" a frase.',
    '6. Se um bloco já estiver correto, devolva o texto idêntico ao original.',
    '7. Devolva exatamente um item para cada bloco recebido, com o mesmo "index". Não reordene, não omita, não acrescente.'
  ].join('\n');

  /** Turn a client profile record into the system prompt. */
  function buildSystemPrompt(profile) {
    var parts = [RULES];

    if (!profile) return parts.join('\n');

    var name = profile.client_name || '';
    var g = profile.subtitle_glossary || {};
    var t = profile.tone_profile || {};
    var ex = (profile.style_examples || {}).before_after || [];

    var ctx = ['', '--- PERFIL DO CLIENTE' + (name ? ': ' + name : '') + ' ---'];

    var terms = (g.terms || []).filter(function (x) { return x && x.wrong && x.correct; });
    if (terms.length) {
      ctx.push('', 'GLOSSÁRIO (o que o Premiere costuma errar -> forma correta):');
      terms.forEach(function (x) { ctx.push('  "' + x.wrong + '" -> "' + x.correct + '"'); });
    }

    var nouns = (g.proper_nouns || []).concat(g.product_names || []).filter(Boolean);
    if (nouns.length) {
      ctx.push('', 'TERMOS PROTEGIDOS (grafia exata, nunca alterar nem "corrigir"):');
      ctx.push('  ' + nouns.join(', '));
    }

    var tone = [];
    if (t.voice) tone.push('Voz: ' + t.voice);
    if (t.formality) tone.push('Formalidade: ' + t.formality);
    if (t.avoid && t.avoid.length) tone.push('Evitar: ' + [].concat(t.avoid).join(', '));
    if (t.notes) tone.push('Notas: ' + t.notes);
    if (tone.length) {
      ctx.push('', 'TOM DE VOZ DA MARCA (ajuste leve de escolha de palavras, sem reescrever a fala):');
      tone.forEach(function (l) { ctx.push('  ' + l); });
    }

    var goodEx = ex.filter(function (x) { return x && x.before && x.after; });
    if (goodEx.length) {
      ctx.push('', 'EXEMPLOS APROVADOS PELO CLIENTE:');
      goodEx.forEach(function (x) { ctx.push('  "' + x.before + '" -> "' + x.after + '"'); });
    }

    return parts.concat(ctx).join('\n');
  }

  function request(body, apiKey) {
    return new Promise(function (resolve, reject) {
      var payload = JSON.stringify(body);
      var req = https.request({
        host: API_HOST,
        path: API_PATH,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          'content-length': Buffer.byteLength(payload)
        },
        timeout: 180000
      }, function (res) {
        var chunks = '';
        res.setEncoding('utf8');
        res.on('data', function (d) { chunks += d; });
        res.on('end', function () {
          var parsed = null;
          try { parsed = JSON.parse(chunks); } catch (e) { /* non-JSON error page */ }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            var msg = (parsed && parsed.error && parsed.error.message) || chunks.slice(0, 300);
            var err = new Error('HTTP ' + res.statusCode + ' - ' + msg);
            err.status = res.statusCode;
            reject(err);
          }
        });
      });
      req.on('timeout', function () { req.destroy(new Error('Tempo limite excedido')); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function isRetryable(err) {
    if (err.fatal) return false;
    return !err.status || err.status === 429 || err.status >= 500;
  }

  /**
   * Correct one batch. Returns a map of index -> corrected text.
   * The system prompt is identical across batches, so it is marked cacheable.
   */
  function correctBatch(blocks, systemPrompt, opts) {
    var payload = blocks.map(function (b) { return { index: b.index, text: b.text }; });

    var body = {
      model: opts.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: SCHEMA }
      },
      messages: [{
        role: 'user',
        content: 'Revise estes ' + payload.length + ' blocos de legenda:\n\n' +
                 JSON.stringify(payload, null, 1)
      }]
    };

    var attempt = 0;
    function run() {
      attempt++;
      return request(body, opts.apiKey).then(function (res) {
        if (res.stop_reason === 'refusal') {
          var refusalErr = new Error('O modelo recusou este lote (' +
            ((res.stop_details && res.stop_details.category) || 'sem categoria') + ').');
          refusalErr.fatal = true;
          throw refusalErr;
        }
        var textBlock = null;
        for (var i = 0; i < (res.content || []).length; i++) {
          if (res.content[i].type === 'text') { textBlock = res.content[i].text; break; }
        }
        if (!textBlock) {
          var emptyErr = new Error('Resposta vazia do modelo.');
          emptyErr.fatal = true;
          throw emptyErr;
        }

        var data;
        try {
          data = JSON.parse(textBlock);
        } catch (parseErr) {
          var badJsonErr = new Error('Resposta do modelo não é JSON válido: ' + parseErr.message);
          badJsonErr.fatal = true;
          throw badJsonErr;
        }
        var map = {};
        (data.corrected_blocks || []).forEach(function (b) {
          if (typeof b.index === 'number' && typeof b.text === 'string') map[b.index] = b.text;
        });
        return { map: map, usage: res.usage || {} };
      }).catch(function (err) {
        if (attempt < 3 && isRetryable(err)) {
          return sleep(attempt * 1500).then(run);
        }
        throw err;
      });
    }
    return run();
  }

  /**
   * Correct every block. onProgress(done, total) fires per batch.
   * Blocks the model skips or returns empty keep their original text.
   */
  function correctAll(blocks, profile, opts, onProgress) {
    var systemPrompt = buildSystemPrompt(profile);
    var batches = SRT.batch(blocks, opts.batchSize);
    var corrected = blocks.map(function (b) {
      return { index: b.index, num: b.num, timing: b.timing, text: b.text, original: b.text };
    });
    var byIndex = {};
    corrected.forEach(function (b) { byIndex[b.index] = b; });

    var usage = { input_tokens: 0, output_tokens: 0 };
    var chain = Promise.resolve();

    batches.forEach(function (batchBlocks, i) {
      chain = chain.then(function () {
        return correctBatch(batchBlocks, systemPrompt, opts).then(function (res) {
          batchBlocks.forEach(function (b) {
            var fixed = res.map[b.index];
            if (typeof fixed === 'string' && fixed.trim()) byIndex[b.index].text = fixed.trim();
          });
          usage.input_tokens += res.usage.input_tokens || 0;
          usage.output_tokens += res.usage.output_tokens || 0;
          if (onProgress) onProgress(i + 1, batches.length);
        });
      });
    });

    return chain.then(function () { return { blocks: corrected, usage: usage }; });
  }

  global.Claude = {
    correctAll: correctAll,
    buildSystemPrompt: buildSystemPrompt
  };
})(window);
