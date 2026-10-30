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
