// Tisch erstellen/beitreten. Öffentliche Spieldaten enthalten NIE Anzeigenamen oder sonstige
// Identitätsmerkmale - nur zufällige Sitz-Tokens ("Nord"/"Ost"/"Süd"/"West" + Token), damit kein
// Mitspieler (auch nicht über einen direkten Firestore-Read) erkennen kann, wer an welchem
// Platz sitzt. Die private Hand jedes Sitzes liegt in games/{id}/private/seat{0..3} und ist nur
// für die uid lesbar, die diesen Sitz beansprucht hat (siehe firestore.rules).
import { db } from './firebase-config.js';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { createDeck, shuffle } from '../engine/cards.js';

export const SEAT_LABELS = ['Nord', 'Ost', 'Süd', 'West'];
export const SEAT_DOC_IDS = ['seat0', 'seat1', 'seat2', 'seat3'];

function randomToken() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Tische bekommen statt einer kryptischen ID einen Städtenamen - leichter zu merken/ansagen
// als "Tisch a3f9c1".
const CITY_NAMES = [
  'Wien', 'Berlin', 'Zürich', 'Paris', 'London', 'Rom', 'Madrid', 'Lissabon', 'Amsterdam',
  'Prag', 'Budapest', 'Warschau', 'Stockholm', 'Oslo', 'Helsinki', 'Kopenhagen', 'Dublin',
  'Brüssel', 'Bern', 'Venedig', 'Florenz', 'Neapel', 'Barcelona', 'Sevilla', 'Porto',
  'München', 'Hamburg', 'Köln', 'Dresden', 'Leipzig', 'Salzburg', 'Innsbruck', 'Graz',
  'Athen', 'Istanbul', 'Reykjavik', 'Tokio', 'Kyoto', 'Singapur', 'Toronto', 'Montreal',
  'New York', 'Chicago', 'Rio de Janeiro', 'Kapstadt', 'Marrakesch', 'Krakau', 'Riga',
];

function randomTableName() {
  return CITY_NAMES[Math.floor(Math.random() * CITY_NAMES.length)];
}

// mode: 'freeplay' oder 'tournament' - trennt die beiden Bereiche der Lobby. Selbe Mechanik,
// nur getrennt gelistet.
export function watchOpenGames(mode, callback) {
  const q = query(collection(db, 'games'), where('status', '==', 'waiting'), where('mode', '==', mode));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function createTable(mode, target = 1000) {
  const ref = await addDoc(collection(db, 'games'), {
    status: 'waiting',
    createdAt: serverTimestamp(),
    seats: [null, null, null, null],
    target,
    name: randomTableName(),
    mode,
  });
  return ref.id;
}

// Beansprucht den nächsten freien Sitzplatz für `uid`. Wird dabei der vierte und letzte Platz
// besetzt, mischt und verteilt dieser Client zugleich alle vier Hände (Hinweis: ohne eigenes
// Backend gibt es keinen unbeteiligten Kartengeber - der Client, der zufällig den letzten Platz
// füllt, hält die vollständige Kartenverteilung kurz im eigenen Speicher, bevor er nur noch
// Lesezugriff auf die eigene Hand hat. Für ein härteres Vertrauensmodell bräuchte es eine
// serverseitige Cloud Function, die hier bewusst (noch) nicht eingesetzt wird.)
export async function joinTable(gameId, uid) {
  const gameRef = doc(db, 'games', gameId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Tisch existiert nicht mehr.');
    const data = snap.data();
    if (data.status !== 'waiting') throw new Error('Tisch ist bereits voll oder gestartet.');

    const seats = data.seats.slice();
    const seatIndex = seats.findIndex((s) => s === null);
    if (seatIndex === -1) throw new Error('Tisch ist voll.');

    const anonToken = randomToken();
    seats[seatIndex] = anonToken;
    const allFilled = seats.every((s) => s !== null);

    const mySeatRef = doc(db, 'games', gameId, 'private', SEAT_DOC_IDS[seatIndex]);
    let myHand = [];

    if (allFilled) {
      const hands = [[], [], [], []];
      shuffle(createDeck()).forEach((card, i) => hands[Math.floor(i / 14)].push(card));
      myHand = hands[seatIndex];
      for (let s = 0; s < 4; s++) {
        if (s === seatIndex) continue; // eigener Sitz wird unten in einem Zug mit angelegt
        const otherRef = doc(db, 'games', gameId, 'private', SEAT_DOC_IDS[s]);
        tx.update(otherRef, { hand: hands[s] });
      }
    }
    tx.set(mySeatRef, { claimedByUid: uid, anonToken, joinedAt: serverTimestamp(), hand: myHand });

    tx.update(gameRef, { seats, status: allFilled ? 'dealt' : 'waiting' });
    return { seatIndex, allFilled };
  });
}

// Gibt den eigenen Sitz wieder frei - damit lässt sich ein anderer Tisch beitreten, ohne
// gleichzeitig an mehreren zu sitzen. War der Tisch noch am Warten, wird NUR der eigene Sitz
// frei, die anderen drei warten unbehelligt weiter. War schon ausgeteilt (oder das Spiel lief
// bereits), wird der GANZE Tisch zurückgesetzt: ein einzelner Ersatzspieler könnte mit den
// alten Händen der übrigen drei ohnehin nichts anfangen, und ließe man nur den eigenen Sitz
// frei, blieben deren Handkarten-Dokumente dauerhaft nicht-leer - ein künftiger vierter
// Beitritt würde dann am `hand.size() == 0`-Check der Regeln scheitern (Ursache eines echten
// "Missing or insufficient permissions"-Fehlers, der so aufgetreten ist).
export async function leaveTable(gameId, seatIndex) {
  const gameRef = doc(db, 'games', gameId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const seats = data.seats.slice();
    if (seats[seatIndex] == null) return;

    if (data.status === 'waiting') {
      seats[seatIndex] = null;
      tx.delete(doc(db, 'games', gameId, 'private', SEAT_DOC_IDS[seatIndex]));
      tx.update(gameRef, { seats, status: 'waiting' });
    } else {
      for (const id of SEAT_DOC_IDS) tx.delete(doc(db, 'games', gameId, 'private', id));
      tx.update(gameRef, { seats: [null, null, null, null], status: 'waiting' });
    }
  });
}

export function watchMySeat(gameId, seatIndex, callback) {
  const ref = doc(db, 'games', gameId, 'private', SEAT_DOC_IDS[seatIndex]);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? snap.data() : null));
}

export function watchGame(gameId, callback) {
  const ref = doc(db, 'games', gameId);
  return onSnapshot(ref, (snap) => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}

// Die vier ausgeteilten Hände auf einmal holen (nur möglich, sobald man selbst an diesem
// Tisch sitzt - siehe firestore.rules: private/{seatDoc} ist für Mitspieler lesbar). Für den
// Aufbau des Online-Spielbretts: bewusste Vereinfachung, siehe Kommentar in firestore.rules.
export async function getAllHands(gameId) {
  const snaps = await Promise.all(
    SEAT_DOC_IDS.map((id) => getDoc(doc(db, 'games', gameId, 'private', id)))
  );
  return snaps.map((s) => (s.exists() ? s.data().hand : []));
}

// Ein Spielzug (Tichu-Ansage, Schupfen-Zuordnung, Karten spielen, Passen, Drache abgeben) als
// Ereignis anhängen. Jeder Teilnehmer verarbeitet dieselbe, geordnete Ereignisliste lokal mit
// derselben Engine (engine/game.js) - kein serverseitiges Prüfen der Zug-Gültigkeit (siehe
// README/Kommentare in firestore.rules), passt zum bereits dokumentierten Vertrauensmodell.
export async function postEvent(gameId, seatIndex, type, payload = {}) {
  await addDoc(collection(db, 'games', gameId, 'events'), {
    seatIndex,
    type,
    payload,
    createdAt: serverTimestamp(),
  });
}

export function watchEvents(gameId, callback) {
  const q = query(collection(db, 'games', gameId, 'events'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}
