/*
 * Nachbau des obsidian-Moduls - so eng an der echten API wie moeglich.
 *
 * Wichtig: hier NUR aufnehmen, was Obsidian wirklich anbietet. Ein zu
 * freundlicher Stub bestaetigt die eigenen Annahmen, statt sie zu pruefen.
 * Zweimal ist genau das passiert: Modal hat kein register(), und Modal.doc ist
 * ein Nur-Lese-Getter. Beide Fallen sind unten nachgebildet.
 */
const { El } = require('./dom.js');

const state = { modals: [], requests: [], embedder: null };

class TFile {}

class Component {
  constructor() { this._reg = []; }
  register(fn) { this._reg.push(fn); }
  registerEvent(e) { this._reg.push(e); }
  registerDomEvent() {}
}

class View extends Component {
  constructor(leaf) { super(); this.leaf = leaf; this.contentEl = new El('div'); }
}

class Modal {
  constructor(app) {
    this.app = app;
    this.contentEl = new El('div');
    this.modalEl = new El('div');
    this.containerEl = new El('div');
    this.titleEl = new El('div');
    this.scope = { register() {} };
    state.modals.push(this);
  }
  get doc() { return global.document; }   // Nur-Lese-Getter, wie im Original
  get win() { return global.window; }
  open() { this.isOpen = true; this.onOpen(); }
  close() { this.isOpen = false; this.onClose(); }
  onOpen() {}
  onClose() {}
}

/* requestUrl: liefert Embeddings aus einem Themenschluessel statt aus einem
   Modell. Damit laesst sich pruefen, ob Bedeutungsnaehe wirklich greift. */
const TOPICS = {
  kaffee: 'espresso bohne mahlgrad siebtraeger crema bruehgruppe tamper milchschaum kaffee kaffeemaschine barista muehle entkalken reinigung blindsieb',
  laufen: 'halbmarathon intervall tempolauf regeneration laufschuh puls trainingsplan kilometer wettkampf laufen sport beine muede erschoepft dehnen pace',
  obsidian: 'vault plugin markdown notiz verlinkung graph frontmatter tag suche manifest oberflaeche index cache ordner struktur',
  garten: 'tomate balkon giessen geiztrieb kraeuter basilikum rosmarin duenger topf erde ernte schnecke aussaat pflanze',
};
const TOPIC_KEYS = Object.keys(TOPICS);

function fakeEmbedding(text) {
  const low = text.toLowerCase();
  const vec = new Array(TOPIC_KEYS.length + 1).fill(0);
  TOPIC_KEYS.forEach((key, i) => {
    for (const w of TOPICS[key].split(' ')) if (low.includes(w)) vec[i] += 1;
  });
  vec[TOPIC_KEYS.length] = 0.35;          // gemeinsamer Sockel, wie bei echten Modellen
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

async function requestUrl(opts) {
  state.requests.push(opts);
  if (state.failNext) { state.failNext = false; return { status: 500, text: 'kaputt', json: null }; }
  const body = JSON.parse(opts.body);
  const input = [].concat(body.input);
  return {
    status: 200,
    json: { data: input.map((text, index) => ({ index, embedding: fakeEmbedding(text) })) },
  };
}

module.exports = {
  Plugin: class extends Component {},
  ItemView: View,
  View,
  Component,
  Modal,
  PluginSettingTab: class {},
  Setting: class {},
  Notice: class { constructor(msg) { state.lastNotice = msg; } },
  TFile,
  normalizePath: (s) => s,
  Platform: { isMobile: false },
  setIcon: (el, name) => { el.icon = name; },
  requestUrl,
  __state: state,
  __fakeEmbedding: fakeEmbedding,
};
