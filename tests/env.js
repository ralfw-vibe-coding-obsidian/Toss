/* Laedt main.js gegen die Stubs und baut einen Vault im Speicher. */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { El } = require('./dom.js');
const obsidian = require('./obsidian.js');
const corpus = require('./corpus.js');

global.window = { innerHeight: 800, setTimeout: (f, t) => setTimeout(f, t) };
global.document = {
  activeElement: null,
  handlers: {},
  addEventListener(n, fn) { (this.handlers[n] = this.handlers[n] || []).push(fn); },
  removeEventListener(n, fn) { this.handlers[n] = (this.handlers[n] || []).filter((f) => f !== fn); },
  fire(n, evt) { for (const fn of [...(this.handlers[n] || [])]) fn(evt); },
};
global.CSS = { escape: (s) => s.replace(/["\\]/g, '\\$&') };
if (typeof performance === 'undefined') global.performance = { now: () => Date.now() };

const origLoad = Module._load;
Module._load = function (req) {
  if (req === 'obsidian') return obsidian;
  return origLoad.apply(this, arguments);
};

/* main.js um einen Export der Interna ergaenzen und laden. */
function loadPlugin() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')
    + '\nmodule.exports.__i = { TossIndex, TossView, NoteModal, TagEditor, Embedder, DEFAULT_SETTINGS,'
    + ' parseNote, buildNote, deriveTitle, featurize, fold, stem, snippet, queryRegex,'
    + ' encodeVec, decodeVec, normalizeVec, dot, hashText, LAYOUTS };\n';
  const file = path.join(__dirname, '.main.generated.js');
  fs.writeFileSync(file, source);
  return require(file).__i;
}

function makeVault(I, extra = []) {
  const store = new Map();
  const files = [];
  const add = (p, content) => {
    const f = new obsidian.TFile();
    Object.assign(f, {
      path: p,
      extension: 'md',
      basename: p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/, ''),
      stat: { mtime: 1, ctime: Date.parse('2026-01-01') },
    });
    files.push(f);
    store.set(p, content);
    return f;
  };

  const start = new Date('2026-08-01T08:00:00Z');
  corpus.forEach(([title, tags, body], i) => {
    const ts = new Date(start.getTime() + i * 6 * 3600 * 1000);
    const fm = ['---', 'created: ' + ts.toISOString()];
    if (title) fm.push('title: "' + title + '"');
    if (tags) fm.push('tags: [' + tags.split(',').map((t) => '"' + t.trim() + '"').join(', ') + ']');
    fm.push('---', '');
    add('Toss/' + ts.toISOString().replace(/[-:T]/g, '').slice(0, 14) + '.md', fm.join('\n') + body + '\n');
  });
  for (const [p, c] of extra) add(p, c);

  const vault = {
    getMarkdownFiles: () => files.slice(),
    getAbstractFileByPath: (p) => files.find((f) => f.path === p) || null,
    cachedRead: async (f) => store.get(f.path),
    modify: async (f, c) => { store.set(f.path, c); },
    create: async (p, c) => add(p, c),
    createFolder: async () => {},
    adapter: { exists: async () => false, read: async () => '', write: async () => {} },
  };
  return { store, files, vault, add };
}

async function makeEnv(options = {}) {
  const I = loadPlugin();
  const { store, files, vault, add } = makeVault(I, options.extra);
  const opened = { path: null, trashed: null };

  const plugin = {
    manifest: { dir: '.obsidian/plugins/toss', version: '0.0.0-test' },
    settings: Object.assign({}, I.DEFAULT_SETTINGS, options.settings),
    saveSettings: async () => {},
    app: {
      vault,
      fileManager: { trashFile: async (f) => { opened.trashed = f.path; } },
      workspace: {
        getLeaf: () => ({ openFile: (f) => { opened.path = f.path; } }),
        getLeavesOfType: () => [],
      },
    },
  };

  const index = new I.TossIndex(plugin);
  index.saveCache = async () => {};
  plugin.index = index;
  plugin.createNote = async ({ body, title, tags }) => {
    const p = 'Toss/neu-' + files.length + '.md';
    const fm = ['---', 'created: ' + new Date().toISOString()];
    if (title) fm.push('title: "' + title + '"');
    if (tags && tags.length) fm.push('tags: [' + tags.map((t) => '"' + t + '"').join(', ') + ']');
    fm.push('---', '');
    const f = await vault.create(p, fm.join('\n') + body + '\n');
    await index.readFile(f);
    index.afterChange();
    return f;
  };

  await index.initialize();
  index.saveSoon.cancel();
  index.lsaSoon.cancel();
  index.embedSoon.cancel();
  index.buildLsa();

  const view = new I.TossView({}, plugin);
  view.app = plugin.app;
  await view.onOpen();

  return { I, plugin, index, view, store, files, vault, add, opened, obsidian };
}

module.exports = { makeEnv, El, obsidian };
