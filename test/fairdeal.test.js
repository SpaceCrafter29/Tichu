import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  sha256Hex, newSecret, commitHash, dealSeed, seededRandom, fairDeal,
  emptyDeal, applyDealEvent, dealComplete, dealFromReveals, SECRET_RE,
} from '../engine/fairdeal.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

test('SHA-256 stimmt mit Node überein (leer, kurz, Blockgrenzen, lang, Umlaute)', () => {
  const samples = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'x'.repeat(1000), 'Größe ✓ 龍', 'tichu-deal|g|0|' + 'f'.repeat(64)];
  for (const s of samples) assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'), JSON.stringify(s.slice(0, 20)));
  for (let i = 0; i < 200; i++) {
    const s = randomBytes(1 + Math.floor(Math.random() * 300)).toString('latin1');
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('Zufallswert: 64 Hex-Zeichen, jedes Mal anders', () => {
  const a = newSecret(), b = newSecret();
  assert.match(a, SECRET_RE);
  assert.notEqual(a, b);
});

test('Austeilen aus demselben Seed ist überall identisch; anderer Seed -> andere Karten', () => {
  const seed = dealSeed('spiel1', 0, ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]);
  const x = fairDeal(seed), y = fairDeal(seed);
  assert.deepEqual(x, y);
  const other = fairDeal(dealSeed('spiel1', 0, ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'e'.repeat(64)]));
  assert.notDeepEqual(x.first8.map((h) => h.map((c) => c.id)), other.first8.map((h) => h.map((c) => c.id)));
  // 56 verschiedene Karten, 8 + 6 je Spieler
  const ids = new Set([...x.first8.flat(), ...x.rest6.flat()].map((c) => c.id));
  assert.equal(ids.size, 56);
  for (let p = 0; p < 4; p++) { assert.equal(x.first8[p].length, 8); assert.equal(x.rest6[p].length, 6); }
});

test('Seed hängt an Spiel und Austeilung (slot) - gleiche Beiträge, anderes Spiel/Runde, andere Karten', () => {
  const sec = ['1'.repeat(64), '2'.repeat(64), '3'.repeat(64), '4'.repeat(64)];
  assert.notEqual(dealSeed('A', 0, sec), dealSeed('B', 0, sec));
  assert.notEqual(dealSeed('A', 0, sec), dealSeed('A', 1, sec));
  assert.notEqual(commitHash('A', 0, 1, sec[0]), commitHash('A', 0, 2, sec[0]));
});

test('Gleichverteilung: der Mahjong landet bei zufälligen Beiträgen in jedem Sitz ~25 %', () => {
  const N = 6000, cnt = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const { first8, rest6 } = fairDeal(dealSeed('g', i, [newSecret(), newSecret(), newSecret(), newSecret()]));
    for (let p = 0; p < 4; p++) if ([...first8[p], ...rest6[p]].some((c) => c.special === 'MAHJONG')) cnt[p]++;
  }
  for (const c of cnt) assert.ok(Math.abs(c / N - 0.25) < 0.025, `Anteil ${c / N}`);
});

test('Kein Einzelner bestimmt das Ergebnis: bei festen drei Beiträgen hängt der Mahjong-Sitz vom vierten ab (jeder Sitz kommt vor)', () => {
  const fixed = [newSecret(), newSecret(), newSecret()];
  const seats = new Set();
  for (let i = 0; i < 400 && seats.size < 4; i++) {
    const { first8, rest6 } = fairDeal(dealSeed('g', 0, [...fixed, newSecret()]));
    for (let p = 0; p < 4; p++) if ([...first8[p], ...rest6[p]].some((c) => c.special === 'MAHJONG')) seats.add(p);
  }
  assert.equal(seats.size, 4);
});

// ---- Ablauf Commit/Reveal ----
function commitEv(gameId, slot, seat, secret) { return { type: 'dealCommit', seatIndex: seat, payload: { slot, c: commitHash(gameId, slot, seat, secret) } }; }
function revealEv(slot, seat, secret) { return { type: 'dealReveal', seatIndex: seat, payload: { slot, s: secret } }; }

test('Normaler Ablauf: vier Commits, vier Reveals -> vollständig, Hände = fairDeal(Seed)', () => {
  const G = 'tisch', sec = [0, 1, 2, 3].map(() => newSecret()), st = emptyDeal();
  for (let s = 0; s < 4; s++) assert.equal(applyDealEvent(st, commitEv(G, 0, s, sec[s]), G, 0), true);
  for (let s = 0; s < 4; s++) { assert.equal(dealComplete(st), false); assert.equal(applyDealEvent(st, revealEv(0, s, sec[s]), G, 0), true); }
  assert.equal(dealComplete(st), true);
  assert.deepEqual(dealFromReveals(G, 0, st), fairDeal(dealSeed(G, 0, sec)));
});

test('Aufdecken vor dem vierten Commit zählt nicht', () => {
  const G = 'g', sec = [0, 1, 2, 3].map(() => newSecret()), st = emptyDeal();
  for (let s = 0; s < 3; s++) applyDealEvent(st, commitEv(G, 0, s, sec[s]), G, 0);
  assert.equal(applyDealEvent(st, revealEv(0, 0, sec[0]), G, 0), false);
  applyDealEvent(st, commitEv(G, 0, 3, sec[3]), G, 0);
  assert.equal(applyDealEvent(st, revealEv(0, 0, sec[0]), G, 0), true); // jetzt ja
});

test('Falscher Wert, fremder Sitz, doppelter Commit/Reveal, falscher slot, Müll werden ignoriert', () => {
  const G = 'g', sec = [0, 1, 2, 3].map(() => newSecret()), st = emptyDeal();
  assert.equal(applyDealEvent(st, commitEv(G, 1, 0, sec[0]), G, 0), false); // falscher slot
  assert.equal(applyDealEvent(st, { type: 'dealCommit', seatIndex: 0, payload: { slot: 0, c: 'zz' } }, G, 0), false);
  assert.equal(applyDealEvent(st, { type: 'dealCommit', seatIndex: 7, payload: { slot: 0, c: 'a'.repeat(64) } }, G, 0), false);
  assert.equal(applyDealEvent(st, { type: 'dealCommit', seatIndex: 0 }, G, 0), false);
  for (let s = 0; s < 4; s++) assert.equal(applyDealEvent(st, commitEv(G, 0, s, sec[s]), G, 0), true);
  assert.equal(applyDealEvent(st, commitEv(G, 0, 0, newSecret()), G, 0), false); // zweiter Commit desselben Sitzes
  assert.equal(applyDealEvent(st, revealEv(0, 1, sec[2]), G, 0), false); // Wert eines anderen Sitzes
  assert.equal(applyDealEvent(st, revealEv(0, 1, newSecret()), G, 0), false); // passt nicht zum Hash
  assert.equal(applyDealEvent(st, revealEv(0, 1, sec[1]), G, 0), true);
  assert.equal(applyDealEvent(st, revealEv(0, 1, sec[1]), G, 0), false); // doppelt
  assert.equal(st.commits[0], commitHash(G, 0, 0, sec[0])); // der erste Commit bleibt
});

test('Gleiche Beiträge in einem anderen Spiel/einer anderen Runde sind ungültig (kein Wiederverwenden)', () => {
  const sec = newSecret();
  const st = emptyDeal();
  for (let s = 0; s < 4; s++) applyDealEvent(st, commitEv('A', 0, s, sec), 'A', 0);
  assert.equal(applyDealEvent(st, revealEv(0, 0, sec), 'B', 0), false);
});

console.log(`\n${passed} Tests bestanden.`);
