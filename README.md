# Tichu


## Firestore-Kosten

Firebase berechnet jedes vom Server gelieferte Dokument (Lesen), jede Änderung (Schreiben) und jedes
Löschen. Der kostenlose Spark-Tarif hat Tageslimits (50.000 Lesen / 20.000 Schreiben / 20.000 Löschen),
danach schlagen alle Zugriffe mit „Quota exceeded“ fehl. Was dagegen im Code steckt:

- **Lokaler Speicher** (`lib/firebase-config.js`): Der Browser behält gelesene Dokumente dauerhaft. Beim
  Seitenwechsel oder Neuladen (bis 30 Min. danach) schickt der Server nur noch Änderungen statt aller
  Dokumente neu - das betrifft Turnier-Hub, Spielbrett-Zuglog und Zuschauen am stärksten. Beim
  Abmelden wird er geleert. Aus dem Zuglog abgeleitete *Schreib*-Aktionen (nächste Runde austeilen)
  laufen nur auf einem vom Server bestätigten Stand (`fromCache`).
- **Warteraum** (`lib/room.js`): Heartbeat alle 40 s statt 20 s; ohne jede Eingabe seit 30 Min. gar nicht
  mehr (vergessener Tab); der eigene Sitz wird nicht doppelt beobachtet.
- Jeder Zug ist ein Dokument, das jeder Mitspieler/Zuschauer einmal liest - das ist der Grundverbrauch.

## Faires Austeilen

Früher mischte und verteilte ein einzelner Spieler (der vierte am Tisch bzw. wer zuletzt „bereit“ drückte)
im eigenen Browser und sah dabei alle Hände - er hätte sich z. B. immer den Mahjong geben können. Jetzt
würfeln alle vier gemeinsam (Commit-Reveal, `engine/fairdeal.js`, Ablauf in `board.html`):

1. Jeder Spieler legt per `dealCommit` nur den Hash seines geheimen Zufallswerts fest.
2. Erst wenn alle vier da sind, deckt jeder per `dealReveal` seinen Wert auf (vorher zählt Aufdecken nicht).
3. Aus den vier Werten wird das Mischen deterministisch berechnet - alle Browser kommen auf dieselben Karten.

Niemand kann das Ergebnis allein bestimmen. Wer als Letzter aufdeckt, kennt es zwar vorher, kann aber nur noch
den Tisch anhalten (für alle sichtbar: „warte auf …“). Neue Tische tragen die Markierung `fairDeal` - dann werden
private Hände und `newRound`-Ereignisse anderer ignoriert; schon laufende, klassisch ausgeteilte Spiele laufen
unverändert weiter. Damit niemand im Namen anderer Sitze Beiträge posten kann, prüfen die Firestore-Regeln
(`isOwnSeatEvent` in `firestore.rules`), dass ein Ereignis nur für den eigenen Sitz angelegt wird.

## Symbole der Sonderkarten

Hund, Phönix und Drache liegen als einzelne SVG-Dateien in `icons/` (`dog.svg`, `phoenix.svg`, `dragon.svg`,
`viewBox="0 0 64 64"`, flache Farben: dunkel `#8A5A16`, mittel `#b8862f`, Kartenfarbe `#e8c471`). Wer ein Symbol
ersetzen will, überschreibt die Datei und führt `node tools/embed-icons.mjs` aus - das Skript trägt sie in
`board.html` und `play.html` ein. Phönix- und Drachenkopf sind Zeichnungen (Raster) in den Spielfarben, die
vektorisiert wurden: dunkel und mittel als Flächen, die hellen Linien sind echte Aussparungen.
