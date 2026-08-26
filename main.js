'use strict';

/*
 * Toss - ein Mem-Klon fuer Obsidian.
 *
 * Bewusst eine einzige Datei ohne Build-Schritt: Obsidian laedt main.js direkt,
 * und auf Mobile gibt es kein require('./modul.js'). Die Abschnitte unten sind
 * die Module:
 *
 *   1. Einstellungen
 *   2. Textaufbereitung (Normalisieren, Stemming, N-Gramme)
 *   3. Notiz-Format (Frontmatter lesen/schreiben)
 *   4. LSA (Latent Semantic Analysis, rein lokal)
 *   5. TossIndex (Index, Vektoren, Suche)
 *   6. TossView (One-Box-Oberflaeche)
 *   7. Einstellungs-Tab + Plugin
 */

const obsidian = require('obsidian');
const { Plugin, ItemView, PluginSettingTab, Setting, Notice, TFile, normalizePath, Platform, setIcon } = obsidian;

const VIEW_TYPE_TOSS = 'toss-view';
const INDEX_VERSION = 4;

/* Ab wann sich eine Dimensionsreduktion ueberhaupt lohnt. */
const LSA_MIN_NOTES = 25;
const LSA_MIN_TERMS = 40;
/* Cosinus-Rauschboden: unter diesem Wert ist LSA-Aehnlichkeit Zufall. */
const LSA_NOISE = 0.2;

/* ------------------------------------------------------------------ *
 * 1. Einstellungen
 * ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  folder: 'Toss',
  indexWholeVault: false,
  useLsa: true,
  lsaDims: 48,
  weightExact: 1.0,
  weightWord: 0.6,
  weightGram: 0.3,
  weightLsa: 0.5,
  minScore: 0.06,
  maxResults: 40,
  relatedCount: 5,
  previewChars: 250,
  layout: 'list',
  zoom: 100,
  openOnStart: false,
};

/* ------------------------------------------------------------------ *
 * 2. Textaufbereitung
 * ------------------------------------------------------------------ */

const STOPWORDS = new Set((
  'aber alle allem allen aller alles als also am an andere anderen auch auf aus bei beim bin bis bist ' +
  'da dabei dadurch dafuer damit dann daran darauf darin das dass dazu dein deine dem den denn der des ' +
  'dessen deshalb die dies diese diesem diesen dieser dieses doch dort du durch ein eine einem einen ' +
  'einer eines er es etwas euer eure fuer ganz gegen gewesen habe haben hat hatte hatten hier hin ich ' +
  'ihm ihn ihnen ihr ihre im immer in indem ins ist ja jede jeden jeder jedes jetzt kann kein keine ' +
  'koennen konnte mal man mehr mein meine mit muss musste nach nachdem neben nein nicht nichts noch nun ' +
  'nur ob obwohl oder ohne schon sehr sein seine seinem seinen selbst sich sie sind so solche soll ' +
  'sollte sondern sonst ueber um und uns unser unsere unter viel vom von vor waehrend war waren warum ' +
  'was weg weil weiter welche wenn wer werde werden wie wieder wieso will wir wird wirst wo wollen ' +
  'wurde wurden zu zum zur zwar zwischen ' +
  'a about after all also am an and any are as at be because been but by can could did do does for ' +
  'from get had has have he her here his how i if in into is it its just like make more most my no ' +
  'not of on one only or other our out over so some such than that the their them then there these ' +
  'they this to too up us use was we were what when which who will with would you your'
).split(/\s+/));

/* Kleinschreibung + Umlaute falten. "Fuer" und "für" landen so auf demselben Token. */
function fold(text) {
  return String(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function foldedWords(text) {
  return fold(text).split(/[^a-z0-9]+/).filter(Boolean);
}

/* Naives deutsches Suffix-Stripping. Kein Porter-Stemmer, aber billig und
   robust genug: "Notizen"/"Notiz" -> "notiz", "Verwaltung" -> "verwalt". */
const SUFFIXES = [
  'lichkeiten', 'lichkeit', 'igkeiten', 'igkeit', 'ischen', 'lichen', 'ungen', 'heiten', 'keiten',
  'innen', 'enden', 'erung', 'ungs', 'ende', 'erin', 'heit', 'keit', 'lich', 'isch', 'ung', 'ern',
  'end', 'bar', 'en', 'er', 'es', 'em', 'et', 'st', 'e', 's', 'n',
].sort((a, b) => b.length - a.length);

function stem(word) {
  if (word.length <= 4) return word;
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      return word.slice(0, word.length - suffix.length);
    }
  }
  return word;
}

/* Zeichen-Trigramme. Fuer Deutsch der wichtigste Trick: sie verbinden
   "Notizverwaltung" mit "Notiz" und ueberstehen Tippfehler. */
function trigramsOf(word, into) {
  for (let i = 0; i + 3 <= word.length; i++) {
    const g = word.slice(i, i + 3);
    into[g] = (into[g] || 0) + 1;
  }
}

/* text -> { tf: {stamm: n}, gf: {trigramm: n} } */
function featurize(text) {
  const tf = Object.create(null);
  const gf = Object.create(null);
  for (const w of foldedWords(text)) {
    if (w.length < 2) continue;
    if (STOPWORDS.has(w)) continue;
    const s = stem(w);
    tf[s] = (tf[s] || 0) + 1;
    if (w.length >= 4) trigramsOf(w, gf);
  }
  return { tf, gf };
}

/* Zeichen-N-Gramme als Menge - fuer den Aehnlichkeitsvergleich von Tags. */
function ngramSet(s, n) {
  const padded = ' ' + s + ' ';
  const set = new Set();
  for (let i = 0; i + n <= padded.length; i++) set.add(padded.slice(i, i + n));
  return set;
}

/* Dice-Koeffizient: 1 = gleich, 0 = nichts gemeinsam. */
function similarity(a, b) {
  if (a === b) return 1;
  const A = ngramSet(a, 3), B = ngramSet(b, 3);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared++;
  return (2 * shared) / (A.size + B.size);
}

/* Ein einzelner Tag in Normalform. */
function normalizeTag(raw) {
  return String(raw).trim().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[,]/g, '').trim();
}

/*
 * Suchmuster fuer die Anzeige. Es laeuft auf dem Originaltext, muss also
 * Umlaute wieder aufnehmen: die Anfrage ist gefaltet ("fuer"), im Text steht
 * vielleicht "für". Reihenfolge der Ersetzungen ist wichtig - siehe Kommentar.
 */
function tolerantPattern(word) {
  return word
    .replace(/ae/g, '(ä|ae)')
    .replace(/oe/g, '(ö|oe)')   // "(ä|ae)" enthaelt kein "oe"
    .replace(/ue/g, '(ü|ue)')   // ... und keines der beiden ein "ue"
    .replace(/ss/g, '(ß|ss)');
}

/* rawWords sind bereits gefaltet, enthalten also nur a-z0-9. */
function queryRegex(rawWords) {
  if (!rawWords || !rawWords.length) return null;
  try {
    return new RegExp('(' + rawWords.map(tolerantPattern).join('|') + ')', 'gi');
  } catch (e) {
    return null;
  }
}

/* Textausschnitt um die erste Fundstelle statt stumpf des Anfangs. */
function snippet(text, re, max) {
  if (!text) return '';
  const head = () => (text.length > max ? text.slice(0, max).trimEnd() + ' …' : text);
  if (!re) return head();
  re.lastIndex = 0;
  const hit = re.exec(text);
  if (!hit) return head();

  let start = Math.max(0, hit.index - 50);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space - start < 25) start = space + 1;
  }
  const end = Math.min(text.length, start + max);
  let out = text.slice(start, end).trim();
  if (start > 0) out = '… ' + out;
  if (end < text.length) out += ' …';
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function debounce(fn, wait) {
  let timer = null;
  const wrapped = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, wait);
  };
  wrapped.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return wrapped;
}

/* ------------------------------------------------------------------ *
 * 3. Notiz-Format
 *
 * Eine Notiz ist eine ganz normale .md-Datei. Der Dateiname ist immer ein
 * Zeitstempel (stabil, nie umbenannt), Titel und Tags stehen optional im
 * Frontmatter. Ohne Toss bleibt der Vault damit vollstaendig lesbar.
 * ------------------------------------------------------------------ */

const MANAGED_KEYS = new Set(['title', 'created', 'tags', 'tag']);

function parseNote(content) {
  // extra: alle Frontmatter-Zeilen, die Toss nicht selbst verwaltet. Sie werden
  // beim Speichern unveraendert zurueckgeschrieben - sonst wuerde das Bearbeiten
  // einer fremden Notiz deren aliases, cssclasses, Dataview-Felder ... loeschen.
  const meta = { title: '', tags: [], created: '', extra: [] };
  let body = content;

  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) {
      const raw = content.slice(content.indexOf('\n') + 1, end);
      body = content.slice(end + 4).replace(/^\r?\n/, '');
      let mode = 'foreign';   // in welchem Schluessel stehen wir gerade?
      let listKey = null;
      for (const line of raw.split(/\r?\n/)) {
        const item = line.match(/^\s*-\s+(.*)$/);
        if (item) {
          if (mode === 'managed') {
            if (listKey) { const v = unquote(item[1]); if (v) meta[listKey].push(v); }
          } else if (line.trim()) meta.extra.push(line);
          continue;
        }
        const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        if (!kv) {
          if (mode === 'foreign' && line.trim()) meta.extra.push(line);
          continue;
        }
        const key = kv[1].toLowerCase();
        const value = kv[2].trim();
        listKey = null;
        if (!MANAGED_KEYS.has(key)) { mode = 'foreign'; meta.extra.push(line); continue; }
        mode = 'managed';
        if (key === 'title') meta.title = unquote(value);
        else if (key === 'created') meta.created = unquote(value);
        else {
          if (!value) { listKey = 'tags'; meta.tags = []; }
          else if (value.startsWith('[')) {
            meta.tags = value.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
          } else {
            meta.tags = value.split(/[,\s]+/).map(unquote).filter(Boolean);
          }
        }
      }
    }
  }

  meta.tags = meta.tags.map((t) => t.replace(/^#/, '')).filter(Boolean);
  return { meta, body };
}

function unquote(s) {
  const t = String(s).trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return t;
}

function yamlString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function buildNote({ created, title, tags, body, extra }) {
  const lines = ['---'];
  if (created) lines.push('created: ' + created);
  if (title) lines.push('title: ' + yamlString(title));
  if (tags && tags.length) lines.push('tags: [' + tags.map(yamlString).join(', ') + ']');
  if (extra && extra.length) lines.push(...extra);   // fremde Felder bleiben erhalten
  lines.push('---', '');
  return lines.join('\n') + String(body).trim() + '\n';
}

/* Titel: Frontmatter, sonst erste Zeile, sonst Zeitstempel. */
function deriveTitle(meta, body) {
  if (meta.title) return meta.title;
  const first = body.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const clean = first.replace(/^#+\s*/, '').replace(/^[->*\s]+/, '').trim();
  if (clean) {
    if (clean.length <= 80) return clean;
    // Auf Wortgrenze kuerzen - sonst endet der Titel mitten im Wort und der
    // Vorschautext darunter beginnt mit dessen Rest.
    const cut = clean.lastIndexOf(' ', 80);
    return clean.slice(0, cut > 40 ? cut : 80).trim() + ' …';
  }
  return '(ohne Text)';
}

/* ------------------------------------------------------------------ *
 * 4. LSA - Latent Semantic Analysis, rein lokal
 *
 * Die Term-Dokument-Matrix wird per Orthogonal-Iteration (Block-Power-Methode)
 * auf k Dimensionen reduziert. Woerter, die in denselben Notizen vorkommen,
 * ruecken dabei zusammen - so findet die Suche auch Notizen, die kein einziges
 * Wort mit der Anfrage teilen. Keine Bibliothek, kein Netz, kein Modell.
 * ------------------------------------------------------------------ */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Spalten von Q (n x k, zeilenweise gespeichert) orthonormalisieren. */
function orthonormalize(Q, n, k) {
  for (let j = 0; j < k; j++) {
    for (let p = 0; p < j; p++) {
      let dot = 0;
      for (let i = 0; i < n; i++) dot += Q[i * k + p] * Q[i * k + j];
      if (dot === 0) continue;
      for (let i = 0; i < n; i++) Q[i * k + j] -= dot * Q[i * k + p];
    }
    let norm = 0;
    for (let i = 0; i < n; i++) norm += Q[i * k + j] * Q[i * k + j];
    norm = Math.sqrt(norm);
    if (norm < 1e-9) { // entartete Spalte neu wuerfeln
      const rnd = mulberry32(1000 + j);
      for (let i = 0; i < n; i++) Q[i * k + j] = rnd() - 0.5;
      j--;
      continue;
    }
    for (let i = 0; i < n; i++) Q[i * k + j] /= norm;
  }
}

/*
 * rows: Array von { cols: Int32Array, vals: Float32Array } (duenn besetzt, L2-normiert)
 * Liefert { k, docVectors: Float32Array(n*k), termVectors: Float32Array(m*k) }.
 */
function computeLsa(rows, termCount, dims, iterations) {
  const n = rows.length;
  const m = termCount;
  const k = Math.max(2, Math.min(dims, n - 1, m - 1));

  const Q = new Float32Array(n * k);
  const rnd = mulberry32(0x70535);
  for (let i = 0; i < Q.length; i++) Q[i] = rnd() - 0.5;
  orthonormalize(Q, n, k);

  const Z = new Float32Array(m * k);
  const Y = new Float32Array(n * k);

  const transposeMul = (src, dst) => { // dst(m x k) = A^T * src(n x k)
    dst.fill(0);
    for (let i = 0; i < n; i++) {
      const { cols, vals } = rows[i];
      const base = i * k;
      for (let c = 0; c < cols.length; c++) {
        const off = cols[c] * k;
        const v = vals[c];
        for (let j = 0; j < k; j++) dst[off + j] += v * src[base + j];
      }
    }
  };

  const mul = (src, dst) => { // dst(n x k) = A * src(m x k)
    dst.fill(0);
    for (let i = 0; i < n; i++) {
      const { cols, vals } = rows[i];
      const base = i * k;
      for (let c = 0; c < cols.length; c++) {
        const off = cols[c] * k;
        const v = vals[c];
        for (let j = 0; j < k; j++) dst[base + j] += v * src[off + j];
      }
    }
  };

  for (let it = 0; it < iterations; it++) {
    transposeMul(Q, Z);
    mul(Z, Y);
    Q.set(Y);
    orthonormalize(Q, n, k);
  }

  // Term-Konzept-Matrix und daraus die Dokumentkoordinaten. Anfragen werden
  // spaeter genauso eingebettet ("fold-in"), damit alles vergleichbar bleibt.
  transposeMul(Q, Z);
  mul(Z, Y);
  normalizeRows(Y, n, k);
  return { k, docVectors: Y, termVectors: Z };
}

function lsaFloor(cos) {
  if (cos <= LSA_NOISE) return 0;
  return (cos - LSA_NOISE) / (1 - LSA_NOISE);
}

function normalizeRows(M, n, k) {
  for (let i = 0; i < n; i++) {
    let norm = 0;
    for (let j = 0; j < k; j++) norm += M[i * k + j] * M[i * k + j];
    norm = Math.sqrt(norm);
    if (norm < 1e-9) continue;
    for (let j = 0; j < k; j++) M[i * k + j] /= norm;
  }
}

/* ------------------------------------------------------------------ *
 * 5. TossIndex - Index, Vektoren, Suche
 * ------------------------------------------------------------------ */

class TossIndex {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.docs = new Map();       // pfad -> dokument
    this.list = [];              // stabile Reihenfolge fuer die Vektor-Matrizen
    this.wordIdf = new Map();
    this.gramIdf = new Map();
    this.wordPostings = new Map();
    this.gramPostings = new Map();
    this.lsa = null;
    this.lsaTermIndex = null;
    this.tagCounts = new Map();
    this.status = 'leer';
    this.building = false;
    this.listeners = new Set();
    this.saveSoon = debounce(() => this.saveCache(), 4000);
    this.lsaSoon = debounce(() => this.buildLsa(), 2500);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  notify() { for (const fn of this.listeners) { try { fn(); } catch (e) { console.error('[Toss]', e); } } }

  get settings() { return this.plugin.settings; }
  get cachePath() { return normalizePath(this.plugin.manifest.dir + '/index.json'); }

  /* Liegt die Notiz im Toss-Ordner? Unabhaengig vom Suchbereich. */
  isOwn(file) {
    const folder = normalizePath(this.settings.folder || 'Toss');
    const path = typeof file === 'string' ? file : file.path;
    return path.startsWith(folder + '/');
  }

  inScope(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return false;
    if (this.settings.indexWholeVault) return true;
    const folder = normalizePath(this.settings.folder);
    return file.path === folder + '.md' || file.path.startsWith(folder + '/');
  }

  /* --- Aufbau ---------------------------------------------------- */

  async initialize() {
    this.building = true;
    this.status = 'lade Cache …';
    this.notify();
    await this.loadCache();
    await this.scan();
    this.recompute();
    this.building = false;
    this.notify();
    this.saveSoon();
    if (this.settings.useLsa) this.lsaSoon();
  }

  async loadCache() {
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.cachePath))) return;
      const data = JSON.parse(await adapter.read(this.cachePath));
      if (!data || data.version !== INDEX_VERSION) return;
      for (const doc of data.docs) this.docs.set(doc.path, doc);
    } catch (e) {
      console.warn('[Toss] Index-Cache nicht lesbar, wird neu gebaut.', e);
      this.docs.clear();
    }
  }

  async saveCache() {
    try {
      const docs = this.list.map((d) => ({
        path: d.path, mtime: d.mtime, created: d.created, title: d.title,
        derived: d.derived, tags: d.tags, text: d.text, norm: d.norm, tf: d.tf, gf: d.gf,
      }));
      await this.app.vault.adapter.write(this.cachePath, JSON.stringify({ version: INDEX_VERSION, docs }));
    } catch (e) {
      console.warn('[Toss] Index-Cache nicht schreibbar.', e);
    }
  }

  /* Alle Dateien im Scope durchgehen; unveraenderte kommen aus dem Cache. */
  async scan() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => this.inScope(f));
    const seen = new Set();
    let read = 0;

    for (const file of files) {
      seen.add(file.path);
      const cached = this.docs.get(file.path);
      if (cached && cached.mtime === file.stat.mtime && cached.tf) continue;
      await this.readFile(file);
      if (++read % 20 === 0) {
        this.status = `lese ${read}/${files.length} …`;
        this.notify();
        await new Promise((r) => setTimeout(r, 0)); // UI atmen lassen
      }
    }

    for (const path of [...this.docs.keys()]) {
      if (!seen.has(path)) this.docs.delete(path);
    }
  }

  async readFile(file) {
    const content = await this.app.vault.cachedRead(file);
    const { meta, body } = parseNote(content);
    const title = deriveTitle(meta, body);
    const tags = meta.tags;
    const searchable = [title, tags.join(' '), body].join('\n');
    const { tf, gf } = featurize(searchable);

    this.docs.set(file.path, {
      path: file.path,
      mtime: file.stat.mtime,
      created: meta.created ? Date.parse(meta.created) || file.stat.ctime : file.stat.ctime,
      title,
      // Titel aus der ersten Zeile abgeleitet? Dann im Vorschautext nicht wiederholen.
      derived: !meta.title,
      tags,
      // Originaltext fuer die Anzeige (Fundstellen brauchen echte Positionen),
      // gefaltete Fassung fuer den Abgleich.
      text: body.replace(/\s+/g, ' ').trim().slice(0, 4000),
      norm: fold(searchable).replace(/\s+/g, ' '),
      tf, gf,
    });
  }

  /* IDF, gewichtete Vektoren und invertierte Indizes neu berechnen. */
  recompute() {
    this.list = [...this.docs.values()].sort((a, b) => b.created - a.created);
    const n = this.list.length;
    this.wordIdf = new Map();
    this.gramIdf = new Map();
    this.wordPostings = new Map();
    this.gramPostings = new Map();
    if (!n) { this.status = 'keine Notizen'; this.lsa = null; return; }

    const wordDf = new Map();
    const gramDf = new Map();
    for (const doc of this.list) {
      for (const t in doc.tf) wordDf.set(t, (wordDf.get(t) || 0) + 1);
      for (const g in doc.gf) gramDf.set(g, (gramDf.get(g) || 0) + 1);
    }
    for (const [t, df] of wordDf) this.wordIdf.set(t, Math.log(1 + n / df));
    for (const [g, df] of gramDf) this.gramIdf.set(g, Math.log(1 + n / df));
    this.wordDf = wordDf;

    this.list.forEach((doc, i) => {
      doc.index = i;
      doc.wordVec = weighted(doc.tf, this.wordIdf);
      doc.gramVec = weighted(doc.gf, this.gramIdf);
      addPostings(this.wordPostings, doc.wordVec, i);
      addPostings(this.gramPostings, doc.gramVec, i);
    });

    this.tagCounts = new Map();
    for (const doc of this.list) {
      for (const tag of doc.tags) this.tagCounts.set(tag, (this.tagCounts.get(tag) || 0) + 1);
    }

    this.status = `${n} ${n === 1 ? 'Notiz' : 'Notizen'}`;
  }

  /*
   * Vorschlaege fuer die Tag-Eingabe. Bewusst grosszuegig beim Finden
   * bestehender Tags: je leichter ein vorhandener Tag zu treffen ist, desto
   * seltener entsteht ein fast gleichbedeutender neuer.
   */
  tagSuggestions(query, exclude, limit) {
    const q = fold(normalizeTag(query));
    const out = [];
    for (const [tag, count] of this.tagCounts || []) {
      if (exclude.includes(tag)) continue;
      const f = fold(tag);
      let score;
      if (!q) score = 0.1;                          // ohne Eingabe: die haeufigsten zuerst
      else if (f === q) score = 5;
      else if (f.startsWith(q)) score = 4;
      else if (f.includes(q)) score = 3;
      else {
        const sim = similarity(f, q);
        score = sim >= 0.34 ? 1 + sim : 0;          // Tippfehler und Varianten
      }
      if (!score) continue;
      out.push({ tag, count, score });
    }
    out.sort((a, b) => b.score - a.score || b.count - a.count || a.tag.localeCompare(b.tag));
    return out.slice(0, limit || 6);
  }

  /* Aehnlichster bestehender Tag - warnt vor Fast-Doppelungen. */
  closestTag(query) {
    const q = fold(normalizeTag(query));
    let best = null, bestSim = 0;
    for (const tag of (this.tagCounts || new Map()).keys()) {
      const sim = similarity(fold(tag), q);
      if (sim > bestSim) { bestSim = sim; best = tag; }
    }
    return bestSim >= 0.5 ? { tag: best, sim: bestSim } : null;
  }

  /* --- LSA -------------------------------------------------------- */

  buildLsa() {
    if (!this.settings.useLsa) { this.lsa = null; this.notify(); return; }
    const n = this.list.length;
    // Unterhalb dieser Groesse ist eine Dimensionsreduktion reines Rauschen:
    // sie "findet" dann Zusammenhaenge, die es nicht gibt.
    if (n < LSA_MIN_NOTES) { this.lsa = null; this.notify(); return; }

    // Wortschatz eingrenzen: Einmalwoerter tragen nichts bei, allgegenwaertige
    // Woerter verwaschen die Konzepte.
    const vocab = [];
    const maxDf = Math.max(2, Math.floor(n * 0.5));
    for (const [term, df] of this.wordDf) if (df >= 2 && df <= maxDf) vocab.push(term);
    if (vocab.length < LSA_MIN_TERMS) { this.lsa = null; this.notify(); return; }

    const termIndex = new Map();
    vocab.forEach((t, i) => termIndex.set(t, i));

    /*
     * Die Zeilennummer haengt am Dokument, nicht an der Listenposition: sobald
     * eine Notiz dazukommt oder sich aendert, sortiert sich die Liste neu.
     * Positionsbasierte Vektoren waeren dann stillschweigend falsch zugeordnet.
     */
    const rows = this.list.map((doc, i) => {
      doc.lsaRow = i;
      const cols = [];
      const vals = [];
      for (const t in doc.wordVec) {
        const idx = termIndex.get(t);
        if (idx !== undefined) { cols.push(idx); vals.push(doc.wordVec[t]); }
      }
      return { cols: Int32Array.from(cols), vals: Float32Array.from(vals) };
    });

    const started = performance.now();
    try {
      // k muss deutlich unter dem Rang liegen, sonst wird nichts verdichtet.
      const dims = Math.min(this.settings.lsaDims, Math.floor(n / 4), Math.floor(vocab.length / 8));
      if (dims < 4) { this.lsa = null; this.notify(); return; }
      const result = computeLsa(rows, vocab.length, dims, 4);
      this.lsa = result;
      this.lsaTermIndex = termIndex;
      console.log(`[Toss] LSA: ${result.k} Dimensionen, ${n} Notizen, ${vocab.length} Terme, ${Math.round(performance.now() - started)} ms`);
    } catch (e) {
      console.error('[Toss] LSA fehlgeschlagen', e);
      this.lsa = null;
    }
    this.notify();
  }

  lsaQueryVector(wordVec) {
    if (!this.lsa || !this.lsaTermIndex) return null;
    const { k, termVectors } = this.lsa;
    const out = new Float32Array(k);
    let any = false;
    for (const t in wordVec) {
      const idx = this.lsaTermIndex.get(t);
      if (idx === undefined) continue;
      any = true;
      const off = idx * k;
      const w = wordVec[t];
      for (let j = 0; j < k; j++) out[j] += w * termVectors[off + j];
    }
    if (!any) return null;
    let norm = 0;
    for (let j = 0; j < k; j++) norm += out[j] * out[j];
    norm = Math.sqrt(norm);
    if (norm < 1e-9) return null;
    for (let j = 0; j < k; j++) out[j] /= norm;
    return out;
  }

  /* --- Suche ------------------------------------------------------ */

  search(query) {
    const n = this.list.length;
    if (!n) return { hits: [], similar: [] };
    const s = this.settings;

    const raw = fold(query).replace(/\s+/g, ' ').trim();
    let rawWords = raw.split(' ').filter((w) => w.length >= 2 && !STOPWORDS.has(w));
    if (!rawWords.length) rawWords = raw.split(' ').filter((w) => w.length >= 2);
    // Wortanfang statt beliebigem Teilstring: sonst matcht "ohne" in "Bohnen".
    // Das Wortende bleibt offen, damit "tomate" auch "Tomaten" findet.
    const rawRes = rawWords.map((w) => new RegExp('(^|[^a-z0-9])' + escapeRegExp(w)));
    const { tf, gf } = featurize(query);
    const wordVec = weighted(tf, this.wordIdf);
    const gramVec = weighted(gf, this.gramIdf);

    const word = new Float64Array(n);
    const gram = new Float64Array(n);
    accumulate(this.wordPostings, wordVec, word);
    accumulate(this.gramPostings, gramVec, gram);

    const qLsa = this.lsaQueryVector(wordVec);
    const now = Date.now();
    const results = [];

    for (let i = 0; i < n; i++) {
      const doc = this.list[i];
      let exact = 0;
      if (rawWords.length) {
        let found = 0;
        for (const re of rawRes) if (re.test(doc.norm)) found++;
        exact = found / rawWords.length;
        if (exact === 1 && rawWords.length > 1 && doc.norm.includes(raw)) exact = 1.25;
      }

      let lsa = 0;
      if (qLsa && doc.lsaRow !== undefined) {
        const { k, docVectors } = this.lsa;
        const off = doc.lsaRow * k;
        for (let j = 0; j < k; j++) lsa += qLsa[j] * docVectors[off + j];
        lsa = lsaFloor(lsa);
      }

      let score = s.weightExact * exact + s.weightWord * word[i] + s.weightGram * gram[i] + s.weightLsa * lsa;
      if (!(score > 0)) continue;   // fasst auch NaN, statt es stumm zu schlucken

      for (const tag of doc.tags) if (rawWords.includes(fold(tag))) score += 0.25;
      const ageDays = (now - doc.created) / 86400000;
      score += 0.04 / (1 + ageDays / 30); // frische Notizen leicht bevorzugen

      results.push({ doc, score, exact, word: word[i], gram: gram[i], lsa });
    }

    results.sort((a, b) => b.score - a.score);
    const hits = [];
    const similar = [];
    for (const r of results) {
      if (r.exact >= 0.5) hits.push(r);
      else if (r.score >= s.minScore) similar.push(r);
      if (hits.length + similar.length >= s.maxResults) break;
    }
    return { hits, similar };
  }

  /* Aehnliche Notizen zu einer bestehenden Notiz - derselbe Code, nur mit
     dem Notiz-Vektor statt dem Anfrage-Vektor. */
  related(path, limit) {
    const doc = this.docs.get(path);
    const n = this.list.length;
    if (!doc || doc.index === undefined || n < 2) return [];

    const word = new Float64Array(n);
    accumulate(this.wordPostings, doc.wordVec, word);
    const gram = new Float64Array(n);
    accumulate(this.gramPostings, doc.gramVec, gram);

    const results = [];
    for (let i = 0; i < n; i++) {
      if (i === doc.index) continue;
      let lsa = 0;
      const other = this.list[i];
      if (this.lsa && doc.lsaRow !== undefined && other.lsaRow !== undefined) {
        const { k, docVectors } = this.lsa;
        const a = doc.lsaRow * k;
        const b = other.lsaRow * k;
        for (let j = 0; j < k; j++) lsa += docVectors[a + j] * docVectors[b + j];
        lsa = lsaFloor(lsa);
      }
      let score = 0.6 * word[i] + 0.2 * gram[i] + 0.6 * lsa;
      const shared = other.tags.filter((t) => doc.tags.includes(t)).length;
      score += shared * 0.15;
      if (!(score >= 0.05)) continue;
      results.push({ doc: other, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit || this.settings.relatedCount);
  }

  /* --- Aenderungen ------------------------------------------------ */

  async updateFile(file) {
    if (!this.inScope(file)) { if (this.docs.delete(file.path)) this.afterChange(); return; }
    await this.readFile(file);
    this.afterChange();
  }

  removeFile(path) {
    if (this.docs.delete(path)) this.afterChange();
  }

  afterChange() {
    this.recompute();
    this.notify();
    this.saveSoon();
    if (this.settings.useLsa) this.lsaSoon();
  }

  async rebuild() {
    this.docs.clear();
    this.lsa = null;
    await this.initialize();
  }
}

function weighted(freqs, idf) {
  const vec = Object.create(null);
  let norm = 0;
  for (const t in freqs) {
    const w = (1 + Math.log(freqs[t])) * (idf.get(t) || Math.log(2));
    vec[t] = w;
    norm += w * w;
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-9) return vec;
  for (const t in vec) vec[t] /= norm;
  return vec;
}

function addPostings(postings, vec, docIndex) {
  for (const t in vec) {
    let list = postings.get(t);
    if (!list) { list = []; postings.set(t, list); }
    list.push(docIndex, vec[t]);
  }
}

/* Cosinus ueber den invertierten Index: nur Notizen anfassen, die mindestens
   einen Term mit der Anfrage teilen. */
function accumulate(postings, vec, out) {
  for (const t in vec) {
    const list = postings.get(t);
    if (!list) continue;
    const qw = vec[t];
    for (let i = 0; i < list.length; i += 2) out[list[i]] += qw * list[i + 1];
  }
}

/* ------------------------------------------------------------------ *
 * 6. TossView - die One Box
 *
 * Ein einziges Eingabefeld unten im Daumenbereich: tippen sucht, "Toss" legt
 * an. Kein Moduswechsel. Darueber die Ergebnisse bzw. der Feed.
 * ------------------------------------------------------------------ */

/* setIcon laesst das Element leer, wenn Lucide den Namen nicht kennt. */
function setIconSafe(el, names, fallbackText) {
  for (const name of [].concat(names)) {
    setIcon(el, name);
    if (el.firstChild) return;
  }
  if (fallbackText) el.setText(fallbackText);
}

function relTime(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? 'gestern' : `vor ${days} Tagen`;
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function highlightInto(el, text, re) {
  if (!re) { el.setText(text); return; }
  re.lastIndex = 0;
  let last = 0;
  for (const match of text.matchAll(re)) {
    if (match.index > last) el.appendText(text.slice(last, match.index));
    el.createEl('mark', { text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < text.length) el.appendText(text.slice(last));
}

/*
 * Tag-Eingabe mit Chips und Vorschlagsliste.
 *
 * Leitgedanke: bestehende Tags sollen leichter zu treffen sein als neue zu
 * erfinden. Deshalb ist immer ein vorhandener Tag vorausgewaehlt, wenn es einen
 * passenden gibt - der Eintrag "neu anlegen" steht ganz unten und muss bewusst
 * gewaehlt werden. Fast gleichbedeutende Neuanlagen werden angemerkt.
 */
class TagEditor {
  constructor(parent, plugin, options = {}) {
    this.plugin = plugin;
    this.onChange = options.onChange || (() => {});
    this.tags = [];
    this.rows = [];
    this.active = 0;
    this.armed = false;
    this.open = false;

    this.el = parent.createDiv('toss-tagedit');
    this.box = this.el.createDiv('toss-tagedit-box');
    this.input = this.box.createEl('input', {
      cls: 'toss-tagedit-input',
      attr: { type: 'text', placeholder: options.placeholder || 'Tag …', enterkeyhint: 'done', autocapitalize: 'none', autocorrect: 'off' },
    });
    this.suggestEl = this.el.createDiv('toss-suggest');
    this.suggestEl.toggleClass('is-hidden', true);

    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('focus', () => { this.open = true; this.refresh(); });
    this.input.addEventListener('blur', () => { window.setTimeout(() => { this.open = false; this.renderSuggestions(); }, 120); });
    this.input.addEventListener('keydown', (evt) => this.onKey(evt));
    this.box.addEventListener('click', (evt) => { if (evt.target === this.box) this.input.focus(); });

    this.renderChips();
  }

  getTags() { return [...this.tags]; }

  setTags(tags) {
    this.tags = (tags || []).map(normalizeTag).filter(Boolean);
    this.renderChips();
  }

  focus() { this.input.focus(); }

  add(raw) {
    const tag = normalizeTag(raw);
    this.input.value = '';
    if (!tag || this.tags.includes(tag)) { this.refresh(); return; }
    this.tags.push(tag);
    this.renderChips();
    this.input.focus();
    this.onChange(this.getTags());
    this.refresh();
  }

  remove(tag) {
    this.tags = this.tags.filter((t) => t !== tag);
    this.renderChips();
    this.onChange(this.getTags());
    this.refresh();
  }

  renderChips() {
    this.box.empty();
    for (const tag of this.tags) {
      const chip = this.box.createDiv('toss-chip-tag');
      chip.createSpan({ text: '#' + tag });
      const x = chip.createEl('button', {
        cls: 'toss-chip-x',
        // Ebenfalls aus der Tab-Reihenfolge: im Feld entfernt Backspace den letzten Chip.
        attr: { 'aria-label': `#${tag} entfernen`, title: 'Entfernen', tabindex: '-1' },
      });
      setIcon(x, 'x');
      x.addEventListener('mousedown', (evt) => evt.preventDefault());
      x.addEventListener('click', (evt) => { evt.preventDefault(); evt.stopPropagation(); this.remove(tag); });
    }
    this.box.appendChild(this.input);
  }

  refresh() {
    const typed = normalizeTag(this.input.value);
    this.rows = [];
    this.armed = false;

    for (const s of this.plugin.index.tagSuggestions(this.input.value, [], 8)) {
      const mine = this.tags.includes(s.tag);
      // Schon vergebene Treffer bleiben sichtbar - sonst sieht es aus, als
      // gaebe es den passenden Tag nicht, und man legt einen zweiten an.
      if (mine && !typed) continue;
      this.rows.push({ kind: mine ? 'have' : 'tag', tag: s.tag, count: s.count });
      if (this.rows.length >= 6) break;
    }

    const known = this.plugin.index.tagCounts.has(typed);
    let close = null;
    if (typed && !known && !this.tags.includes(typed)) {
      const nearest = this.plugin.index.closestTag(typed);
      close = nearest && nearest.tag !== typed ? nearest.tag : null;
      this.rows.push({ kind: 'new', tag: typed, close });
    }

    // Ein bestehender Tag ist immer vorausgewaehlt. Gibt es keinen, aber einen
    // sehr aehnlichen, ist gar nichts vorausgewaehlt: die Neuanlage braucht
    // dann einen zweiten Tastendruck.
    const firstFree = this.rows.findIndex((r) => r.kind === 'tag');
    if (firstFree >= 0) this.active = firstFree;
    else if (close) this.active = -1;
    else this.active = this.rows.length - 1;

    this.renderSuggestions();
  }

  renderSuggestions() {
    this.suggestEl.empty();
    const show = this.open && this.rows.length > 0;
    this.suggestEl.toggleClass('is-hidden', !show);
    if (!show) return;

    this.rows.forEach((row, i) => {
      const el = this.suggestEl.createDiv('toss-suggest-row');
      el.toggleClass('is-active', i === this.active);
      const icon = el.createSpan({ cls: 'toss-suggest-icon' });
      if (row.kind === 'new') {
        el.addClass('toss-suggest-new');
        setIcon(icon, 'plus');
        el.createSpan({ cls: 'toss-suggest-label', text: '#' + row.tag });
        const note = i === this.active && this.armed ? 'nochmal ⏎ zum Anlegen'
          : row.close ? `neu — ähnlich zu #${row.close}` : 'neu anlegen';
        el.createSpan({ cls: 'toss-suggest-note', text: note });
      } else if (row.kind === 'have') {
        el.addClass('toss-suggest-have');
        setIcon(icon, 'check');
        el.createSpan({ cls: 'toss-suggest-label', text: row.tag });
        el.createSpan({ cls: 'toss-suggest-note', text: 'schon vergeben' });
      } else {
        setIcon(icon, 'hash');
        el.createSpan({ cls: 'toss-suggest-label', text: row.tag });
        el.createSpan({ cls: 'toss-suggest-note', text: `${row.count}×` });
      }
      el.addEventListener('mousedown', (evt) => evt.preventDefault());
      el.addEventListener('click', (evt) => { evt.preventDefault(); evt.stopPropagation(); this.accept(i); });
    });
  }

  accept(i) {
    const row = this.rows[i];
    if (!row) { this.add(this.input.value); return; }
    if (row.kind === 'have') { this.input.value = ''; this.input.focus(); this.refresh(); return; }
    this.add(row.tag);
  }

  onKey(evt) {
    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      if (!this.rows.length) return;
      evt.preventDefault();
      const step = evt.key === 'ArrowDown' ? 1 : -1;
      let next = this.active;
      for (let n = 0; n < this.rows.length; n++) {
        next = (next + step + this.rows.length) % this.rows.length;
        if (this.rows[next].kind !== 'have') break;   // Vergebenes ist nicht waehlbar
      }
      this.active = next;
      this.armed = true;
      this.renderSuggestions();
      return;
    }
    if (evt.key === 'Enter' || evt.key === ',' || (evt.key === 'Tab' && this.input.value)) {
      evt.preventDefault();
      evt.stopPropagation();
      if (!this.rows.length) { this.add(this.input.value); return; }
      if (this.active < 0) {
        // Nichts vorausgewaehlt heisst: es gibt einen sehr aehnlichen Tag.
        // Erst dieser Tastendruck waehlt die Neuanlage an, der naechste legt an.
        this.active = this.rows.length - 1;
        this.armed = true;
        this.renderSuggestions();
        return;
      }
      this.accept(this.active);
      return;
    }
    if (evt.key === 'Backspace' && !this.input.value && this.tags.length) {
      evt.preventDefault();
      this.remove(this.tags[this.tags.length - 1]);
      return;
    }
    if (evt.key === 'Escape' && this.open && this.rows.length) {
      // Nur die Vorschlagsliste schliessen - das Escape der Karte kommt danach.
      evt.preventDefault();
      evt.stopPropagation();
      this.open = false;
      this.renderSuggestions();
    }
  }
}

const LAYOUTS = {
  list: { label: 'Eine Spalte', icon: 'list' },
  two: { label: 'Zwei Spalten', icon: ['columns-2', 'columns'] },
  auto: { label: 'So viele wie passen', icon: ['layout-grid', 'grid'] },
};

class TossView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.index = plugin.index;
    this.expandedPath = null;
    this.dirty = false;
    this.feedLimit = 40;
    this.searchSoon = debounce(() => this.render(), 130);
  }

  getViewType() { return VIEW_TYPE_TOSS; }
  getDisplayText() { return 'Toss'; }
  getIcon() { return 'zap'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('toss-root');

    const header = root.createDiv('toss-header');
    header.createSpan({ cls: 'toss-brand', text: 'Toss' });
    this.statusEl = header.createSpan({ cls: 'toss-status' });

    this.layoutBtn = header.createEl('button', { cls: 'toss-head-btn' });
    this.layoutBtn.onclick = () => this.cycleLayout();

    /* Zoom wirkt auf alles unter der Kopfzeile. */
    const zoom = header.createDiv('toss-zoom');
    const zoomOut = zoom.createEl('button', { cls: 'toss-head-btn', attr: { 'aria-label': 'Kleiner', title: 'Kleiner' } });
    setIconSafe(zoomOut, 'minus', '−');
    this.zoomValueEl = zoom.createEl('button', { cls: 'toss-zoom-value', attr: { title: 'Auf 100 % zurücksetzen' } });
    const zoomIn = zoom.createEl('button', { cls: 'toss-head-btn', attr: { 'aria-label': 'Größer', title: 'Größer' } });
    setIconSafe(zoomIn, 'plus', '+');
    zoomOut.onclick = () => this.setZoom(this.plugin.settings.zoom - 10);
    zoomIn.onclick = () => this.setZoom(this.plugin.settings.zoom + 10);
    this.zoomValueEl.onclick = () => this.setZoom(100);

    // Versionsnummer: daran sieht man auf einen Blick, ob der Reload durch ist.
    header.createSpan({ cls: 'toss-version', text: 'v' + this.plugin.manifest.version });

    this.zoomEl = root.createDiv('toss-zoomable');

    /* Die One Box sitzt oben: erst schreiben, darunter waechst das Ergebnis. */
    const compose = this.zoomEl.createDiv('toss-compose');
    const row = compose.createDiv('toss-inputrow');
    /* Titel, Text und Tags stehen in einer Spalte - dadurch sind alle drei
       genau so breit wie das Textfeld, der Toss-Knopf steht daneben. */
    const fields = row.createDiv('toss-compose-fields');

    this.titleEl = fields.createEl('input', {
      cls: 'toss-compose-title',
      attr: { type: 'text', placeholder: 'Titel (optional)' },
    });

    const wrap = fields.createDiv('toss-input-wrap');
    this.inputEl = wrap.createEl('textarea', {
      cls: 'toss-input',
      attr: { rows: '3', placeholder: 'Reinwerfen oder suchen …', enterkeyhint: 'enter' },
    });
    this.clearEl = wrap.createEl('button', {
      cls: 'toss-input-clear',
      // tabindex -1: Tab soll vom Textfeld direkt auf "Toss" springen.
      attr: { 'aria-label': 'Eingabe löschen', title: 'Eingabe löschen', tabindex: '-1' },
    });
    setIcon(this.clearEl, 'x');
    this.sendEl = row.createEl('button', {
      cls: 'toss-send',
      text: 'Toss',
      attr: { title: Platform.isMobile ? 'Notiz anlegen' : 'Notiz anlegen (Cmd/Strg + ⏎)' },
    });

    this.tagEditor = new TagEditor(fields, this.plugin, { placeholder: '＃ Tags (optional)' });

    this.scrollEl = this.zoomEl.createDiv('toss-scroll');
    this.listEl = this.scrollEl.createDiv('toss-list');

    this.clearEl.onclick = () => { this.clearCompose(); this.inputEl.focus(); };
    this.sendEl.onclick = () => this.toss();

    this.inputEl.addEventListener('input', () => { this.autoGrow(); this.syncInput(); this.searchSoon(); });
    this.inputEl.addEventListener('focus', () => this.syncInput());
    this.inputEl.addEventListener('blur', () => setTimeout(() => this.syncInput(), 150));
    this.inputEl.addEventListener('keydown', (evt) => {
      // Cmd+Enter schluckt Obsidian, bevor es hier ankommt - dafuer gibt es
      // unten das Kommando "Notiz einwerfen" mit Mod+Enter.
      if (evt.key === 'Enter' && evt.ctrlKey) { evt.preventDefault(); this.toss(); }
      if (evt.key === 'Escape') { this.clearCompose(); }
    });

    /* Zieht der Nutzer das Feld groesser, hat das Vorrang vor autoGrow. */
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => {
        if (this.autoGrowing) { this.autoGrowing = false; return; }
        this.userResized = true;
      });
      this.resizeObs.observe(this.inputEl);
      this.register(() => this.resizeObs.disconnect());
    }

    this.register(this.index.onChange(() => this.onIndexChanged()));
    this.applyZoom();
    this.applyLayout();
    this.syncInput();
    this.render();
    if (!Platform.isMobile) window.setTimeout(() => this.inputEl.focus(), 50);
  }

  async onClose() {
    this.searchSoon.cancel();
    if (this.saveExpanded) await this.saveExpanded(); // nichts unter den Tisch fallen lassen
  }

  /* --- Eingabe ---------------------------------------------------- */

  /* --- Zoom und Layout ------------------------------------------- */

  async setZoom(value) {
    const zoom = Math.max(50, Math.min(200, Math.round(value / 10) * 10));
    if (zoom === this.plugin.settings.zoom) return;
    this.plugin.settings.zoom = zoom;
    await this.plugin.saveSettings();
    this.applyZoom();
  }

  applyZoom() {
    const zoom = this.plugin.settings.zoom || 100;
    this.zoomEl.style.zoom = String(zoom / 100);
    this.zoomValueEl.setText(zoom + '%');
  }

  async cycleLayout() {
    const order = ['list', 'two', 'auto'];
    const next = order[(order.indexOf(this.plugin.settings.layout) + 1) % order.length];
    this.plugin.settings.layout = next;
    await this.plugin.saveSettings();
    this.applyLayout();
  }

  applyLayout() {
    const layout = LAYOUTS[this.plugin.settings.layout] ? this.plugin.settings.layout : 'list';
    for (const key of Object.keys(LAYOUTS)) this.zoomEl.toggleClass('toss-layout-' + key, key === layout);
    setIconSafe(this.layoutBtn, LAYOUTS[layout].icon, LAYOUTS[layout].label);
    this.layoutBtn.setAttr('aria-label', 'Layout: ' + LAYOUTS[layout].label);
    this.layoutBtn.setAttr('title', 'Layout: ' + LAYOUTS[layout].label + ' — zum Wechseln tippen');
  }

  autoGrow() {
    if (this.userResized) return;   // von Hand gezogene Hoehe nicht ueberschreiben
    const el = this.inputEl;
    this.autoGrowing = true;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, window.innerHeight * 0.5) + 'px';
  }

  clearCompose() {
    this.inputEl.value = '';
    this.titleEl.value = '';
    this.tagEditor.setTags([]);
    this.autoGrow();
    this.syncInput();
    this.render();
  }

  syncInput() {
    const filled = this.inputEl.value.length > 0;
    this.clearEl.toggleClass('is-hidden', !filled);
    this.sendEl.toggleClass('is-ready', this.inputEl.value.trim().length > 0);
  }

  async toss() {
    if (this.tossing) return;   // Strg- und Cmd-Weg duerfen sich nicht ueberholen
    const body = this.inputEl.value.trim();
    if (!body) { this.inputEl.focus(); return; }
    this.tossing = true;
    const title = this.titleEl.value.trim();
    const tags = this.tagEditor.getTags();
    try {
      const file = await this.plugin.createNote({ body, title, tags });
      this.flashPath = file.path;
      this.clearCompose(); // rendert neu und laesst die frische Karte aufblitzen
      this.inputEl.focus();
    } catch (e) {
      console.error('[Toss]', e);
      new Notice('Notiz konnte nicht angelegt werden: ' + e.message);
    } finally {
      this.tossing = false;
    }
  }

  /* --- Darstellung ------------------------------------------------ */

  onIndexChanged() {
    this.statusEl.setText(this.index.status + (this.index.lsa ? ` · LSA ${this.index.lsa.k}D` : ''));
    if (this.dirty) return; // laufende Bearbeitung nicht wegrendern
    this.render();
  }

  render() {
    if (!this.listEl) return;
    this.statusEl.setText(this.index.status + (this.index.lsa ? ` · LSA ${this.index.lsa.k}D` : ''));
    const query = this.inputEl.value.trim();
    // Egal wodurch neu gerendert wird - eine offene Bearbeitung geht vorher raus.
    if (this.saveExpanded) { const flush = this.saveExpanded; this.saveExpanded = null; flush(); }
    this.listEl.empty();

    if (!this.index.list.length) {
      const empty = this.listEl.createDiv('toss-empty');
      if (this.index.building) { empty.createDiv({ text: 'Moment, Index wird gelesen …' }); return; }
      empty.createDiv({ cls: 'toss-empty-title', text: 'Noch nichts drin.' });
      empty.createDiv({ text: 'Schreib unten irgendetwas hinein und tipp auf „Toss“. Titel und Tags sind optional.' });
      return;
    }

    this.listEl.toggleClass('has-expanded', !!this.expandedPath);
    if (query.length >= 2) this.renderSearch(query);
    else this.renderFeed();

    if (this.flashPath) {
      const card = this.listEl.querySelector(`[data-path="${CSS.escape(this.flashPath)}"]`);
      if (card) { card.addClass('is-new'); window.setTimeout(() => card.removeClass('is-new'), 1200); }
      this.scrollEl.scrollTop = 0;
      this.flashPath = null;
    }
  }

  renderFeed() {
    const docs = this.index.list;
    const shown = Math.min(this.feedLimit, docs.length);
    this.section('Zuletzt', docs.length > shown ? `${shown} von ${docs.length}` : String(shown));
    for (const doc of docs.slice(0, shown)) this.renderCard(doc, null, null);
    if (docs.length > this.feedLimit) {
      const more = this.listEl.createEl('button', { cls: 'toss-more', text: `${docs.length - this.feedLimit} weitere anzeigen` });
      more.onclick = () => { this.feedLimit += 40; this.render(); };
    }
  }

  renderSearch(query) {
    const { hits, similar } = this.index.search(query);
    const words = fold(query).split(/\s+/).filter((w) => w.length >= 2);
    const re = queryRegex(words);

    if (hits.length) {
      this.section('Treffer', String(hits.length));
      for (const r of hits) this.renderCard(r.doc, r, re);
    }
    if (similar.length) {
      // Ob semantisch gesucht wird, steht in der Kopfzeile - hier zaehlt die Menge.
      this.section('Auch ähnlich', String(similar.length));
      for (const r of similar) this.renderCard(r.doc, r, re);
    }
    if (!hits.length && !similar.length) {
      const empty = this.listEl.createDiv('toss-empty');
      empty.createDiv({ cls: 'toss-empty-title', text: 'Nichts Ähnliches gefunden.' });
      empty.createDiv({ text: 'Dann ist das hier wohl neu — „Toss“ legt es an.' });
    }
  }

  section(label, note) {
    const el = this.listEl.createDiv('toss-section');
    el.createSpan({ text: label });
    if (note) el.createSpan({ cls: 'toss-section-note', text: note });
  }

  renderCard(doc, result, re) {
    const card = this.listEl.createDiv('toss-card');
    card.dataset.path = doc.path;
    if (this.expandedPath === doc.path) { this.fillExpanded(card, doc); return; }
    // Zuletzt geoeffnete Karte bleibt markiert - sonst findet man sie nach dem
    // Zuklappen zwischen vielen Treffern nicht wieder.
    card.toggleClass('is-last', this.lastOpenedPath === doc.path);

    const title = card.createDiv('toss-card-title');
    highlightInto(title, doc.title, re);

    // Ausschnitt um die erste Fundstelle, sonst der Anfang.
    let source = doc.text || '';
    if (doc.derived) {
      const lead = doc.title.replace(/\s*…$/, '');
      if (lead && source.startsWith(lead)) {
        let cut = lead.length;
        // Sicherheitshalber nochmal auf Wortgrenze zurueck.
        if (source[cut] && /\S/.test(source[cut])) {
          const back = source.lastIndexOf(' ', cut);
          if (back > 0) cut = back;
        }
        source = source.slice(cut).replace(/^[\s.,;:–—-]+/, '');
      }
    }
    const text = snippet(source, re, this.plugin.settings.previewChars);
    if (text && text !== doc.title) {
      const preview = card.createDiv('toss-card-preview');
      highlightInto(preview, text, re);
    }

    const meta = card.createDiv('toss-card-meta');
    meta.createSpan({ text: relTime(doc.created) });
    for (const tag of doc.tags) meta.createSpan({ cls: 'toss-tag', text: '#' + tag });
    if (result && result.exact < 0.5) meta.createSpan({ cls: 'toss-score', text: '≈ ' + Math.round(Math.min(1, result.score) * 100) + '%' });

    card.onclick = () => {
      this.expandedPath = doc.path;
      this.justExpanded = doc.path;
      this.lastOpenedPath = doc.path;
      this.render();
    };
  }

  async fillExpanded(card, doc) {
    card.addClass('is-expanded');
    // Ohne Fokus in der Karte kaeme kein Escape hier an - er bliebe im Suchfeld.
    // tabindex -1 macht sie fokussierbar, ohne sie in die Tab-Reihenfolge zu legen
    // und ohne auf dem Telefon die Tastatur aufzuklappen.
    card.setAttr('tabindex', '-1');
    const file = this.app.vault.getAbstractFileByPath(doc.path);
    if (!(file instanceof TFile)) { this.expandedPath = null; return; }

    const content = await this.app.vault.cachedRead(file);
    const parsed = parseNote(content);
    card.empty();

    /* Kopfzeile: Titel links, die Aktionen als Icons rechts daneben. */
    const head = card.createDiv('toss-edit-head');
    const titleInput = head.createEl('input', {
      cls: 'toss-field toss-edit-title',
      attr: { type: 'text', placeholder: 'Titel (optional)' },
    });
    titleInput.value = parsed.meta.title || '';

    const actions = head.createDiv('toss-edit-actions');
    const iconBtn = (icon, label, cls) => {
      const b = actions.createEl('button', {
        cls: 'toss-icon-btn' + (cls ? ' ' + cls : ''),
        attr: { 'aria-label': label, title: label },
      });
      setIcon(b, icon);
      return b;
    };
    const openBtn = iconBtn('external-link', 'In Obsidian öffnen');
    const closeBtn = iconBtn('x', 'Zuklappen');
    const delBtn = iconBtn('trash-2', 'Löschen', 'toss-icon-danger');

    // Kein Speichern-Knopf: gespeichert wird beim Verlassen der Karte.
    const markDirty = () => { this.dirty = true; };

    const bodyInput = card.createEl('textarea', { cls: 'toss-edit-body' });
    bodyInput.value = parsed.body.trim();

    // Gleiche Anordnung wie in der Eingabe oben: Titel, Text, Tags.
    const tagEditor = new TagEditor(card, this.plugin, {
      placeholder: '＃ Tags (optional)',
      onChange: markDirty,
    });
    tagEditor.setTags(parsed.meta.tags);
    const grow = () => { bodyInput.style.height = 'auto'; bodyInput.style.height = bodyInput.scrollHeight + 'px'; };
    window.setTimeout(grow, 0);

    bodyInput.addEventListener('input', () => { grow(); markDirty(); });
    titleInput.addEventListener('input', markDirty);

    const stop = (evt) => evt.stopPropagation();
    for (const el of [titleInput, bodyInput, tagEditor.el]) el.addEventListener('click', stop);

    /* Speichern passiert von selbst, sobald die Karte verlassen wird. */
    const save = async () => {
      if (!this.dirty) return;
      // Zustand sofort einsammeln: der Aufrufer wartet nicht immer ab, und die
      // Felder koennen im naechsten Moment schon aus dem DOM sein.
      this.dirty = false;
      // In fremden Notizen legt Toss kein created an, das vorher nicht da war -
      // sonst stuenden dort zwei Anlagedaten. Titel und Tags entstehen ohnehin
      // nur, wenn du sie selbst eintraegst.
      const created = parsed.meta.created
        || (this.index.isOwn(file) ? new Date(doc.created).toISOString() : '');
      const content = buildNote({
        created,
        title: titleInput.value.trim(),
        tags: tagEditor.getTags(),
        body: bodyInput.value,
        extra: parsed.meta.extra,
      });
      await this.app.vault.modify(file, content);
    };
    this.saveExpanded = save;

    const collapse = async () => { await save(); this.expandedPath = null; this.render(); };

    /* Escape klappt zu - die Vorschlagsliste der Tags fängt ihr Escape selbst ab. */
    card.addEventListener('keydown', (evt) => {
      if (evt.key !== 'Escape') return;
      evt.preventDefault();
      evt.stopPropagation();
      collapse();
    });

    openBtn.onclick = async (evt) => {
      stop(evt);
      await save();
      this.app.workspace.getLeaf(Platform.isMobile ? true : 'tab').openFile(file);
    };

    closeBtn.onclick = async (evt) => { stop(evt); await collapse(); };

    /*
     * Löschen fragt nach: erster Klick macht ein "?" daraus, der zweite löscht.
     * Ein Klick irgendwo anders nimmt die Frage zurück.
     */
    let armed = false;
    let onOutside = null;
    const disarm = () => {
      if (!armed) return;
      armed = false;
      if (onOutside) { document.removeEventListener('click', onOutside, true); onOutside = null; }
      delBtn.removeClass('is-armed');
      setIcon(delBtn, 'trash-2');
      delBtn.setAttr('aria-label', 'Löschen');
      delBtn.setAttr('title', 'Löschen');
    };

    delBtn.onclick = async (evt) => {
      stop(evt);
      if (!armed) {
        armed = true;
        delBtn.addClass('is-armed');
        setIconSafe(delBtn, 'help-circle', '?');
        delBtn.setAttr('aria-label', 'Wirklich löschen?');
        delBtn.setAttr('title', 'Wirklich löschen?');
        onOutside = (e) => { if (!delBtn.contains(e.target)) disarm(); };
        document.addEventListener('click', onOutside, true);
        return;
      }
      disarm();
      this.dirty = false;
      this.saveExpanded = null;
      this.expandedPath = null;
      await this.app.fileManager.trashFile(file);
    };

    /* Ähnliche Notizen - der Kern der Sache. */
    const related = this.index.related(doc.path);
    const box = card.createDiv('toss-related');
    box.createDiv({ cls: 'toss-related-head', text: related.length ? 'Ähnlich' : 'Noch nichts Ähnliches da' });
    for (const r of related) {
      const row = box.createDiv('toss-related-row');
      row.createSpan({ cls: 'toss-related-title', text: r.doc.title });
      row.createSpan({ cls: 'toss-score', text: '≈ ' + Math.round(Math.min(1, r.score) * 100) + '%' });
      row.onclick = async (evt) => {
        stop(evt);
        await save();
        this.expandedPath = r.doc.path;
        this.justExpanded = r.doc.path;
        this.lastOpenedPath = r.doc.path;
        this.render();
      };
    }

    // Nur beim frischen Aufklappen den Fokus holen, nicht bei jedem Neuaufbau.
    if (this.justExpanded === doc.path) {
      this.justExpanded = null;
      card.focus();
    }
  }

}

/* ------------------------------------------------------------------ *
 * 7. Einstellungen + Plugin
 * ------------------------------------------------------------------ */

class TossSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Ordner')
      .setDesc('Hier landen neue Notizen.')
      .addText((t) => t.setValue(this.plugin.settings.folder).onChange(async (v) => {
        this.plugin.settings.folder = v.trim().replace(/^\/+|\/+$/g, '') || 'Toss';
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Ganzen Vault durchsuchen')
      .setDesc('Aus: nur der Toss-Ordner. An: alle Markdown-Notizen des Vaults.')
      .addToggle((t) => t.setValue(this.plugin.settings.indexWholeVault).onChange(async (v) => {
        this.plugin.settings.indexWholeVault = v;
        await this.plugin.saveSettings();
        await this.plugin.index.rebuild();
      }));

    containerEl.createEl('h3', { text: 'Darstellung' });

    new Setting(containerEl)
      .setName('Layout der Ergebnisse')
      .setDesc('Auch über das Symbol in der Kopfzeile umschaltbar.')
      .addDropdown((d) => {
        for (const [key, def] of Object.entries(LAYOUTS)) d.addOption(key, def.label);
        d.setValue(this.plugin.settings.layout).onChange(async (v) => {
          this.plugin.settings.layout = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        });
      });

    new Setting(containerEl)
      .setName('Länge des Textausschnitts')
      .setDesc('Zeichen pro Karte. Der Ausschnitt beginnt bei der ersten Fundstelle.')
      .addSlider((s) => s.setLimits(80, 600, 10).setValue(this.plugin.settings.previewChars).setDynamicTooltip()
        .onChange(async (v) => {
          this.plugin.settings.previewChars = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    containerEl.createEl('h3', { text: 'Ähnlichkeit' });

    new Setting(containerEl)
      .setName('Semantische Suche (LSA)')
      .setDesc('Findet zusätzlich Notizen ohne gemeinsame Wörter — über Begriffe, die in denselben Notizen vorkommen. Rein lokal, ab ca. 12 Notizen.')
      .addToggle((t) => t.setValue(this.plugin.settings.useLsa).onChange(async (v) => {
        this.plugin.settings.useLsa = v;
        await this.plugin.saveSettings();
        if (v) this.plugin.index.buildLsa(); else { this.plugin.index.lsa = null; this.plugin.index.notify(); }
      }));

    new Setting(containerEl)
      .setName('LSA-Dimensionen')
      .setDesc('Mehr Dimensionen = feiner, aber langsamer. 32–64 ist ein guter Bereich.')
      .addSlider((s) => s.setLimits(8, 96, 8).setValue(this.plugin.settings.lsaDims).setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.lsaDims = v; await this.plugin.saveSettings(); this.plugin.index.buildLsa(); }));

    const weights = [
      ['weightExact', 'Exakte Treffer', 'Wörter, die wortwörtlich in der Notiz stehen.'],
      ['weightWord', 'Wort-Ähnlichkeit', 'TF-IDF-Cosinus über Wortstämme.'],
      ['weightGram', 'Zeichen-Ähnlichkeit', 'Trigramme — fängt Komposita und Tippfehler.'],
      ['weightLsa', 'Semantische Ähnlichkeit', 'Gewicht der LSA-Dimensionen.'],
    ];
    for (const [key, name, desc] of weights) {
      new Setting(containerEl).setName(name).setDesc(desc)
        .addSlider((s) => s.setLimits(0, 2, 0.1).setValue(this.plugin.settings[key]).setDynamicTooltip()
          .onChange(async (v) => { this.plugin.settings[key] = v; await this.plugin.saveSettings(); }));
    }

    new Setting(containerEl)
      .setName('Schwelle für „Auch ähnlich“')
      .setDesc('Höher = weniger, aber sicherere Vorschläge.')
      .addSlider((s) => s.setLimits(0.01, 0.4, 0.01).setValue(this.plugin.settings.minScore).setDynamicTooltip()
        .onChange(async (v) => { this.plugin.settings.minScore = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Index neu aufbauen')
      .setDesc('Falls etwas verrutscht ist. Der Index ist nur ein Cache — die Notizen bleiben unangetastet.')
      .addButton((b) => b.setButtonText('Neu aufbauen').onClick(async () => {
        await this.plugin.index.rebuild();
        new Notice('Toss-Index neu aufgebaut.');
      }));
  }
}

class TossPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.index = new TossIndex(this);
    this.pending = new Set();
    this.flushSoon = debounce(() => this.flushPending(), 400);

    this.registerView(VIEW_TYPE_TOSS, (leaf) => new TossView(leaf, this));
    this.addRibbonIcon('zap', 'Toss – Einfach Notizen reinwerfen', () => this.activateView());
    this.addSettingTab(new TossSettingTab(this.app, this));

    this.addCommand({ id: 'open', name: 'Toss öffnen', callback: () => this.activateView() });
    /*
     * Mod+Enter ueber Obsidians Hotkey-System: ein eigener keydown-Handler
     * bekommt Cmd+Enter auf dem Mac nicht zu sehen. Greift nur, solange das
     * Eingabefeld den Fokus hat, und laesst sich in den Hotkey-Einstellungen
     * umbelegen.
     */
    this.addCommand({
      id: 'toss-note',
      name: 'Notiz einwerfen',
      hotkeys: [{ modifiers: ['Mod'], key: 'Enter' }],
      checkCallback: (checking) => {
        const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_TOSS)
          .find((l) => l.view instanceof TossView && l.view.inputEl
            && document.activeElement === l.view.inputEl
            && l.view.inputEl.value.trim().length > 0);
        if (!leaf) return false;
        if (!checking) leaf.view.toss();
        return true;
      },
    });

    this.addCommand({
      id: 'rebuild-index',
      name: 'Index neu aufbauen',
      callback: async () => { await this.index.rebuild(); new Notice('Toss-Index neu aufgebaut.'); },
    });

    this.app.workspace.onLayoutReady(async () => {
      await this.index.initialize();
      this.registerEvent(this.app.vault.on('create', (f) => this.queueUpdate(f)));
      this.registerEvent(this.app.vault.on('modify', (f) => this.queueUpdate(f)));
      this.registerEvent(this.app.vault.on('delete', (f) => this.index.removeFile(f.path)));
      this.registerEvent(this.app.vault.on('rename', (f, oldPath) => {
        this.index.docs.delete(oldPath);
        this.queueUpdate(f);
      }));
      if (this.settings.openOnStart) this.activateView();
    });
  }

  onunload() {
    this.flushSoon.cancel();
    this.index.saveSoon.cancel();
    this.index.lsaSoon.cancel();
  }

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TOSS)) {
      if (leaf.view instanceof TossView && leaf.view.listEl) { leaf.view.applyLayout(); leaf.view.render(); }
    }
  }

  queueUpdate(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return;
    this.pending.add(file.path);
    this.flushSoon();
  }

  async flushPending() {
    const paths = [...this.pending];
    this.pending.clear();
    let changed = false;
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) { changed = this.index.docs.delete(path) || changed; continue; }
      if (!this.index.inScope(file)) { changed = this.index.docs.delete(path) || changed; continue; }
      await this.index.readFile(file);
      changed = true;
    }
    if (changed) this.index.afterChange();
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TOSS)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TOSS, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async createNote({ body, title, tags }) {
    const folder = normalizePath(this.settings.folder || 'Toss');
    if (folder && folder !== '/' && !this.app.vault.getAbstractFileByPath(folder)) {
      try { await this.app.vault.createFolder(folder); } catch (e) { /* existiert schon */ }
    }

    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    let path = `${folder}/${stamp}.md`;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = `${folder}/${stamp}-${n++}.md`;

    const file = await this.app.vault.create(path, buildNote({
      created: now.toISOString(),
      title, tags, body,
    }));
    await this.index.readFile(file);
    this.index.afterChange();
    return file;
  }
}

module.exports = TossPlugin;
