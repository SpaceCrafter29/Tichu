// Kombinationen (Singles, Paare, Treppen, Straßen, Bomben, ...) erkennen und vergleichen.
import { MAHJONG, DRAGON, SPECIAL, rankOf } from './cards.js';

export const COMBO = {
  DOG: 'DOG',
  SINGLE: 'SINGLE',
  PAIR: 'PAIR',
  TRIPLE: 'TRIPLE',
  FULLHOUSE: 'FULLHOUSE',
  STAIRS: 'STAIRS',
  STRAIGHT: 'STRAIGHT',
  BOMB_QUAD: 'BOMB_QUAD',
  BOMB_STRAIGHTFLUSH: 'BOMB_STRAIGHTFLUSH',
};

function isPhoenix(c) {
  return c.special === SPECIAL.PHOENIX;
}
function isDog(c) {
  return c.special === SPECIAL.DOG;
}
function isDragon(c) {
  return c.special === SPECIAL.DRAGON;
}
function isMahjong(c) {
  return c.special === SPECIAL.MAHJONG;
}
// "normale" Karten für Paare/Drillinge/Treppen/Straßen/Bomben: Rang 2..14 mit Farbe,
// bzw. bei Straßen zusätzlich Mahjong (Rang 1) am unteren Ende.
function isPlainRanked(c) {
  return !c.special && c.rank >= 2 && c.rank <= 14;
}

function splitPhoenix(cards) {
  const naturals = cards.filter((c) => !isPhoenix(c));
  const hasPhoenix = naturals.length !== cards.length;
  return { naturals, hasPhoenix };
}

function countByRank(cards) {
  const counts = new Map();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
  return counts;
}

function isConsecutive(sortedRanks) {
  for (let i = 1; i < sortedRanks.length; i++) {
    if (sortedRanks[i] !== sortedRanks[i - 1] + 1) return false;
  }
  return true;
}

function tryBombStraightFlush(cards) {
  if (cards.length < 5) return null;
  if (cards.some((c) => c.special)) return null; // Phönix/Mahjong/Hund/Drache nie in einer Bombe
  const suit = cards[0].suit;
  if (!cards.every((c) => c.suit === suit)) return null;
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  if (new Set(ranks).size !== ranks.length) return null;
  if (!isConsecutive(ranks)) return null;
  return {
    type: COMBO.BOMB_STRAIGHTFLUSH,
    length: cards.length,
    isBomb: true,
    rank: ranks[ranks.length - 1],
    cards,
  };
}

function tryBombQuad(cards) {
  if (cards.length !== 4) return null;
  if (cards.some((c) => c.special)) return null;
  const rank = cards[0].rank;
  if (!cards.every((c) => c.rank === rank)) return null;
  return { type: COMBO.BOMB_QUAD, length: 4, isBomb: true, rank, cards };
}

function trySingle(cards) {
  if (cards.length !== 1) return null;
  const c = cards[0];
  if (isDog(c)) return { type: COMBO.DOG, length: 1, isBomb: false, rank: null, cards };
  if (isPhoenix(c)) return { type: COMBO.SINGLE, length: 1, isBomb: false, rank: null, isPhoenix: true, cards };
  return { type: COMBO.SINGLE, length: 1, isBomb: false, rank: rankOf(c), cards };
}

function tryPair(cards) {
  if (cards.length !== 2) return null;
  const { naturals, hasPhoenix } = splitPhoenix(cards);
  if (hasPhoenix) {
    if (naturals.length !== 1 || !isPlainRanked(naturals[0])) return null;
    return { type: COMBO.PAIR, length: 2, isBomb: false, rank: naturals[0].rank + 0.5, cards, isPhoenix: true };
  }
  if (naturals.length !== 2) return null;
  if (!naturals.every(isPlainRanked)) return null;
  if (naturals[0].rank !== naturals[1].rank) return null;
  return { type: COMBO.PAIR, length: 2, isBomb: false, rank: naturals[0].rank, cards };
}

function tryTriple(cards) {
  if (cards.length !== 3) return null;
  const { naturals, hasPhoenix } = splitPhoenix(cards);
  if (!naturals.every(isPlainRanked)) return null;
  if (hasPhoenix) {
    if (naturals.length !== 2 || naturals[0].rank !== naturals[1].rank) return null;
    return { type: COMBO.TRIPLE, length: 3, isBomb: false, rank: naturals[0].rank + 0.5, cards, isPhoenix: true };
  }
  if (naturals.length !== 3) return null;
  if (naturals[0].rank !== naturals[1].rank || naturals[1].rank !== naturals[2].rank) return null;
  return { type: COMBO.TRIPLE, length: 3, isBomb: false, rank: naturals[0].rank, cards };
}

function tryFullHouse(cards) {
  if (cards.length !== 5) return null;
  const { naturals, hasPhoenix } = splitPhoenix(cards);
  if (!naturals.every(isPlainRanked)) return null;
  if (hasPhoenix) {
    if (naturals.length !== 4) return null;
    const counts = countByRank(naturals);
    if (counts.size !== 2) return null;
    const entries = [...counts.entries()];
    const [rA, cA] = entries[0];
    const [rB, cB] = entries[1];
    if (cA === 3 && cB === 1) return { type: COMBO.FULLHOUSE, length: 5, isBomb: false, rank: rA, cards, isPhoenix: true };
    if (cB === 3 && cA === 1) return { type: COMBO.FULLHOUSE, length: 5, isBomb: false, rank: rB, cards, isPhoenix: true };
    if (cA === 2 && cB === 2) {
      const tripleRank = Math.max(rA, rB); // Phönix ergänzt das höhere Paar zum Drilling
      return { type: COMBO.FULLHOUSE, length: 5, isBomb: false, rank: tripleRank, cards, isPhoenix: true };
    }
    return null;
  }
  if (naturals.length !== 5) return null;
  const counts = countByRank(naturals);
  if (counts.size !== 2) return null;
  const entries = [...counts.entries()];
  const triple = entries.find(([, c]) => c === 3);
  const pair = entries.find(([, c]) => c === 2);
  if (!triple || !pair) return null;
  return { type: COMBO.FULLHOUSE, length: 5, isBomb: false, rank: triple[0], cards };
}

function tryStairs(cards) {
  if (cards.length < 4 || cards.length % 2 !== 0) return null;
  const { naturals, hasPhoenix } = splitPhoenix(cards);
  if (!naturals.every(isPlainRanked)) return null;
  const desiredPairs = cards.length / 2;
  const counts = countByRank(naturals);
  if (hasPhoenix) {
    const withOne = [...counts.entries()].filter(([, c]) => c === 1);
    const withTwo = [...counts.entries()].filter(([, c]) => c === 2);
    if (withOne.length + withTwo.length !== counts.size) return null; // jede Zählung muss 1 oder 2 sein
    if (withOne.length !== 1) return null;
    if (counts.size !== desiredPairs) return null;
  } else {
    if (naturals.length !== cards.length) return null;
    if ([...counts.values()].some((c) => c !== 2)) return null;
    if (counts.size !== desiredPairs) return null;
  }
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  if (!isConsecutive(ranks)) return null;
  return { type: COMBO.STAIRS, length: cards.length, isBomb: false, rank: ranks[ranks.length - 1], cards, isPhoenix: hasPhoenix };
}

function tryStraight(cards) {
  if (cards.length < 5) return null;
  const { naturals, hasPhoenix } = splitPhoenix(cards);
  const eligible = (c) => isPlainRanked(c) || isMahjong(c);
  if (!naturals.every(eligible)) return null;
  const ranks = naturals.map((c) => c.rank);
  if (new Set(ranks).size !== ranks.length) return null; // keine doppelten Ränge in einer Straße
  const len = cards.length;
  if (!hasPhoenix) {
    if (naturals.length !== len) return null;
    const sorted = ranks.slice().sort((a, b) => a - b);
    if (!isConsecutive(sorted)) return null;
    return { type: COMBO.STRAIGHT, length: len, isBomb: false, rank: sorted[sorted.length - 1], cards };
  }
  if (naturals.length !== len - 1) return null;
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  for (let start = Math.max(1, max - len + 1); start <= min; start++) {
    const end = start + len - 1;
    if (end > 14) continue;
    if (max > end) continue;
    const inWindow = ranks.every((r) => r >= start && r <= end);
    if (!inWindow) continue;
    const windowSize = end - start + 1;
    if (windowSize - naturals.length === 1) {
      return { type: COMBO.STRAIGHT, length: len, isBomb: false, rank: end, cards, isPhoenix: true };
    }
  }
  return null;
}

// Erkennt die Kombination einer Kartenauswahl. Gibt null zurück, wenn die Auswahl ungültig ist.
export function classify(cards) {
  if (!cards || cards.length === 0) return null;
  if (cards.length === 1) return trySingle(cards);
  if (cards.length === 2) return tryPair(cards);
  if (cards.length === 3) return tryTriple(cards);
  return (
    tryBombStraightFlush(cards) ||
    tryBombQuad(cards) ||
    tryFullHouse(cards) ||
    tryStairs(cards) ||
    tryStraight(cards) ||
    null
  );
}

// Kann `candidate` die aktuell liegende Kombination `current` schlagen?
// current === null bedeutet: candidate eröffnet den Stich (jede gültige Kombination außer nichts ist erlaubt).
export function canBeat(candidate, current) {
  if (!candidate) return false;
  if (candidate.type === COMBO.DOG) return current === null; // Hund darf nur ausgespielt (angespielt) werden
  if (current === null) return true;
  if (current.type === COMBO.DOG) return false; // auf den Hund kann nichts gespielt werden (Stich geht sofort weiter)

  if (candidate.isBomb && !current.isBomb) return true;
  if (candidate.isBomb && current.isBomb) {
    if (candidate.type === COMBO.BOMB_STRAIGHTFLUSH && current.type === COMBO.BOMB_QUAD) return true;
    if (candidate.type === COMBO.BOMB_QUAD && current.type === COMBO.BOMB_STRAIGHTFLUSH) return false;
    if (candidate.type === COMBO.BOMB_STRAIGHTFLUSH && current.type === COMBO.BOMB_STRAIGHTFLUSH) {
      if (candidate.length !== current.length) return candidate.length > current.length;
      return candidate.rank > current.rank;
    }
    // beides BOMB_QUAD
    return candidate.rank > current.rank;
  }
  if (!candidate.isBomb && current.isBomb) return false;

  if (candidate.type !== current.type) return false;
  if (candidate.length !== current.length) return false;

  if (candidate.type === COMBO.SINGLE) {
    const candValue = resolveSingleValue(candidate, current);
    const curValue = resolveSingleValue(current, null);
    return candValue > curValue;
  }
  return candidate.rank > current.rank;
}

// Löst den effektiven Vergleichswert eines Single auf (relevant für den Phönix).
// `against` ist die Kombination, die geschlagen werden soll (oder null, wenn `combo` selbst der Tischstand ist).
export function resolveSingleValue(combo, against) {
  if (combo.type !== COMBO.SINGLE) return combo.rank;
  if (!combo.isPhoenix) return combo.rank;
  if (against === null) return 1; // als Anspiel ist der Phönix nur 1 wert
  return resolveSingleValue(against, null) + 0.5;
}

export function isDragonSingle(combo) {
  return combo.type === COMBO.SINGLE && combo.cards.length === 1 && combo.cards[0].special === SPECIAL.DRAGON;
}

export { MAHJONG, DRAGON };
