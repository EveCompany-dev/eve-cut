/* store.js - settings and client profiles on disk, via CEP's Node runtime.
 *
 * Both live under the user's app-data folder so the team can edit or back them
 * up without touching the installed extension:
 *   %APPDATA%/SubtitleFixer/settings.json
 *   %APPDATA%/SubtitleFixer/profiles/<slug>.json
 */
(function (global) {
  'use strict';

  var fs = require('fs');
  var path = require('path');
  var os = require('os');

  var ROOT = path.join(
    process.env.APPDATA || path.join(os.homedir(), '.config'),
    'SubtitleFixer'
  );
  var PROFILES_DIR = path.join(ROOT, 'profiles');
  var SETTINGS_FILE = path.join(ROOT, 'settings.json');

  var DEFAULTS = {
    apiKey: '',
    model: 'claude-opus-5',
    batchSize: 20,
    suffix: '_corrigido',
    sameFolder: true,
    outDir: '',
    lastClient: '',
    importToProject: true,
    revealAfter: false
  };

  function extensionRoot() {
    // file:///C:/.../com.eve.subtitlefixer/index.html -> C:\...\com.eve.subtitlefixer
    var href = decodeURIComponent(global.location.href.split('?')[0]);
    var p = href.replace(/^file:\/{2,3}/, '').replace(/\/[^\/]*$/, '');
    if (/^[a-zA-Z]:/.test(p) === false && /^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    return path.normalize(p);
  }

  function ensureDirs() {
    if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT, { recursive: true });
    if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }

  /** Copy the bundled sample profiles on first run so the panel is never empty. */
  function seedProfiles() {
    var bundled = path.join(extensionRoot(), 'profiles');
    if (!fs.existsSync(bundled)) return;
    var names = fs.readdirSync(bundled).filter(function (n) { return /\.json$/i.test(n); });
    for (var i = 0; i < names.length; i++) {
      var dest = path.join(PROFILES_DIR, names[i]);
      if (!fs.existsSync(dest)) {
        fs.writeFileSync(dest, fs.readFileSync(path.join(bundled, names[i])));
      }
    }
  }

  function init() {
    ensureDirs();
    if (!fs.readdirSync(PROFILES_DIR).length) seedProfiles();
  }

  // ---------- settings ----------

  function loadSettings() {
    var s = {};
    try {
      if (fs.existsSync(SETTINGS_FILE)) s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    } catch (e) { /* corrupt file -> fall back to defaults */ }
    var out = {};
    for (var k in DEFAULTS) out[k] = (s[k] === undefined || s[k] === null) ? DEFAULTS[k] : s[k];
    return out;
  }

  function saveSettings(s) {
    ensureDirs();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2), 'utf8');
  }

  // ---------- profiles ----------

  function slugify(name) {
    return String(name)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cliente';
  }

  function blankProfile(name) {
    return {
      client_name: name || 'Novo cliente',
      subtitle_glossary: { terms: [], proper_nouns: [] },
      tone_profile: { voice: '', formality: '', avoid: [], notes: '' },
      style_examples: { before_after: [] }
    };
  }

  function listProfiles() {
    ensureDirs();
    var out = [];
    var names = fs.readdirSync(PROFILES_DIR).filter(function (n) { return /\.json$/i.test(n); });
    for (var i = 0; i < names.length; i++) {
      var slug = names[i].replace(/\.json$/i, '');
      try {
        var data = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, names[i]), 'utf8'));
        out.push({ slug: slug, name: data.client_name || slug, data: data });
      } catch (e) {
        out.push({ slug: slug, name: slug + ' (JSON inválido)', data: null });
      }
    }
    out.sort(function (a, b) { return a.name.localeCompare(b.name, 'pt-BR'); });
    return out;
  }

  function saveProfile(slug, data) {
    ensureDirs();
    fs.writeFileSync(path.join(PROFILES_DIR, slug + '.json'), JSON.stringify(data, null, 2), 'utf8');
  }

  global.Store = {
    init: init,
    ROOT: ROOT,
    PROFILES_DIR: PROFILES_DIR,
    SETTINGS_FILE: SETTINGS_FILE,
    extensionRoot: extensionRoot,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    listProfiles: listProfiles,
    saveProfile: saveProfile,
    blankProfile: blankProfile,
    slugify: slugify
  };
})(window);
