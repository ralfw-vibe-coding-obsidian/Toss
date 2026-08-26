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
| **Semantik** | LSA (siehe unten). Findet Notizen, die **kein einziges Wort** mit der Anfrage teilen. |

Dazu kommen kleine Boni für Tag-Treffer und für frische Notizen.

### LSA statt Embeddings

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
Synonym, das nirgends steht, findet sie nicht. Genau da kämen echte Embeddings
über eine API ins Spiel — die Schnittstelle im Code (`lsaQueryVector` /
`docVectors`) ist so geschnitten, dass sie sich ersetzen lässt.

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

- **Ordner** — wo neue Notizen landen (Standard: `Toss`)
- **Ganzen Vault durchsuchen** — statt nur des Toss-Ordners
- **Semantische Suche (LSA)** an/aus, **Dimensionen** (32–64 ist ein guter Bereich)
- **Gewichte** der vier Kanäle
- **Schwelle für „Auch ähnlich“** — höher = weniger, aber sicherere Vorschläge
- **Layout der Ergebnisse** und **Länge des Textausschnitts**
- **Index neu aufbauen**

## Nächste Schritte

- Cluster-Ansicht: Themen-Regale statt Chronologie auf der Startseite
- Optionale Embeddings über eine API, mit LSA als Rückfallebene
- Verwandte Notizen beim Schreiben schon während des Tippens vorschlagen
