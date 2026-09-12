# Tichu

Online-Tichu-Turnierplattform für 4 Spieler. Anmeldung, Lobby mit laufenden Spielen,
anonymisierte Gegner (kein Cheating durch Kennen der Mitspieler) und vollständiges
Regelwerk (Schupfen, große/kleine Tichu-Ansage, Bomben, Drache/Phönix/Hund/Mahjong).

## Stand

Das reine Spiel-Regelwerk (`engine/`) ist server-unabhängig und fertig getestet:

- `engine/cards.js` – 56er-Deck (4 Farben × 2–As + Mahjong/Phönix/Hund/Drache), Punktewerte.
- `engine/combos.js` – Erkennung und Vergleich aller Kombinationen (Single, Paar, Drilling,
  Full House, Treppe, Straße, Vierling-Bombe, Straßenbombe), inkl. Phönix als Joker.
- `engine/game.js` – Rundenablauf: Grand-Tichu-Fenster, Schupfen, Stichspiel mit
  Mahjong-Wunsch, Drachenstich-Abgabe an Gegner, Doppelsieg- und Schlussspieler-Wertung,
  `Match` für mehrere Runden bis zur Zielpunktzahl (Standard 1000).

Tests: `npm test` (reiner Node, keine Abhängigkeiten).

Noch offen: Firebase-Anbindung (neues, nie öffentlich exponiertes Projekt – bewusst
nicht das alte Schachturnier-Projekt), Authentifizierung, Turnier-/Lobby-Oberfläche,
Spielbrett-UI, Anonymisierungsmechanik für die Gegneranzeige.
