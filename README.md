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
- **„Toss“** (oder `Cmd`/`Strg` + `Enter`) legt aus dem Getippten eine Notiz an.
- **Titel und Tags** sind zwei ausklappbare Zusatzfelder. Beide optional.
- **Antippen** einer Karte klappt sie auf: Titel, Tags und Text lassen sich
  direkt bearbeiten, darunter stehen die ähnlichen Notizen.

Netter Nebeneffekt der One Box: Doppelungen fallen beim Schreiben auf, weil das
Ähnliche schon eingeblendet ist, bevor man auf „Toss“ tippt.

Rechts im Kopf steht die Versionsnummer — daran sieht man auf einen Blick, ob
ein Reload durch ist.

### Aufgeklappte Notiz

Die Aktionen sitzen als Icons rechts neben dem Titel: speichern, in Obsidian
öffnen, zuklappen, löschen. Löschen fragt beim ersten Tipp nach.

**Gespeichert wird von selbst**, sobald die Karte verlassen wird — beim Öffnen,
beim Zuklappen, beim Springen zu einer ähnlichen Notiz und beim Schließen der
Ansicht. Der Speichern-Knopf bleibt für den ausdrücklichen Fall.

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

Ohne das Plugin bleibt der Vault vollständig lesbar und bearbeitbar.

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
- **Index neu aufbauen**

## Nächste Schritte

- Cluster-Ansicht: Themen-Regale statt Chronologie auf der Startseite
- Optionale Embeddings über eine API, mit LSA als Rückfallebene
- Verwandte Notizen beim Schreiben schon während des Tippens vorschlagen
