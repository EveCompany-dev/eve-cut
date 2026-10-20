/* main.js - panel wiring. */
(function () {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var childProcess = require('child_process');

  var $ = function (id) { return document.getElementById(id); };

  var settings = null;
  var profiles = [];
  var current = { filePath: null, blocks: null, result: null, outPath: null };
  var editing = null; // { slug, data }
  var busy = false;

  // ---------------------------------------------------------------- helpers

  function setFoot(text, state) {
    $('foot-text').textContent = text;
    $('foot-dot').className = 'dot' + (state ? ' ' + state : '');
  }

  function showStatus(el, msg, kind) {
    el.className = 'status visible' + (kind ? ' ' + kind : '');
    el.textContent = msg;
  }

  function hideStatus(el) { el.className = 'status'; }

  function bytes(n) {
    return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';
  }

  function reveal(target) {
    try {
      childProcess.exec('explorer.exe /select,"' + target + '"');
    } catch (e) { /* best effort */ }
  }

  function openFolder(dir) {
    try { childProcess.exec('explorer.exe "' + dir + '"'); } catch (e) { /* best effort */ }
  }

  /** Run an ExtendScript function in Premiere. CSInterface isn't needed for this. */
  function evalScript(script) {
    return new Promise(function (resolve) {
      if (!window.__adobe_cep__) return resolve('');
      window.__adobe_cep__.evalScript(script, resolve);
    });
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ------------------------------------------------------------------- tabs

  var TABS = [
    ['tab-fix', 'view-fix'],
    ['tab-profile', 'view-profile'],
    ['tab-settings', 'view-settings']
  ];

  TABS.forEach(function (pair) {
    $(pair[0]).addEventListener('click', function () {
      TABS.forEach(function (p) {
        $(p[0]).classList.toggle('active', p[0] === pair[0]);
        $(p[1]).classList.toggle('visible', p[1] === pair[1]);
      });
    });
  });

  // ------------------------------------------------------------ file input

  function acceptFile(p) {
    if (!p) return;
    if (!/\.(srt|vtt)$/i.test(p)) {
      showStatus($('status'), 'Selecione um arquivo .srt exportado do Premiere.', 'err');
      return;
    }
    var stat;
    try { stat = fs.statSync(p); } catch (e) {
      showStatus($('status'), 'Não consegui ler o arquivo: ' + e.message, 'err');
      return;
    }

    var raw;
    try { raw = fs.readFileSync(p, 'utf8'); } catch (e) {
      showStatus($('status'), 'Não consegui ler o arquivo: ' + e.message, 'err');
      return;
    }

    var blocks = SRT.parse(raw);
    if (!blocks.length) {
      showStatus($('status'), 'Nenhum bloco de legenda encontrado nesse arquivo.', 'err');
      return;
    }

    current.filePath = p;
    current.blocks = blocks;
    current.result = null;
    current.outPath = null;

    $('dropzone').style.display = 'none';
    $('filechip').style.display = 'flex';
    $('filechip-name').textContent = path.basename(p);
    $('filechip-name').title = p;
    $('filechip-meta').textContent = blocks.length + ' blocos - ' + bytes(stat.size);
    $('result').style.display = 'none';
    hideStatus($('status'));
    setFoot(blocks.length + ' blocos carregados');
  }

  function clearFile() {
    current = { filePath: null, blocks: null, result: null, outPath: null };
    $('dropzone').style.display = 'block';
    $('filechip').style.display = 'none';
    $('result').style.display = 'none';
    hideStatus($('status'));
    $('progress-wrap').className = 'progress-wrap';
    setFoot('Pronto');
  }

  function browseForSrt() {
    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) return;
    var start = current.filePath ? path.dirname(current.filePath) : '';
    var res = window.cep.fs.showOpenDialogEx(false, false, 'Selecionar legenda', start, ['srt', 'vtt']);
    if (res && res.data && res.data.length) acceptFile(res.data[0]);
  }

  $('dropzone').addEventListener('click', browseForSrt);
  $('filechip-clear').addEventListener('click', clearFile);

  ['dragenter', 'dragover'].forEach(function (ev) {
    $('dropzone').addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      $('dropzone').classList.add('over');
    });
  });
  ['dragleave', 'dragend'].forEach(function (ev) {
    $('dropzone').addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      $('dropzone').classList.remove('over');
    });
  });
  $('dropzone').addEventListener('drop', function (e) {
    e.preventDefault(); e.stopPropagation();
    $('dropzone').classList.remove('over');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.path) acceptFile(f.path);
    else showStatus($('status'), 'Não consegui obter o caminho do arquivo. Clique para procurar.', 'warn');
  });
  document.addEventListener('dragover', function (e) { e.preventDefault(); });
  document.addEventListener('drop', function (e) { e.preventDefault(); });

  // ------------------------------------------------------------------- run

  function outputPathFor(src) {
    var dir = (!settings.sameFolder && settings.outDir) ? settings.outDir : path.dirname(src);
    var ext = path.extname(src);
    var base = path.basename(src, ext);
    return path.join(dir, base + (settings.suffix || '_corrigido') + ext);
  }

  function selectedProfile() {
    var slug = $('client-select').value;
    for (var i = 0; i < profiles.length; i++) if (profiles[i].slug === slug) return profiles[i];
    return null;
  }

  function setBusy(on) {
    busy = on;
    $('btn-run').disabled = on;
    $('btn-run').textContent = on ? 'Corrigindo...' : 'Corrigir legendas';
    $('client-select').disabled = on;
  }

  function progress(done, total) {
    var pct = Math.round((done / total) * 100);
    $('progress-bar').style.width = pct + '%';
    $('progress-pct').textContent = pct + '%';
    $('progress-text').textContent = 'Lote ' + done + ' de ' + total;
  }

  function run() {
    if (busy) return;

    if (!settings.apiKey) {
      showStatus($('status'), 'Configure a chave da API em Configurações (ícone de engrenagem).', 'err');
      return;
    }
    if (!current.blocks) {
      showStatus($('status'), 'Escolha um arquivo .srt primeiro.', 'err');
      return;
    }

    var prof = selectedProfile();
    if (!prof || !prof.data) {
      showStatus($('status'), 'Selecione um cliente com perfil válido.', 'err');
      return;
    }

    settings.lastClient = prof.slug;
    settings.importToProject = $('opt-import').checked;
    settings.revealAfter = $('opt-reveal').checked;
    Store.saveSettings(settings);

    setBusy(true);
    hideStatus($('status'));
    $('result').style.display = 'none';
    $('progress-wrap').className = 'progress-wrap visible';
    progress(0, 1);
    $('progress-text').textContent = 'Enviando...';
    setFoot('Corrigindo legendas de ' + prof.name + '...', 'busy');

    var opts = {
      apiKey: settings.apiKey,
      model: settings.model,
      batchSize: Math.max(5, Math.min(80, parseInt(settings.batchSize, 10) || 20))
    };

    Claude.correctAll(current.blocks, prof.data, opts, progress)
      .then(function (res) {
        current.result = res.blocks;
        var outPath = outputPathFor(current.filePath);
        fs.writeFileSync(outPath, SRT.build(res.blocks), 'utf8');
        current.outPath = outPath;

        var changed = res.blocks.filter(function (b) { return b.text !== b.original; });
        renderDiff(changed, res.blocks.length);

        var tokens = res.usage.input_tokens + res.usage.output_tokens;
        showStatus($('status'),
          'Pronto. ' + changed.length + ' de ' + res.blocks.length + ' blocos corrigidos. ' +
          'Salvo em ' + outPath + ' (~' + tokens.toLocaleString('pt-BR') + ' tokens).', 'ok');
        setFoot(changed.length + ' blocos corrigidos', 'ok');

        if ($('opt-reveal').checked) reveal(outPath);
        if ($('opt-import').checked) {
          return evalScript('importSubtitle("' + outPath.replace(/\\/g, '\\\\') + '")')
            .then(function (r) {
              if (r && r.indexOf('ok') !== 0) {
                showStatus($('status'),
                  $('status').textContent + ' (não consegui importar no projeto: ' + r + ')', 'warn');
              }
            });
        }
      })
      .catch(function (err) {
        showStatus($('status'), 'Falhou: ' + err.message + '  O arquivo original não foi alterado.', 'err');
        setFoot('Erro', 'err');
      })
      .then(function () {
        setBusy(false);
        $('progress-wrap').className = 'progress-wrap';
      });
  }

  $('btn-run').addEventListener('click', run);

  function renderDiff(changed, total) {
    $('result').style.display = 'block';
    $('diff-count').textContent = changed.length + ' de ' + total + ' blocos alterados';
    var body = $('diff-body');

    if (!changed.length) {
      body.innerHTML = '<div class="empty">Nenhuma alteração &mdash; a transcrição já estava correta.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < changed.length; i++) {
      var b = changed[i];
      html += '<div class="diff-item">' +
        '<div class="tc">#' + b.num + ' &middot; ' + esc(SRT.startOf(b.timing)) + '</div>' +
        '<div class="before">' + esc(b.original).replace(/\n/g, ' / ') + '</div>' +
        '<div class="after">' + esc(b.text).replace(/\n/g, ' / ') + '</div>' +
        '</div>';
    }
    body.innerHTML = html;
  }

  $('btn-saveas').addEventListener('click', function () {
    if (!current.result || !window.cep || !window.cep.fs) return;
    var suggested = path.basename(outputPathFor(current.filePath));
    var res = window.cep.fs.showSaveDialogEx(
      'Salvar legenda corrigida', path.dirname(current.filePath), ['srt'], suggested);
    if (res && res.data) {
      try {
        fs.writeFileSync(res.data, SRT.build(current.result), 'utf8');
        showStatus($('status'), 'Salvo em ' + res.data, 'ok');
      } catch (e) {
        showStatus($('status'), 'Não consegui salvar: ' + e.message, 'err');
      }
    }
  });

  // --------------------------------------------------------- profile editor

  function glossRow(wrong, correct) {
    var row = document.createElement('div');
    row.className = 'gloss-row';
    row.innerHTML =
      '<input type="text" class="g-wrong" placeholder="como sai errado">' +
      '<span class="arrow">&rarr;</span>' +
      '<input type="text" class="g-correct" placeholder="forma correta">' +
      '<button class="mini-btn" title="Remover">&times;</button>';
    row.querySelector('.g-wrong').value = wrong || '';
    row.querySelector('.g-correct').value = correct || '';
    row.querySelector('.mini-btn').addEventListener('click', function () { row.remove(); });
    return row;
  }

  function exRow(before, after) {
    var row = document.createElement('div');
    row.className = 'gloss-row';
    row.innerHTML =
      '<input type="text" class="e-before" placeholder="como veio">' +
      '<span class="arrow">&rarr;</span>' +
      '<input type="text" class="e-after" placeholder="como deveria ficar">' +
      '<button class="mini-btn" title="Remover">&times;</button>';
    row.querySelector('.e-before').value = before || '';
    row.querySelector('.e-after').value = after || '';
    row.querySelector('.mini-btn').addEventListener('click', function () { row.remove(); });
    return row;
  }

  function loadProfileIntoForm(entry) {
    editing = entry;
    var d = (entry && entry.data) || Store.blankProfile('Novo cliente');

    var g = d.subtitle_glossary || {};
    var t = d.tone_profile || {};
    var ex = (d.style_examples || {}).before_after || [];

    var list = $('gloss-list');
    list.innerHTML = '';
    (g.terms || []).forEach(function (x) { list.appendChild(glossRow(x.wrong, x.correct)); });
    if (!list.children.length) list.appendChild(glossRow('', ''));

    $('prof-nouns').value = (g.proper_nouns || []).concat(g.product_names || []).join(', ');
    $('prof-voice').value = t.voice || '';
    $('prof-formality').value = t.formality || '';
    $('prof-avoid').value = (t.avoid || []).join(', ');
    $('prof-notes').value = t.notes || '';

    var exList = $('ex-list');
    exList.innerHTML = '';
    ex.forEach(function (x) { exList.appendChild(exRow(x.before, x.after)); });

    hideStatus($('profile-status'));
  }

  function splitList(s) {
    return String(s).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  function saveProfileForm() {
    if (!editing) return;

    var terms = [];
    Array.prototype.forEach.call($('gloss-list').children, function (row) {
      var w = row.querySelector('.g-wrong').value.trim();
      var c = row.querySelector('.g-correct').value.trim();
      if (w && c) terms.push({ wrong: w, correct: c });
    });

    var examples = [];
    Array.prototype.forEach.call($('ex-list').children, function (row) {
      var b = row.querySelector('.e-before').value.trim();
      var a = row.querySelector('.e-after').value.trim();
      if (b && a) examples.push({ before: b, after: a });
    });

    var data = {
      client_name: (editing.data && editing.data.client_name) || editing.name,
      subtitle_glossary: { terms: terms, proper_nouns: splitList($('prof-nouns').value) },
      tone_profile: {
        voice: $('prof-voice').value.trim(),
        formality: $('prof-formality').value.trim(),
        avoid: splitList($('prof-avoid').value),
        notes: $('prof-notes').value.trim()
      },
      style_examples: { before_after: examples }
    };

    try {
      Store.saveProfile(editing.slug, data);
      showStatus($('profile-status'), 'Perfil salvo em ' + editing.slug + '.json', 'ok');
      refreshProfiles(editing.slug);
    } catch (e) {
      showStatus($('profile-status'), 'Não consegui salvar: ' + e.message, 'err');
    }
  }

  $('btn-add-gloss').addEventListener('click', function () {
    $('gloss-list').appendChild(glossRow('', ''));
  });
  $('btn-add-ex').addEventListener('click', function () {
    $('ex-list').appendChild(exRow('', ''));
  });
  $('btn-save-profile').addEventListener('click', saveProfileForm);
  $('btn-reveal-profiles').addEventListener('click', function () { openFolder(Store.PROFILES_DIR); });

  // Inline name field rather than window.prompt() - a modal dialog would freeze
  // the CEP panel's message loop.
  function toggleNewClient(show) {
    $('new-client-row').style.display = show ? 'flex' : 'none';
    if (show) { $('new-client-name').value = ''; $('new-client-name').focus(); }
  }

  function createClient() {
    var name = $('new-client-name').value.trim();
    if (!name) return;
    var slug = Store.slugify(name);
    if (profiles.some(function (p) { return p.slug === slug; })) {
      showStatus($('profile-status'), 'Já existe um cliente com esse nome.', 'err');
      return;
    }
    var data = Store.blankProfile(name);
    try {
      Store.saveProfile(slug, data);
    } catch (e) {
      showStatus($('profile-status'), 'Não consegui criar: ' + e.message, 'err');
      return;
    }
    toggleNewClient(false);
    refreshProfiles(slug);
    showStatus($('profile-status'), 'Cliente criado. Preencha o glossário e salve.', 'ok');
  }

  $('btn-new-profile').addEventListener('click', function () {
    toggleNewClient($('new-client-row').style.display === 'none');
  });
  $('btn-create-client').addEventListener('click', createClient);
  $('btn-cancel-client').addEventListener('click', function () { toggleNewClient(false); });
  $('new-client-name').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') createClient();
    if (e.key === 'Escape') toggleNewClient(false);
  });

  $('profile-select').addEventListener('change', function () {
    var slug = $('profile-select').value;
    for (var i = 0; i < profiles.length; i++) {
      if (profiles[i].slug === slug) { loadProfileIntoForm(profiles[i]); return; }
    }
  });

  // ------------------------------------------------------------- settings

  function loadSettingsIntoForm() {
    $('set-key').value = settings.apiKey || '';
    $('set-model').value = settings.model;
    $('set-batch').value = settings.batchSize;
    $('set-suffix').value = settings.suffix;
    $('set-samefolder').checked = !!settings.sameFolder;
    $('set-outdir').value = settings.outDir || '';
    $('set-outdir').disabled = !!settings.sameFolder;
    $('set-path').textContent = Store.SETTINGS_FILE;
    $('opt-import').checked = !!settings.importToProject;
    $('opt-reveal').checked = !!settings.revealAfter;
    var opt = $('set-model').options[$('set-model').selectedIndex];
    $('foot-model').textContent = opt ? opt.textContent.split('—')[0].trim() : settings.model;
  }

  $('set-samefolder').addEventListener('change', function () {
    $('set-outdir').disabled = $('set-samefolder').checked;
  });

  $('btn-pick-outdir').addEventListener('click', function () {
    if (!window.cep || !window.cep.fs || !window.cep.fs.showOpenDialogEx) return;
    var res = window.cep.fs.showOpenDialogEx(false, true, 'Pasta de saída', $('set-outdir').value || '');
    if (res && res.data && res.data.length) {
      $('set-outdir').value = res.data[0];
      $('set-samefolder').checked = false;
      $('set-outdir').disabled = false;
    }
  });

  $('btn-save-settings').addEventListener('click', function () {
    settings.apiKey = $('set-key').value.trim();
    settings.model = $('set-model').value;
    settings.batchSize = Math.max(5, Math.min(80, parseInt($('set-batch').value, 10) || 20));
    settings.suffix = $('set-suffix').value.trim() || '_corrigido';
    settings.sameFolder = $('set-samefolder').checked;
    settings.outDir = $('set-outdir').value.trim();
    try {
      Store.saveSettings(settings);
      showStatus($('settings-status'), 'Configurações salvas.', 'ok');
      loadSettingsIntoForm();
    } catch (e) {
      showStatus($('settings-status'), 'Não consegui salvar: ' + e.message, 'err');
    }
  });

  // ------------------------------------------------------------------ init

  function refreshProfiles(select) {
    profiles = Store.listProfiles();
    var want = select || settings.lastClient;

    [$('client-select'), $('profile-select')].forEach(function (sel) {
      sel.innerHTML = '';
      if (!profiles.length) {
        var o = document.createElement('option');
        o.textContent = 'Nenhum cliente cadastrado';
        o.value = '';
        sel.appendChild(o);
        return;
      }
      profiles.forEach(function (p) {
        var o = document.createElement('option');
        o.value = p.slug;
        o.textContent = p.name;
        sel.appendChild(o);
      });
      if (want) sel.value = want;
      if (!sel.value) sel.value = profiles[0].slug;
    });

    if (profiles.length) {
      var slug = $('profile-select').value;
      for (var i = 0; i < profiles.length; i++) {
        if (profiles[i].slug === slug) { loadProfileIntoForm(profiles[i]); break; }
      }
    }
  }

  function init() {
    if (typeof require !== 'function') {
      document.body.innerHTML =
        '<div style="padding:20px;color:#eabcbc;font-family:sans-serif;font-size:12px">' +
        'Node.js não está habilitado para este painel. Reinstale a extensão e reinicie o Premiere.</div>';
      return;
    }

    Store.init();
    settings = Store.loadSettings();
    loadSettingsIntoForm();
    refreshProfiles();

    if (!settings.apiKey) {
      showStatus($('status'), 'Antes de começar: cadastre a chave da API em Configurações.', 'warn');
      setFoot('Chave da API não configurada', 'err');
    } else {
      setFoot('Pronto', 'ok');
    }
  }

  init();
})();
