/*
 * Testlauf ohne Abhaengigkeiten: node tests/run.js
 *
 * Prueft die Logik gegen nachgebaute Obsidian-Objekte. Was der Stub nicht
 * kennt, kann er nicht pruefen - deshalb steht in tests/obsidian.js nur, was
 * die echte API wirklich hat.
 */
const { makeEnv, obsidian } = require('./env.js');

let failed = 0;
let section = '';
const group = (name) => { section = name; console.log('\n' + name); };
const check = (label, cond) => {
  if (!cond) failed++;
  console.log((cond ? '  ok   ' : '  FEHL ') + label);
};
const find = (root, cls) => root.all((e) => e.hasClass(cls));
const marks = (root) => root.all((e) => e.tagName === 'mark').map((e) => e.text);
const tick = () => new Promise((r) => setTimeout(r, 20));

(async () => {
  /* ---------------------------------------------------------------- */
  group('Notiz-Format');
  {
    const { I } = await makeEnv();
    const note = '---\ncreated: 2026-01-01T10:00:00.000Z\naliases:\n  - Kurz\ncssclasses: [breit]\n'
      + 'projekt: Alpha\ntitle: "Der Titel"\ntags: ["a", "b"]\n---\nDer Text.\n';
    const { meta, body } = I.parseNote(note);
    check('Titel gelesen', meta.title === 'Der Titel');
    check('Tags gelesen', meta.tags.join() === 'a,b');
    check('Text gelesen', body.trim() === 'Der Text.');
    check('Fremde Felder gesammelt: ' + JSON.stringify(meta.extra),
      meta.extra.some((l) => l.includes('projekt: Alpha')) && meta.extra.some((l) => l.includes('- Kurz')));
    const back = I.buildNote({ created: meta.created, title: meta.title, tags: meta.tags, body: 'Neu.', extra: meta.extra });
    check('Fremde Felder ueberleben das Schreiben',
      back.includes('projekt: Alpha') && back.includes('cssclasses: [breit]') && back.includes('- Kurz'));
    check('Ohne created keine created-Zeile',
      !I.buildNote({ created: '', title: '', tags: [], body: 'x', extra: [] }).includes('created:'));
    check('Langer Titel endet auf ganzem Wort',
      / …$/.test(I.deriveTitle({ title: '', tags: [] }, 'a'.repeat(30) + ' und noch viel mehr Text der ueber achtzig Zeichen hinausgeht sicher', '')));
    check('Dateiname schlaegt erste Zeile', I.deriveTitle({ title: '', tags: [] }, '# Ueberschrift', 'Datei') === 'Datei');
    check('Frontmatter schlaegt Dateiname', I.deriveTitle({ title: 'FM', tags: [] }, '# U', 'Datei') === 'FM');
  }

  /* ---------------------------------------------------------------- */
  group('Suche: exakt, unscharf, Umlaute');
  {
    const { I, index, view } = await makeEnv();
    check('Index gefuellt: ' + index.status, index.list.length === require('./corpus.js').length);
    check('LSA aktiv', !!index.lsa);

    const espresso = index.search('espresso').hits;
    check('Wortreffer gefunden', espresso.some((r) => r.doc.title.includes('Espresso')));

    // "ohne" steckt in "Bohnen" - darf kein Treffer sein
    const ohne = index.search('notizen ohne ordner');
    check('Kein Teilstring-Treffer ("ohne" in "Bohnen")',
      !ohne.hits.some((r) => r.doc.text.includes('Bohnen')));

    view.inputEl.value = 'bruehgruppe'; view.render();
    const hit = find(view.listEl, 'toss-card')[0];
    check('Fundstelle hervorgehoben: ' + marks(hit).join(', '),
      marks(hit).some((m) => m.toLowerCase() === 'bruehgruppe'));

    const re = I.queryRegex(['bruehgruppe', 'fuer']);
    check('Umlauttoleranz: "bruehgruppe" trifft "Brühgruppe"', re.test('Die Brühgruppe'));
    re.lastIndex = 0;
    check('… und "fuer" trifft "für"', I.queryRegex(['fuer']).test('etwas für dich'));

    const long = 'Vorspann. '.repeat(40) + 'Hier steht das Stichwort Zwirbelholz mitten drin.';
    const snip = I.snippet(long, I.queryRegex(['zwirbelholz']), 250);
    check('Ausschnitt beginnt an der Fundstelle', snip.startsWith('… ') && snip.includes('Zwirbelholz'));
    check('Ausschnitt bleibt in der Laenge', snip.length <= 262);
  }

  /* ---------------------------------------------------------------- */
  group('Liste: Abschnitte, Zahlen, Layout');
  {
    const { view, index, plugin } = await makeEnv();
    view.inputEl.value = 'kaffee'; view.render();
    const kinder = view.listEl.children.map((c) => [...c.classes][0]);
    check('Auf jede Ueberschrift folgt ihre Gruppe: ' + kinder.slice(0, 4).join(' → '),
      kinder.every((k, i) => k !== 'toss-section' || kinder[i + 1] === 'toss-group'));
    check('Karten liegen in den Gruppen', view.listEl.children.every((c) => !c.hasClass('toss-card')));
    const zahlen = find(view.listEl, 'toss-section').map((e) => find(e, 'toss-section-note')[0].text);
    check('Jeder Abschnitt zeigt eine Zahl: ' + zahlen.join(' / '),
      zahlen.length > 0 && zahlen.every((z) => /^\d+( von \d+)?$/.test(z)));
    check('Die Zahlen ergeben die Karten',
      zahlen.reduce((n, z) => n + parseInt(z, 10), 0) === find(view.listEl, 'toss-card').length);

    check('Startlayout eine Spalte', view.zoomEl.hasClass('toss-layout-list'));
    await view.cycleLayout();
    check('… dann zwei Spalten', view.zoomEl.hasClass('toss-layout-two'));
    await view.setZoom(80);
    check('Zoom wirkt auf den Bereich unter dem Kopf', view.zoomEl.style.zoom === '0.8');
    check('Version im Kopf', find(view.contentEl, 'toss-version')[0].text === 'v0.0.0-test');
  }

  /* ---------------------------------------------------------------- */
  group('Overlay');
  {
    const { view, store, opened } = await makeEnv();
    view.inputEl.value = 'espresso'; view.render();
    const card = find(view.listEl, 'toss-card')[0];
    card.onclick(); await tick();
    const modal = obsidian.__state.modals[obsidian.__state.modals.length - 1];
    check('Overlay offen', modal.isOpen === true);
    check('Karte bleibt in der Liste', find(view.listEl, 'toss-card').some((c) => c.dataset.path === card.dataset.path));
    const btns = find(modal.contentEl, 'toss-icon-btn');
    check('Drei Icons, kein Speichern: ' + btns.map((b) => b.icon).join(','),
      btns.map((b) => b.icon).join(',') === 'external-link,x,trash-2');

    const body = find(modal.contentEl, 'toss-edit-body')[0];
    body.value = 'Neuer Text ohne Speicherklick.'; body.fire('input');
    modal.close(); await tick();
    check('Beim Schliessen gespeichert', store.get(card.dataset.path).includes('Neuer Text ohne Speicherklick.'));
    check('Karte bleibt markiert', find(view.listEl, 'toss-card')
      .find((c) => c.dataset.path === card.dataset.path).hasClass('is-last'));

    card.onclick(); await tick();
    const m2 = obsidian.__state.modals[obsidian.__state.modals.length - 1];
    const del = find(m2.contentEl, 'toss-icon-btn')[2];
    await del.onclick();
    check('Loeschen fragt nach: ' + del.icon, del.icon === 'help-circle' && opened.trashed === null);
    global.document.fire('click', { target: view.inputEl });
    check('Klick woanders nimmt die Frage zurueck', del.icon === 'trash-2');
    await del.onclick(); await del.onclick();
    check('Zweiter Klick loescht', opened.trashed === card.dataset.path);
  }

  /* ---------------------------------------------------------------- */
  group('Tags');
  {
    const { view } = await makeEnv();
    view.inputEl.value = 'espresso'; view.render();
    find(view.listEl, 'toss-card')[0].onclick(); await tick();
    const modal = obsidian.__state.modals[obsidian.__state.modals.length - 1];
    const input = find(modal.contentEl, 'toss-tagedit-input')[0];
    check('Vorhandener Tag als Chip', find(modal.contentEl, 'toss-chip-tag').length >= 1);

    input.fire('focus');
    input.value = 'lauf'; input.fire('input');
    const rows = find(modal.contentEl, 'toss-suggest-row');
    const labels = rows.map((r) => find(r, 'toss-suggest-label')[0].text);
    check('Bestehende Tags vorgeschlagen: ' + labels.join(', '), labels.includes('laufen'));
    check('Vorausgewaehlt ist ein bestehender Tag',
      rows[0].hasClass('is-active') && !rows[0].hasClass('toss-suggest-new'));
    check('Neuanlage steht zuletzt', rows[rows.length - 1].hasClass('toss-suggest-new'));

    input.value = 'kaffe'; input.fire('input');
    const rows2 = find(modal.contentEl, 'toss-suggest-row');
    const neu = rows2.find((r) => r.hasClass('toss-suggest-new'));
    check('Fast-Doppelung wird angemerkt: ' + find(neu, 'toss-suggest-note')[0].text,
      find(neu, 'toss-suggest-note')[0].text.includes('ähnlich zu #kaffee'));
    check('Nichts vorausgewaehlt', !rows2.some((r) => r.hasClass('is-active')));
    input.fire('keydown', { key: 'Enter' });
    check('Erstes Enter legt nichts an',
      !find(modal.contentEl, 'toss-chip-tag').some((c) => c.children[0].text === '#kaffe'));
    input.fire('keydown', { key: 'Enter' });
    check('Zweites Enter legt an',
      find(modal.contentEl, 'toss-chip-tag').some((c) => c.children[0].text === '#kaffe'));

    const vorher = find(modal.contentEl, 'toss-chip-tag').length;
    input.fire('keydown', { key: 'Backspace' });
    check('Backspace entfernt den letzten Chip', find(modal.contentEl, 'toss-chip-tag').length === vorher - 1);
  }

  /* ---------------------------------------------------------------- */
  group('Fremde Notizen');
  {
    const extra = [['Projekte/Konzept Alpha.md', '---\naliases:\n  - Kurz\n---\n# Ueberschrift\n\nEin Text aus einem anderen Ordner.\n']];
    const { view, index, store } = await makeEnv({ extra, settings: { indexWholeVault: true } });
    const doc = index.docs.get('Projekte/Konzept Alpha.md');
    check('Titel ist der Dateiname: ' + doc.title, doc.title === 'Konzept Alpha');
    check('Als fremd erkannt', doc.own === false);
    check('Vorschau beginnt am Anfang', doc.derived === false);

    view.inputEl.value = 'anderen ordner'; view.render();
    const card = find(view.listEl, 'toss-card').find((c) => c.dataset.path === 'Projekte/Konzept Alpha.md');
    check('Karte ist schraffiert', !!card && card.hasClass('is-foreign'));
    check('Herkunft steht an der Karte',
      find(card, 'toss-source')[0].all(() => true).some((e) => e.text === 'Projekte'));

    card.onclick(); await tick();
    const modal = obsidian.__state.modals[obsidian.__state.modals.length - 1];
    check('Overlay ebenfalls schraffiert', modal.modalEl.hasClass('is-foreign'));
    check('Overlay nennt die Herkunft', find(modal.contentEl, 'toss-foreign-hint').length === 1);
    check('Dateiname als Platzhalter im Titelfeld',
      find(modal.contentEl, 'toss-edit-title')[0].attrs.placeholder === 'Konzept Alpha');

    const body = find(modal.contentEl, 'toss-edit-body')[0];
    body.value = 'Geaendert.'; body.fire('input');
    modal.close(); await tick();
    const after = store.get('Projekte/Konzept Alpha.md');
    check('Kein created erfunden', !after.includes('created:'));
    check('aliases erhalten', after.includes('- Kurz'));
    check('Aenderung geschrieben', after.includes('Geaendert.'));
  }

  /* ---------------------------------------------------------------- */
  group('LSA: neue Notiz bleibt auffindbar');
  {
    const { index, plugin } = await makeEnv();
    check('LSA aktiv', !!index.lsa);
    const vorher = index.related(index.list[5].path, 3).map((r) => r.doc.path);
    await plugin.createNote({ body: 'Ein frischer Gedanke ueber Zwirbelholz.', title: '', tags: [] });
    const found = index.search('zwirbelholz');
    check('Sofort auffindbar, ohne LSA-Neuaufbau',
      found.hits.some((h) => h.doc.text.includes('Zwirbelholz')));
    check('Aehnliche der bestehenden Notiz nicht verrutscht',
      JSON.stringify(index.related(index.list[6].path, 3).map((r) => r.doc.path)) === JSON.stringify(vorher));
  }

  /* ---------------------------------------------------------------- */
  group('Embeddings');
  {
    const { I, index, view, plugin } = await makeEnv({
      settings: { semanticEnabled: true, semanticBaseUrl: 'http://test/v1', semanticModel: 'fake', semanticKey: 'k', semanticDims: 0 },
    });
    check('Vektoren ueberstehen base64', (() => {
      const v = I.normalizeVec(Float32Array.from([1, 2, 3, 4]));
      const back = I.decodeVec(I.encodeVec(v));
      return back.length === 4 && Math.abs(I.dot(v, back) - 1) < 1e-6;
    })());

    check('Vor dem Lauf ist nichts eingebettet', index.embedStale().length === index.list.length);
    await index.embedMissing();
    check('Danach alles: ' + index.list.length + ' Notizen', index.embedStale().length === 0);
    check('In Stapeln angefragt, nicht einzeln', obsidian.__state.requests.length <= 2);

    // Der eigentliche Punkt: kein gemeinsames Wort, trotzdem gefunden.
    const q = 'muede beine nach dem sport';
    const [qv] = await index.embedder.embed([q]);
    const { hits, similar } = index.search(q, qv);
    const top = [...hits, ...similar].slice(0, 5);
    check('„' + q + '“ findet Notizen: ' + top.map((r) => r.doc.title.slice(0, 22)).join(' | '), top.length > 0);
    check('… und zwar Lauf-Notizen', top.slice(0, 3).every((r) => r.doc.tags.includes('laufen')));
    check('… ohne ein Wort mit der Anfrage zu teilen',
      top.slice(0, 3).every((r) => !q.split(' ').some((w) => w.length > 3 && r.doc.norm.includes(w))));
    check('Semantik-Kanal traegt die Wertung', top[0].semantic > 0 && top[0].word === 0);

    const kaffee = index.list.find((d) => d.title === 'Crema zu hell');
    const rel = index.related(kaffee.path, 4);
    check('„Aehnlich“ nutzt die Vektoren ohne Netz: ' + rel.map((r) => r.doc.title.slice(0, 16)).join(' | '),
      rel.length > 0 && rel.every((r) => r.doc.tags.includes('kaffee')));

    // Anfrage-Vektoren werden gecacht
    const vorher = obsidian.__state.requests.length;
    view.inputEl.value = 'espresso mahlgrad';
    await view.embedQuery('espresso mahlgrad');
    await view.embedQuery('espresso mahlgrad');
    check('Anfrage nur einmal eingebettet', obsidian.__state.requests.length === vorher + 1);
    check('Zweite Suche nutzt den Cache', !!view.semanticVectorFor('espresso mahlgrad'));

    // Inhalt unveraendert -> kein erneutes Einbetten
    const stand = obsidian.__state.requests.length;
    const file = plugin.app.vault.getAbstractFileByPath(index.list[0].path);
    await index.readFile(file);
    check('Unveraenderte Notiz behaelt ihren Vektor', index.embedStale().length === 0
      && obsidian.__state.requests.length === stand);
  }

  /* ---------------------------------------------------------------- */
  group('Embeddings: Rueckfall ohne Dienst');
  {
    const { index } = await makeEnv({ settings: { semanticEnabled: true, semanticKey: '' } });
    check('Ohne Schluessel nicht verfuegbar', index.embedder.available() === false);
    check('Suche funktioniert trotzdem', index.search('espresso').hits.length > 0);
    check('LSA springt ein', !!index.lsa);
  }

  console.log('\n' + (failed ? failed + ' FEHLER' : 'alle Checks grün'));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('\nABBRUCH in "' + section + '"\n', e); process.exit(1); });
