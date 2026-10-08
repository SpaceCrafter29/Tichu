// Turnier-Tracker: Accounts/Spielplan/Tabelle über echte, stabile Benutzername+Passwort-Konten
// (siehe tournamentAuth.js). Turnier-Tische sind normale games/{id}-Dokumente (mode:'tournament'),
// nur mit vorab vom Admin zugewiesenen Sitzen (seatUids) statt freier Sitzwahl - das eigentliche
// Spiel läuft komplett unverändert über board.html/engine.
import { db } from './firebase-config.js';
import {
  collection, doc, addDoc, getDocs, setDoc, updateDoc, onSnapshot, query, where,
  runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
import { SEAT_DOC_IDS, dealFreshRound } from './lobby.js';

const WORDS = [
  'kirsche', 'apfel', 'birne', 'pflaume', 'mango', 'kiwi', 'feige', 'limette',
  'dattel', 'quitte', 'banane', 'orange', 'zitrone', 'erdbeere', 'himbeere', 'brombeere',
  'traube', 'melone', 'ananas', 'papaya', 'maracuja', 'litschi', 'guave', 'kokos',
  'nektarine', 'pfirsich', 'aprikose', 'mandarine', 'pomelo', 'kaki', 'mirabelle', 'holunder',
  'cranberry', 'kumquat', 'physalis', 'avocado', 'olive',
];
export function genPassword() {
  return WORDS[Math.floor(Math.random() * WORDS.length)] + '-' + (10 + Math.floor(Math.random() * 90));
}

function randomToken() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function watchPlayers(callback) {
  return onSnapshot(collection(db, 'players'), (snap) => {
    callback(snap.docs.map((d) => ({ uid: d.id, ...d.data() })));
  });
}

export function watchSchedules(callback) {
  return onSnapshot(collection(db, 'schedule'), (snap) => {
    const days = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.day - b.day);
    callback(days);
  });
}

// Gelieferte Spiele haben `seatUids` bereits aufgelöst (siehe resolveSeatUids): bei einem
// vorab angelegten Folge-Tisch (Turnierbaum) ist es null, solange die Quell-Tische noch nicht
// entschieden sind, und füllt sich von selbst, sobald sie es sind.
export function watchTournamentGames(callback) {
  const q = query(collection(db, 'games'), where('mode', '==', 'tournament'));
  return onSnapshot(q, (snap) => {
    const raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byId = Object.fromEntries(raw.map((g) => [g.id, g]));
    callback(raw.map((g) => ({ ...g, seatUids: resolveSeatUids(g, byId) })));
  });
}

// Welche vier uids sitzen an diesem Tisch (Sitz 0+2 = Team A, Sitz 1+3 = Team B)? Bei
// normalen Tischen steht das direkt im Dokument. Ein Turnierbaum-Tisch hat stattdessen
// `sourceGameIds` (zwei Vorrunden-Tische): sobald beide ein Gewinner-Paar haben, werden die
// Gewinner gemischt - je eine Person aus jedem Paar bildet ein NEUES Team (Sitz 0+2 und 1+3).
// Wird nur beim Lesen abgeleitet, nichts davon muss jemand in die Datenbank schreiben.
export function resolveSeatUids(game, byId) {
  if (Array.isArray(game.seatUids)) return game.seatUids;
  const src = (game.sourceGameIds || []).map((id) => byId[id]);
  if (src.length !== 2 || src.some((s) => !s)) return null;
  const wa = winningPair({ ...src[0], seatUids: resolveSeatUids(src[0], byId) });
  const wb = winningPair({ ...src[1], seatUids: resolveSeatUids(src[1], byId) });
  if (!wa || !wb) return null;
  return [wa[0], wa[1], wb[0], wb[1]]; // Team A = Sitz 0+2 = wa[0]+wb[0], Team B = Sitz 1+3 = wa[1]+wb[1]
}

// Legt für eine Runde die Tische an: pro Tisch ein echtes games/{id}-Dokument, danach das
// schedule/{day}-Dokument mit den entstandenen gameIds.
// `tables`: [{ seatUids: [uid,uid,uid,uid], winCondition }] - fest zugewiesene Sitze, oder
// [{ sourceGameIds: [gameId, gameId], winCondition }] - Turnierbaum-Tisch, dessen Besetzung sich
// erst aus den Ergebnissen dieser beiden Tische ergibt (siehe resolveSeatUids).
export async function saveSchedule(day, tables) {
  const created = [];
  for (const t of tables) {
    const derived = !t.seatUids;
    const ref = await addDoc(collection(db, 'games'), {
      status: 'waiting',
      createdAt: serverTimestamp(),
      seats: [null, null, null, null],
      seatUids: derived ? null : t.seatUids,
      ...(derived ? { sourceGameIds: t.sourceGameIds } : {}),
      winCondition: t.winCondition,
      name: `Runde ${day}`,
      mode: 'tournament',
      catchUpRule: false,
    });
    created.push({ gameId: ref.id, seatUids: derived ? null : t.seatUids });
  }
  await setDoc(doc(db, 'schedule', String(day)), {
    day,
    tables: created,
    createdAt: serverTimestamp(),
  });
  return created;
}

// Admin: die Besetzung eines schon gespeicherten Tisches ändern - solange noch nicht
// ausgeteilt wurde (Status 'waiting'). Wer schon Platz genommen hat, wird dabei wieder
// ausgetragen (alle müssen den Tisch danach neu betreten). Passt auch den Eintrag im
// Spielplan an, damit beide übereinstimmen.
export async function adminChangeSeats(gameId, seatUids) {
  if (seatUids.length !== 4 || seatUids.some((u) => !u) || new Set(seatUids).size !== 4) {
    throw new Error('Es braucht vier verschiedene Spieler.');
  }
  const gameRef = doc(db, 'games', gameId);
  let oldSeats;
  const step = async (label, fn) => { try { return await fn(); } catch (e) { throw new Error(`${label}: ${e.message || e}`); } };
  await step('Tisch ändern', () => runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Tisch existiert nicht mehr.');
    const g = snap.data();
    if (!Array.isArray(g.seatUids)) throw new Error('Dieser Tisch ergibt sich aus der Vorrunde und hat keine festen Sitze.');
    if (g.status !== 'waiting') throw new Error('Das Spiel an diesem Tisch hat schon begonnen.');
    oldSeats = g.seats;
    tx.update(gameRef, { seatUids, seats: [null, null, null, null] });
  }));
  // Die privaten Sitz-Dokumente einzeln löschen (jede Löschung prüft in den Regeln mehrere
  // Dokumente nach - mehrere davon in einer Anfrage würden das Abfrage-Limit sprengen).
  for (let i = 0; i < 4; i++) {
    if (oldSeats[i] != null) await step('Sitz freigeben', () => deleteDoc(doc(db, 'games', gameId, 'private', SEAT_DOC_IDS[i])));
  }
  // Ereignisse einer früheren Partie an diesem Tisch räumen - sonst würden sie beim Nachspielen
  // der neuen Partie mitverarbeitet (derselbe Tisch wird wiederverwendet).
  await step('Alte Züge löschen', async () => {
    const evs = await getDocs(collection(db, 'games', gameId, 'events'));
    for (let i = 0; i < evs.docs.length; i += 400) {
      const batch = writeBatch(db);
      evs.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  });
  const scheds = await getDocs(collection(db, 'schedule'));
  for (const d of scheds.docs) {
    const tables = d.data().tables || [];
    if (!tables.some((t) => t.gameId === gameId)) continue;
    await step('Spielplan', () => updateDoc(d.ref, { tables: tables.map((t) => (t.gameId === gameId ? { ...t, seatUids } : t)) }));
  }
}

// Admin-Notweg: Endergebnis von Hand eintragen, falls die Spieler es nicht selbst festhalten
// konnten (z. B. alle hatten das Spielbrett schon geschlossen). Dieselbe Form wie
// finishTournamentMatch(), nur ohne die Einmal-Bedingung (die Admin darf überschreiben).
export async function adminSetResult(gameId, scoreA, scoreB) {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA === scoreB) {
    throw new Error('Zwei ganze Zahlen, die nicht gleich sind.');
  }
  await updateDoc(doc(db, 'games', gameId), {
    status: 'finished',
    result: { scoreA, scoreB, winnerTeam: scoreA > scoreB ? 'A' : 'B', finishedAt: serverTimestamp(), manual: true },
  });
}

// Turnier-Pendant zu joinTable() in lobby.js: statt des nächsten freien Sitzes wird genau der
// Sitz beansprucht, den der Spielplan dieser uid zugewiesen hat (siehe isAssignedSeatClaim() in
// firestore.rules). Mischt/verteilt analog, sobald der vierte (letzte) Sitz gefüllt wird.
export async function joinAssignedSeat(gameId, uid) {
  const gameRef = doc(db, 'games', gameId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists()) throw new Error('Tisch existiert nicht mehr.');
    const data = snap.data();
    let seatUids = data.seatUids;
    if (!Array.isArray(seatUids)) {
      // Turnierbaum-Tisch: Besetzung erst aus den Ergebnissen der Quell-Tische ableiten.
      const byId = {};
      const load = async (g) => {
        for (const id of g.sourceGameIds || []) {
          if (byId[id]) continue;
          const s = await tx.get(doc(db, 'games', id));
          if (s.exists()) { byId[id] = { id, ...s.data() }; await load(byId[id]); }
        }
      };
      await load(data);
      seatUids = resolveSeatUids(data, byId);
      if (!seatUids) throw new Error('Dieser Tisch wird erst nach den Ergebnissen der Vorrunde freigegeben.');
    }
    const seatIndex = seatUids.indexOf(uid);
    if (seatIndex === -1) throw new Error('Du bist diesem Tisch nicht zugewiesen.');
    const seats = data.seats.slice();
    if (seats[seatIndex] != null) {
      return { seatIndex, allFilled: seats.every((s) => s != null), alreadyJoined: true };
    }
    seats[seatIndex] = randomToken();
    const allFilled = seats.every((s) => s != null);
    const mySeatRef = doc(db, 'games', gameId, 'private', SEAT_DOC_IDS[seatIndex]);
    let myHand = [];
    let myRest = [];
    if (allFilled) {
      const { first8, rest6 } = dealFreshRound();
      myHand = first8[seatIndex];
      myRest = rest6[seatIndex];
      for (let s = 0; s < 4; s++) {
        if (s === seatIndex) continue;
        tx.update(doc(db, 'games', gameId, 'private', SEAT_DOC_IDS[s]), { hand: first8[s], restHand: rest6[s] });
      }
    }
    tx.set(mySeatRef, {
      claimedByUid: uid, anonToken: seats[seatIndex], joinedAt: serverTimestamp(),
      hand: myHand, restHand: myRest, lastActive: serverTimestamp(),
    });
    tx.update(gameRef, { seats, status: allFilled ? 'dealt' : 'waiting' });
    return { seatIndex, allFilled, alreadyJoined: false };
  });
}

// Schreibt das Endergebnis genau einmal (siehe firestore.rules: result darf nur gesetzt werden,
// solange es noch null ist) - jeder der vier Mitspieler kann das auslösen, sobald das Match auf
// seinem Client als beendet erscheint; ein zweiter, fast gleichzeitiger Versuch scheitert dann
// einfach harmlos an der Regel.
export async function finishTournamentMatch(gameId, scoreA, scoreB) {
  const winnerTeam = scoreA === scoreB ? null : (scoreA > scoreB ? 'A' : 'B');
  await updateDoc(doc(db, 'games', gameId), {
    status: 'finished',
    result: { scoreA, scoreB, winnerTeam, finishedAt: serverTimestamp() },
  });
}

// Das Gewinner-Paar eines beendeten Tisches (die zwei uids). null, solange der Tisch nicht
// beendet ist, noch keine Besetzung hat oder unentschieden ausgegangen ist.
export function winningPair(game) {
  if (!game.result || !game.seatUids || game.result.winnerTeam == null) return null;
  return game.result.winnerTeam === 'A' ? [game.seatUids[0], game.seatUids[2]] : [game.seatUids[1], game.seatUids[3]];
}

// Sitz 0+2 = Team A, Sitz 1+3 = Team B (wie teamOf() im Engine).
export function computeStandings(players, games) {
  const rows = players.map((p) => ({ uid: p.uid, name: p.username, wins: 0, matches: 0 }));
  const byUid = Object.fromEntries(rows.map((r) => [r.uid, r]));
  for (const g of games) {
    if (!g.result || !g.seatUids || g.result.winnerTeam == null) continue;
    const teamA = [g.seatUids[0], g.seatUids[2]];
    const teamB = [g.seatUids[1], g.seatUids[3]];
    const aWon = g.result.winnerTeam === 'A';
    for (const uid of teamA) { const r = byUid[uid]; if (r) { r.matches++; if (aWon) r.wins++; } }
    for (const uid of teamB) { const r = byUid[uid]; if (r) { r.matches++; if (!aWon) r.wins++; } }
  }
  rows.forEach((r) => { r.losses = r.matches - r.wins; });
  rows.forEach((r) => {
    r.place = 1 + rows.filter((o) => o.wins > r.wins).length;
    r.shared = rows.filter((o) => o.wins === r.wins).length > 1;
  });
  rows.sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  return rows;
}
