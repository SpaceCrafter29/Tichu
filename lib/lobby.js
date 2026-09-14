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
  onSnapshot,
  query,
  where,
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

export function watchOpenGames(callback) {
  const q = query(collection(db, 'games'), where('status', '==', 'waiting'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Alle Tische, unabhängig vom Status - nur für die Orga-Admin-Ansicht (Kicken).
export function watchAllGames(callback) {
  return onSnapshot(collection(db, 'games'), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function createTable(target = 1000) {
  const ref = await addDoc(collection(db, 'games'), {
    status: 'waiting',
    createdAt: serverTimestamp(),
    seats: [null, null, null, null],
    target,
    name: randomTableName(),
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

// Nur die Turnier-Orga darf das (siehe firestore.rules: isOrganizer()). Entfernt Token und
// private Hand eines Sitzes vollständig und öffnet den Tisch wieder zum Beitreten.
export async function kickSeat(gameId, seatIndex) {
  const gameRef = doc(db, 'games', gameId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Tisch existiert nicht mehr.');
    const seats = snap.data().seats.slice();
    if (seats[seatIndex] == null) return;
    seats[seatIndex] = null;
    const seatRef = doc(db, 'games', gameId, 'private', SEAT_DOC_IDS[seatIndex]);
    tx.delete(seatRef);
    tx.update(gameRef, { seats, status: 'waiting' });
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
