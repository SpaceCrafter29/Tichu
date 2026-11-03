// Faires, gemeinsames Austeilen ohne Server.
//
// Problem vorher: Wer die Karten austeilte (der vierte Spieler am Tisch bzw. wer zuletzt "bereit"
// drückte), mischte im eigenen Browser und sah dabei alle Hände - er hätte sich z. B. immer den
// Mahjong geben können. Jetzt würfeln ALLE VIER mit (Commit-Reveal):
//   1. Jeder Spieler erzeugt einen geheimen Zufallswert und veröffentlicht nur dessen Hash
//      (`dealCommit`). Damit ist er festgelegt, verrät aber noch nichts.
//   2. Erst wenn alle vier Hashes da sind, deckt jeder seinen Wert auf (`dealReveal`).
//   3. Aus allen vier Werten wird das Mischen deterministisch berechnet - jeder Browser kommt auf
//      dieselben Hände, und kein Einzelner kann sie bestimmen: Wer als Letzter aufdeckt, kennt zwar
//      das Ergebnis, kann seinen Wert aber nicht mehr ändern (nur noch durch Nicht-Aufdecken den
//      Tisch anhalten, was für alle sichtbar ist).
// Alles hier ist reine Logik (kein Browser nötig) und wird von board.html und den Tests benutzt.
import { createDeck, shuffle, deal } from './cards.js';

// ---- SHA-256 (synchron, damit replay() in board.html synchron bleibt) --------------------------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256Hex(str) {
  const msg = new TextEncoder().encode(String(str));
  const len = msg.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 4294967296));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// ---- Zufallswerte, Hashes, Mischen -------------------------------------------------------------
export const SECRET_RE = /^[0-9a-f]{64}$/;

export function newSecret() {
  const a = new Uint8Array(32);
  globalThis.crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// An Spiel, Austeilung (slot) und Sitz gebunden: ein Hash lässt sich nicht für einen anderen Sitz wiederverwenden.
export const commitHash = (gameId, slot, seat, secret) => sha256Hex(`tichu-commit|${gameId}|${slot}|${seat}|${secret}`);
export const dealSeed = (gameId, slot, secrets) => sha256Hex(`tichu-deal|${gameId}|${slot}|${secrets.join('|')}`);

// Zufallszahlen aus dem Seed: SHA-256 im Zählermodus, je Block acht Zahlen in [0, 1).
export function seededRandom(seedHex) {
  let block = 0;
  let buf = [];
  let pos = 0;
  return () => {
    if (pos >= buf.length) {
      const hex = sha256Hex(`${seedHex}:${block++}`);
      buf = [];
      for (let i = 0; i < 64; i += 8) buf.push(parseInt(hex.slice(i, i + 8), 16));
      pos = 0;
    }
    return buf[pos++] / 4294967296;
  };
}

// { first8, rest6 }: erst 8 Karten (Große-Tichu-Entscheidung), dann die restlichen 6 - wie bisher.
export function fairDeal(seedHex) {
  const { first8, rest6 } = deal(shuffle(createDeck(), seededRandom(seedHex)));
  return { first8, rest6 };
}

// ---- Regeln für die Ereignisse -----------------------------------------------------------------
export const emptyDeal = () => ({ commits: {}, reveals: {} });
export const dealComplete = (st) => [0, 1, 2, 3].every((i) => st.reveals[i] !== undefined);
export const dealFromReveals = (gameId, slot, st) => fairDeal(dealSeed(gameId, slot, [0, 1, 2, 3].map((i) => st.reveals[i])));

// Wendet ein dealCommit-/dealReveal-Ereignis auf den Stand der aktuellen Austeilung an und sagt, ob es
// gültig war. Ungültiges wird einfach ignoriert (falscher slot, doppelt, zu früh, falscher Wert).
// Aufdecken zählt erst, wenn alle vier Hashes schon da sind - sonst könnte jemand, der spät festlegt,
// seinen Wert noch an die bereits sichtbaren anderen anpassen.
export function applyDealEvent(st, ev, gameId, slot) {
  const seat = ev.seatIndex;
  const p = ev.payload || {};
  if (!Number.isInteger(seat) || seat < 0 || seat > 3 || p.slot !== slot) return false;
  if (ev.type === 'dealCommit') {
    if (st.commits[seat] !== undefined || typeof p.c !== 'string' || !SECRET_RE.test(p.c)) return false;
    st.commits[seat] = p.c;
    return true;
  }
  if (ev.type === 'dealReveal') {
    if (Object.keys(st.commits).length < 4 || st.reveals[seat] !== undefined) return false;
    if (typeof p.s !== 'string' || !SECRET_RE.test(p.s) || commitHash(gameId, slot, seat, p.s) !== st.commits[seat]) return false;
    st.reveals[seat] = p.s;
    return true;
  }
  return false;
}
