# Toss

Ein Obsidian-Plugin nach dem Vorbild von [Mem](https://mem.ai): Notizen einfach
reinwerfen, ohne Ordner, ohne Titelzwang. Die Verbindungen findet das Plugin
selbst — über Ähnlichkeit statt über Struktur.

Läuft auf Desktop und Mobile, komplett offline, ohne Konto und ohne API-Key.

## Die One Box

Es gibt genau ein Eingabefeld, ganz oben. Es ist gleichzeitig Suche und
Eingabe — kein Moduswechsel:

- **Tippen** zeigt sofort passende Notizen. Oben die mit den Wörtern der
  Anfrage, darunter die, die nur inhaltlich ähnlich sind.
- **„Toss“** (oder `Cmd`/`Strg` + `⏎`) legt aus dem Getippten eine Notiz an.
  `⏎` allein macht einen Zeilenumbruch, `Esc` leert das Feld.
- Das Feld ist **drei Zeilen hoch** und lässt sich am Griff unten rechts größer
  ziehen; solange man nicht selbst zieht, wächst es beim Schreiben mit. Das `×`
  oben rechts im Feld leert es.
- **Titel und Tags** stehen darüber und darunter, genau so breit wie das
  Textfeld — ohne Rahmen, bis man sie anfasst. Beide optional, beide
  ignorierbar.

`Cmd`/`Strg` + `⏎` hängt am Kommando **Notiz einwerfen** und ist damit unter
*Einstellungen → Hotkeys* umbelegbar. Es greift nur, solange das Eingabefeld den
Fokus hat.
- **Antippen** einer Karte öffnet sie als Overlay: Titel, Tags und Text lassen
  sich direkt bearbeiten, darunter stehen die ähnlichen Notizen.

Netter Nebeneffekt der One Box: Doppelungen fallen beim Schreiben auf, weil das
Ähnliche schon eingeblendet ist, bevor man auf „Toss“ tippt.

Rechts im Kopf sitzen drei Dinge: der **Layout-Umschalter**, der **Zoom** und die
**Versionsnummer** — an letzterer sieht man auf einen Blick, ob ein Reload durch
ist.

### Layout und Zoom

Neben jeder Abschnittsüberschrift steht klein die Zahl der dort sichtbaren
Notizen; im Feed als `40 von 128`, wenn nicht alle geladen sind. Die zuletzt
geöffnete Karte behält einen dünnen Rahmen — so findet man sie nach dem
Zuklappen zwischen vielen Treffern wieder.

Der Zoom (`− 100 % +`, in 10er-Schritten von 50 bis 200) wirkt auf alles unter
der Kopfzeile. Ein Klick auf den Prozentwert setzt auf 100 % zurück.

Das Symbol daneben schaltet zwischen drei Anordnungen der Ergebnisse um:
**eine Spalte**, **zwei Spalten** und **so viele wie passen**. Die Spalten haben
eine Mindestbreite, auf dem Telefon bleibt es dadurch von selbst einspaltig.
Beides wird gespeichert und steht auch in den Einstellungen.

### Fundstellen

Auf den Karten steht nicht der Textanfang, sondern der Ausschnitt **um die erste
Fundstelle** — mit `…` davor, wenn mitten im Text begonnen wird, und den
Suchbegriffen hervorgehoben. Umlaute werden dabei in beide Richtungen erkannt:
`bruehgruppe` findet und markiert `Brühgruppe`. Die Länge ist einstellbar,
Vorgabe sind 250 Zeichen.

### Das Notiz-Overlay

Aufbau wie in der Eingabe oben: Titel, Text, Tags. Die Aktionen sitzen als Icons
rechts neben dem Titel: in Obsidian öffnen (↗), schließen (×), löschen (🗑).
Löschen wird beim ersten Tipp zum Fragezeichen und löscht erst beim zweiten; ein
Klick irgendwo anders nimmt die Frage zurück. `Esc` und ein Klick auf den
Hintergrund schließen ebenfalls.

Bewusst ein Overlay und keine aufgeklappte Karte: In einem Spaltenlayout wäre die
Karte nur spaltenbreit, und ein Element, das über alle Spalten spannt, zerreißt
den Spaltenfluss — die Karte spränge ans Ende der Liste. Die Liste bleibt jetzt
unangetastet stehen, die zuletzt geöffnete Karte behält ihren Rahmen.

**Gespeichert wird von selbst**, sobald das Overlay geschlossen wird — über das
×, per `Esc`, über den Hintergrund, beim Öffnen in Obsidian und beim Springen zu
einer ähnlichen Notiz. Deshalb gibt es keinen Speichern-Knopf.

### Tags

Tags sind Chips mit `×` zum Entfernen. Beim Tippen erscheint eine Liste der
bereits vergebenen Tags samt Häufigkeit — auswählen mit `↑`/`↓` und `⏎`,
`Backspace` im leeren Feld entfernt den letzten Chip.

Damit die Zahl der Tags nicht unbemerkt wächst:

- Ein **bestehender** Tag ist immer vorausgewählt, wenn es einen passenden gibt.
  „neu anlegen“ steht zuletzt und muss bewusst gewählt werden.
- Getroffen wird auch **unscharf**: `kaffe` findet `#kaffee`, `notiz` findet
  `#notizen`.
- Ist ein Tag an dieser Notiz **schon vergeben**, bleibt er trotzdem in der
  Liste stehen — mit dem Hinweis „schon vergeben“, statt einfach zu fehlen.
- Gibt es einen sehr **ähnlichen** Tag, ist gar nichts vorausgewählt: die
  Neuanlage braucht dann einen zweiten `⏎`.

## Wie die Suche funktioniert

Vier Kanäle werden gewichtet zusammengezählt (Gewichte in den Einstellungen):

| Kanal | Was er findet |
|---|---|
| **Exakt** | Wörter der Anfrage, die wortwörtlich in der Notiz stehen (am Wortanfang, Endung offen: `tomate` findet `Tomaten`). |
| **Wort** | TF-IDF-Cosinus über Wortstämme. Findet Notizen mit überlappendem Vokabular. |
| **Zeichen** | Cosinus über Zeichen-Trigramme. Für Deutsch der wichtigste Trick: verbindet `Notizverwaltung` mit `Notiz` und übersteht Tippfehler. |
| **Semantik** | Embeddings, sonst LSA (siehe unten). Findet Notizen, die **kein einziges Wort** mit der Anfrage teilen. |

Dazu kommen kleine Boni für Tag-Treffer und für frische Notizen.

### Echte Semantik: Embeddings

Standardmäßig aus. Eingeschaltet bettet Toss jede Notiz einmal in einen Vektor
ein und vergleicht Anfragen damit — das bringt Weltwissen mit, das im eigenen
Vault nicht steht. „müde Beine nach dem Sport" findet damit die Notiz über
Regeneration, obwohl sie kein Wort mit der Anfrage teilt.

Toss spricht die **OpenAI-Embeddings-Schnittstelle**; damit stehen mehrere Wege
offen:

| Anbieter | Adresse | Modell | Preis je Mio. Token |
|---|---|---|---|
| **OpenRouter** | `https://openrouter.ai/api/v1` | `baai/bge-m3` | 0,01 $ |
| OpenAI | `https://api.openai.com/v1` | `text-embedding-3-small` | 0,02 $ |
| Mistral | `https://api.mistral.ai/v1` | `mistral-embed` | 0,10 $ |
| LM Studio (lokal) | `http://localhost:1234/v1` | z.B. `nomic-embed-text` | — |
| Ollama (lokal) | `http://localhost:11434/v1` | `nomic-embed-text` | — |

Über **OpenRouter** stehen die Modelle aller Anbieter unter einem Schlüssel. Für
deutsche Notizen bewährt: `baai/bge-m3` (mehrsprachig, retrieval-optimiert) oder
`intfloat/multilingual-e5-large`. Zum Ausprobieren ohne Kosten gibt es
`nvidia/nemotron-3-embed-1b:free` und `liquid/lfm-2.5-embedding-350m:free`.

Die Kosten sind in dieser Größenordnung vernachlässigbar: Eine Toss-Notiz ist
grob 60 Token, tausend Notizen also etwa 60 000 — bei 0,01 $ je Million sind das
**deutlich unter einem Cent** für den kompletten Vault. Suchanfragen sind noch
kleiner und werden zusätzlich gecacht.

**Dabei geht Notiztext an den eingestellten Dienst.** Bei LM Studio und Ollama
bleibt alles auf dem eigenen Rechner — dafür ist auf dem Telefon nichts
erreichbar. Der Schlüssel steht im Klartext in der `data.json` des Plugins.

Wie es arbeitet:

- **Einmal pro Notiz.** Der Vektor hängt an einem Hash des Inhalts; solange sich
  nichts ändert, wird nichts neu abgerechnet. Neue und geänderte Notizen laufen
  im Hintergrund nach, die Kopfzeile zeigt den Fortschritt.
- **Anfragen werden gecacht** und erst nach einer Tippause eingebettet — nicht
  bei jedem Zeichen. Die Trefferliste erscheint sofort lexikalisch und ordnet
  sich neu, sobald der Vektor da ist.
- **Gemischt möglich.** Notizen ohne Vektor nutzen weiter LSA; doppelt gezählt
  wird nichts.
- **„Ähnlich" braucht kein Netz** — dafür werden nur zwei fertige Vektoren
  verglichen.
- **Fällt sauber zurück.** Kein Schlüssel, kein Netz, Fehler beim Dienst: die
  Suche arbeitet lokal weiter.

Der Index speichert die Vektoren base64-kodiert. Mit 512 Dimensionen sind das
rund 1,4 kB pro Notiz.

### LSA als lokale Rückfallebene

Die semantische Suche ist eine **Latent Semantic Analysis**, rein lokal: Die
Term-Dokument-Matrix wird per Orthogonal-Iteration auf wenige Dimensionen
reduziert. Begriffe, die in denselben Notizen vorkommen, rücken dabei zusammen —
so wird `Espresso` mit `Mahlgrad` verwandt, ohne dass die beiden je zusammen
auftauchen müssen.

Kein Modell, kein Download, keine Netzverbindung, ein paar Millisekunden
Rechenzeit. Auf einem Testkorpus mit 132 Notizen fand LSA neun zusätzliche
Treffer ohne gemeinsames Wort mit der Anfrage — alle neun aus dem richtigen
Themengebiet, ohne Präzisionsverlust.

**Die Grenze:** LSA kennt nur Wörter, die im eigenen Vault vorkommen. Ein
Synonym, das nirgends steht, findet sie nicht — dafür gibt es die Embeddings
oben. Ohne die bleibt LSA aber die beste lokale Näherung.

LSA schaltet sich erst ab **25 Notizen und 40 mehrfach verwendeten Begriffen**
zu. Darunter wäre eine Dimensionsreduktion reines Rauschen — sie würde
Zusammenhänge „finden“, die es nicht gibt.

## Dateiformat

Eine Notiz ist eine ganz normale Markdown-Datei im Ordner `Toss/`:

```markdown
---
created: 2026-08-26T14:32:11.000Z
title: "Espresso schmeckt sauer"
tags: ["kaffee"]
---
Der Espresso lief in 18 Sekunden durch, viel zu schnell.
```

Der Dateiname ist immer ein Zeitstempel und ändert sich nie — ein späterer Titel
löst also keine Umbenennung aus. Titel und Tags dürfen fehlen; der Titel wird
dann aus der ersten Zeile abgeleitet.

**Woher der Titel kommt:** `title` aus dem Frontmatter geht immer vor. Fehlt es,
trennen sich die Wege — eine Toss-Notiz heißt nach ihrer ersten Zeile, weil ihr
Dateiname nur ein Zeitstempel ist; eine mitindizierte Notiz heißt nach ihrer
**Datei**, so wie Obsidian sie überall sonst auch benennt. Im Overlay steht der
Dateiname dann als Platzhalter im Titelfeld.

Toss verwaltet nur `created`, `title` und `tags`. **Alle anderen
Frontmatter-Felder bleiben beim Speichern unverändert stehen** — `aliases`,
`cssclasses`, Dataview-Felder und was sonst noch drin ist.

### Warum keine `toss_`-Präfixe

`tags` ist keine Plugin-Property, sondern Obsidian-Kern: Tag-Leiste, `tag:`-Suche,
Graph, Autovervollständigung und die Tag-Pillen in der Properties-Ansicht lesen
genau dieses Feld. Ein eigenes `toss_tags` würde Toss-Tags daraus herausschneiden
und im Vault-weiten Betrieb zwei getrennte Tag-Welten erzeugen.

`title` und `created` sind geteilte Konventionen mit derselben Bedeutung, die
Toss ihnen gibt — *Front Matter Title*, Templater und Dataview meinen dasselbe.
Ein Präfix machte daraus keine saubere Trennung, sondern eine Dublette.

Stattdessen ist die Schreibseite abgesichert: **Toss legt in Notizen außerhalb
seines Ordners kein `created` an**, das nicht schon da war. `title` und `tags`
entstehen dort ohnehin nur, wenn du sie selbst einträgst.

Ohne das Plugin bleibt der Vault vollständig lesbar und bearbeitbar.

## In jedem Vault

Toss ist ein gewöhnliches Community-Plugin und läuft in jedem Vault. Es legt
seinen Ordner beim ersten „Toss“ an und rührt nichts an, was es nicht selbst
geschrieben hat.

Notizen, die Toss nur mitindiziert hat, sind in der Liste **fein schraffiert**
statt glatt grau, und in der Metazeile steht ihr Ordner. Das Overlay trägt dieselbe
Schraffur und weist zusätzlich im Klartext darauf hin, dass es keine Toss-Notiz
ist — dort gelten beim Speichern ja
andere Regeln (siehe *Dateiformat*). Farbe bleibt bewusst frei: die ist schon
für Ähnlichkeit und für die zuletzt geöffnete Karte vergeben.

Standardmäßig sieht Toss **nur seinen eigenen Ordner** — in einem bestehenden
Vault stört es damit niemanden. Wer *Ganzen Vault durchsuchen* einschaltet,
bekommt alle Markdown-Notizen in Suche und Ähnlichkeit; neue Notizen landen
trotzdem weiter im Toss-Ordner. Bearbeitet man eine fremde Notiz in einer Karte,
bleibt ihr Frontmatter erhalten und Toss fügt von sich aus nichts hinzu
(siehe *Dateiformat*).

Der Index liegt pro Vault im jeweiligen Plugin-Ordner. Vaults teilen also nichts
miteinander.

Der Suchindex liegt als `index.json` im Plugin-Ordner, **nicht** im Vault. Er ist
nur ein Cache und darf jederzeit gelöscht werden.

## Installation über BRAT

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installieren, dann
*Add Beta plugin* und dieses Repository angeben. BRAT holt `manifest.json`,
`main.js` und `styles.css` und hält sie aktuell — auch auf dem iPhone.

Damit BRAT eine neue Fassung sieht, muss die Version in `manifest.json` erhöht
und ein GitHub-Release mit demselben Tag angelegt werden, an dem die drei
Dateien als Assets hängen:

```bash
gh release create 0.2.0 manifest.json main.js styles.css --title 0.2.0 --notes "…"
```

Von Hand geht es genauso: die drei Dateien nach
`<Vault>/.obsidian/plugins/toss/` legen, dann unter *Einstellungen →
Community-Plugins* den eingeschränkten Modus ausschalten und **Toss** aktivieren.

Ein Build-Schritt ist in keinem Fall nötig — Obsidian lädt `main.js` direkt.

### Tests

```bash
node tests/run.js
```

Kein npm, keine Abhängigkeiten. Die Tests fahren die echte Logik gegen
nachgebaute Obsidian-Objekte (`tests/obsidian.js`) und einen Vault im Speicher.
In den Stub gehört ausschließlich, was die echte API auch hat — ein zu
freundlicher Stub bestätigt die eigenen Annahmen, statt sie zu prüfen. Dass
`Modal` kein `register()` kennt und `Modal.doc` ein Nur-Lese-Getter ist, hat
genau deshalb erst im laufenden Obsidian weh getan; beides ist jetzt
nachgebildet.

### Entwickeln

Am schnellsten geht es mit einem Symlink in einen Test-Vault:

```bash
ln -sfn "$(pwd)" "<Test-Vault>/.obsidian/plugins/toss"
```

Nach jeder Änderung in Obsidian *Reload app without saving* (`Cmd`+`R`) oder das
Plugin aus- und wieder einschalten. Die Versionsnummer im Kopf der Ansicht
zeigt, ob der Reload wirklich durch ist.

Mobile Ansicht auf dem Desktop prüfen: Developer Console öffnen und
`app.emulateMobile(true)` ausführen.

## Einstellungen

- **Embeddings verwenden** samt Anbieter, Adresse, Modell, Schlüssel,
  Dimensionen und Gewicht — dazu ein Knopf, der die Verbindung testet
- **Beim Start öffnen** — Obsidian stellt eigene Ansichten beim Neustart nicht
  zuverlässig wieder her; auf dem Telefon landet man sonst in der zuletzt
  geöffneten Notiz. Standardmäßig an.
- **Ordner** — wo neue Notizen landen (Standard: `Toss`)
- **Ganzen Vault durchsuchen** — statt nur des Toss-Ordners
- **Semantische Suche (LSA)** an/aus, **Dimensionen** (32–64 ist ein guter Bereich)
- **Gewichte** der vier Kanäle
- **Schwelle für „Auch ähnlich“** — höher = weniger, aber sicherere Vorschläge
- **Layout der Ergebnisse** und **Länge des Textausschnitts**
- **Index neu aufbauen**

## Nächste Schritte

- Cluster-Ansicht: Themen-Regale statt Chronologie auf der Startseite
- Verwandte Notizen beim Schreiben schon während des Tippens vorschlagen
