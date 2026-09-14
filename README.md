# Tichu

Online-Tichu-Turnierplattform für 4 Spieler. Anmeldung, Lobby mit laufenden Spielen,
anonymisierte Gegner (kein Cheating durch Kennen der Mitspieler) und vollständiges
Regelwerk (Schupfen, große/kleine Tichu-Ansage, Bomben, Drache/Phönix/Hund/Mahjong).

Statische Seite (GitHub Pages, kein eigener Server) + Firebase (Firestore + Auth per
E-Mail/Passwort) als reine Sync-Schicht. Firebase-Projekt: `tichu-1c42b` – neu angelegt,
nie öffentlich exponiert (bewusst nicht das alte Schachturnier-Projekt).

**Login/Orga-Rolle:** Anmeldung per frei gewähltem Benutzernamen + Passwort (Account wird
beim ersten Login automatisch angelegt). Der Benutzername "Panda" (fixes Passwort) ist der
Turnier-Orga-Account – nur er darf neue Tische erstellen und Spieler aus einem Tisch kicken.
Das wird serverseitig über `firestore.rules` (`isOrganizer()`, prüft die E-Mail im
Auth-Token) durchgesetzt, nicht nur in der UI versteckt.

## Stand

**Fertig und getestet** – reines, server-unabhängiges Spiel-Regelwerk in `engine/`:

- `engine/cards.js` – 56er-Deck (4 Farben × 2–As + Mahjong/Phönix/Hund/Drache), Punktewerte.
- `engine/combos.js` – Erkennung und Vergleich aller Kombinationen (Single, Paar, Drilling,
  Full House, Treppe, Straße, Vierling-Bombe, Straßenbombe), inkl. Phönix als Joker.
- `engine/game.js` – Rundenablauf: Grand-Tichu-Fenster, Schupfen, Stichspiel mit
  Mahjong-Wunsch, Drachenstich-Abgabe an Gegner, Doppelsieg- und Schlussspieler-Wertung,
  `Match` für mehrere Runden bis zur Zielpunktzahl (Standard 1000).
  `npm test` (reiner Node, keine Abhängigkeiten) – 15/15 Tests grün.

**Neu, noch nicht Ende-zu-Ende getestet** – Firebase-Anbindung:

- `lib/firebase-config.js` – Projektkonfiguration.
- `lib/auth.js` – Login per Benutzername+Passwort (E-Mail/Passwort-Auth intern, Account wird
  beim ersten Login angelegt), eigenes Profil (`users/{uid}.displayName`), `isOrganizer()`.
- `lib/lobby.js` – Tisch erstellen/beitreten, Kartengabe sobald der vierte Sitz belegt ist,
  `kickSeat()` (nur Orga) entfernt einen Spieler wieder aus einem Tisch.
- `index.html` – Login (Benutzername+Passwort). `lobby.html` – offene Tische, eigener
  Tisch/Sitze, für die Orga zusätzlich eine Admin-Ansicht aller Tische mit Kick-Buttons.
- `firestore.rules` – Sicherheitsregeln (siehe unten).
- `.github/workflows/static.yml` – Deploy auf GitHub Pages bei Push auf `main`.

**Noch nicht gebaut:** das eigentliche Spielbrett (Stiche legen, Schupfen-UI,
Tichu-Ansage-Buttons) und die Turnierstruktur über mehrere Tische/Runden hinweg.

## Damit es läuft: zwei Schritte in der Firebase-Konsole

1. **Firestore aktivieren**: [Firebase-Konsole](https://console.firebase.google.com/project/tichu-1c42b/firestore)
   → „Datenbank erstellen" → **Produktionsmodus** (nicht Testmodus – die Regeln unten
   übernehmen die Absicherung).
2. **E-Mail/Passwort-Anmeldung aktivieren**: Konsole → Authentication → Sign-in method →
   „Email/Password" aktivieren (die alte „Anonymous"-Methode wird nicht mehr gebraucht).
3. **Sicherheitsregeln einspielen**: Firestore → Rules → Inhalt von `firestore.rules`
   hier im Repo einfügen und veröffentlichen.

Ohne CLI-/Admin-Zugriff auf dieses Projekt kann ich diese Schritte nicht selbst
ausführen – das geht nur über die Konsole mit deinem Google-Account.

## Sicherheits-/Anonymitätsmodell

- **Handkarten** liegen unter `games/{id}/private/seat{0..3}` und sind nur für die
  `uid` lesbar, die diesen Sitz beansprucht hat (Firestore-Regel, nicht nur UI-Filter).
- **Öffentlicher Spielzustand** (`games/{id}`) enthält nie Anzeigenamen oder uids,
  nur zufällige Sitz-Tokens ("Nord"/"Ost"/"Süd"/"West") – Mitspieler können also nicht
  herausfinden, wer an welchem Platz sitzt, selbst wenn sie das Firestore-Dokument
  direkt läsen.
- **Bekannte Einschränkung – Kartengeben:** Ohne eigenes Backend gibt es keinen
  unbeteiligten Kartengeber. Der Client, der zufällig den vierten und letzten Sitz
  füllt, mischt und verteilt die Karten und hält dabei kurzzeitig alle vier Hände im
  eigenen Speicher, bevor die Firestore-Regeln ihm nur noch Lesezugriff auf die eigene
  Hand erlauben. Für ein härteres Modell bräuchte es eine serverseitige Cloud Function
  (Firebase-CLI/Blaze-Plan nötig) – bewusst als Ausbaustufe zurückgestellt.
- **Bekannte Einschränkung – Sitz-Zuteilung:** Aus demselben Grund (kein Backend) prüft
  die Regel für das Austeilen nur strukturell (nur das `hand`-Feld, nur solange leer),
  nicht mehr zusätzlich "ist der Schreiber Teilnehmer dieses Tisches" – Firestore-Regeln
  können `exists()`/`get()` nicht gegen die eigene, noch nicht committete Transaktion
  prüfen, ein frisch beitretender Spieler könnte sich selbst also nie als "Teilnehmer
  genug" ausweisen, um seinen eigenen Beitritt freizugeben (führte zuvor zu einem
  Join-Fehler). Das Beitreten selbst ist weiterhin strikt "nur leere Sitze füllen,
  nie überschreiben" (`seatsOnlyGrow` in den Regeln).
- **Kicken:** Die Orga kann jederzeit einen belegten Sitz räumen (`kickSeat()`); dabei wird
  die private Hand des Sitzes gelöscht und der Tisch auf `waiting` zurückgesetzt, damit der
  Platz sofort neu beitretbar ist. Läuft die Partie schon, gehen die übrigen drei Hände dabei
  nicht verloren, aber der Rundenstand ist danach nicht mehr konsistent – gedacht für
  "jemand ist raus/hängt fest", nicht als Mitten-in-der-Runde-Feature.
- **Bekannte Einschränkung – Zuginhalt:** Die Regeln prüfen, dass nur Tisch-Teilnehmer
  den öffentlichen Spielstand ändern dürfen, aber nicht inhaltlich, ob ein Zug nach den
  Tichu-Regeln gültig ist (das würde die komplette `combos.js`-Logik in der
  Firestore-Regelsprache erfordern). Für eine Freundesrunde ein akzeptabler
  Kompromiss, für ein hartes Anti-Cheat-Modell wäre serverseitige Validierung nötig.
