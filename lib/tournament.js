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

const WORDS = ['kirsche', 'apfel', 'birne', 'pflaume', 'mango', 'kiwi', 'feige', 'limette', 'dattel', 'quitte'];
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

export function watchTournamentGames(callback) {
  const q = query(collection(db, 'games'), where('mode', '==', 'tournament'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// Legt für einen Spieltag die Tische an: pro Tisch ein echtes games/{id}-Dokument mit
// zugewiesenen seatUids, danach das schedule/{day}-Dokument mit den entstandenen gameIds.
// `tables`: [{ seatUids: [uid,uid,uid,uid], winCondition }]
export async function saveSchedule(day, tables) {
  const created = [];
  for (const t of tables) {
    const ref = await addDoc(collection(db, 'games'), {
      status: 'waiting',
      createdAt: serverTimestamp(),
      seats: [null, null, null, null],
      seatUids: t.seatUids,
      winCondition: t.winCondition,
      name: `Spieltag ${day}`,
      mode: 'tournament',
      catchUpRule: false,
    });
    created.push({ gameId: ref.id, seatUids: t.seatUids });
  }
  await setDoc(doc(db, 'schedule', String(day)), {
    day,
    tables: created,
    createdAt: serverTimestamp(),
  });
  return created;
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
    const seatIndex = (data.seatUids || []).indexOf(uid);
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

// Das Gewinner-Team eines beendeten Tisches (die zwei uids, nicht welches Team - wird für die
// Turnierbaum-Mischung in nextRoundTables() gebraucht). null, solange der Tisch nicht beendet
// ist oder unentschieden ausgegangen ist.
export function winningPair(game) {
  if (!game.result || !game.seatUids || game.result.winnerTeam == null) return null;
  return game.result.winnerTeam === 'A' ? [game.seatUids[0], game.seatUids[2]] : [game.seatUids[1], game.seatUids[3]];
}

// Turnierbaum: aus je zwei aufeinanderfolgenden Tischen einer Runde wird EIN Tisch der
// nächsten Runde - die beiden Gewinner-Teams werden dabei gemischt (je eine Person aus jedem
// Gewinner-Team bildet ein NEUES Team), nicht einfach als dieselben Paare weitergereicht. Bei
// einer ungeraden Tischzahl bekommt das letzte Gewinner-Team ein Freilos (kommt direkt mit
// unveränderter Paarung in die nächste Runde). Erwartet `tables` in Tisch-Reihenfolge, alle
// bereits beendet - sonst wird der entsprechende Tisch ausgelassen.
export function nextRoundTables(tables) {
  const next = [];
  for (let i = 0; i < tables.length; i += 2) {
    const wa = winningPair(tables[i]);
    if (!wa) continue;
    if (i + 1 >= tables.length) { next.push({ seats: [wa[0], wa[1], '', ''], bye: true }); continue; }
    const wb = winningPair(tables[i + 1]);
    if (!wb) continue;
    next.push({ seats: [wa[0], wa[1], wb[0], wb[1]] });
  }
  return next;
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
