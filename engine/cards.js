// Kartenmodell für Tichu: 52 normale Karten (4 Farben x 2..A) + 4 Sonderkarten.

export const SUITS = ['Jade', 'Schwert', 'Pagode', 'Stern']; // grün, schwarz, blau, rot

export const MAHJONG = 1;
export const DRAGON = 15;
// Phoenix und Hund haben keinen festen Rang (rank: null) und keine Farbe.

export const SPECIAL = {
  MAHJONG: 'MAHJONG',
  PHOENIX: 'PHOENIX',
  DOG: 'DOG',
  DRAGON: 'DRAGON',
};

const RANK_LABEL = { 1: 'Mahjong', 11: 'B', 12: 'D', 13: 'K', 14: 'As', 15: 'Drache' };
function rankLabel(rank) {
  return RANK_LABEL[rank] || String(rank);
}

let nextId = 1;
function makeCard(fields) {
  return { id: nextId++, ...fields };
}

// Kartenwert in Punkten (für die Rundenwertung).
export function cardPoints(card) {
  if (card.special === SPECIAL.DRAGON) return 25;
  if (card.special === SPECIAL.PHOENIX) return -25;
  if (card.special === SPECIAL.MAHJONG || card.special === SPECIAL.DOG) return 0;
  if (card.rank === 5) return 5;
  if (card.rank === 10 || card.rank === 13) return 10;
  return 0;
}

export function createDeck() {
  nextId = 1;
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push(makeCard({ suit, rank, special: null, name: `${rankLabel(rank)} ${suit}` }));
    }
  }
  deck.push(makeCard({ suit: null, rank: MAHJONG, special: SPECIAL.MAHJONG, name: 'Mahjong' }));
  deck.push(makeCard({ suit: null, rank: null, special: SPECIAL.PHOENIX, name: 'Phönix' }));
  deck.push(makeCard({ suit: null, rank: null, special: SPECIAL.DOG, name: 'Hund' }));
  deck.push(makeCard({ suit: null, rank: DRAGON, special: SPECIAL.DRAGON, name: 'Drache' }));
  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const arr = deck.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Teilt 56 Karten auf 4 Spieler auf: erst 8 (für die Grand-Tichu-Entscheidung), dann 6 weitere.
export function deal(deck) {
  if (deck.length !== 56) throw new Error('Deck muss 56 Karten haben');
  const hands = [[], [], [], []];
  for (let round = 0; round < 14; round++) {
    for (let p = 0; p < 4; p++) {
      hands[p].push(deck[round * 4 + p]);
    }
  }
  const first8 = hands.map((h) => h.slice(0, 8));
  const rest6 = hands.map((h) => h.slice(8, 14));
  return { hands, first8, rest6 };
}

export function sortHand(cards) {
  return cards.slice().sort((a, b) => rankOf(a) - rankOf(b));
}

// Rang zur Sortierung/Vergleich: Mahjong=1, Phönix knapp über Mahjong, Hund darunter (wird eh nie sortiert gespielt).
export function rankOf(card) {
  if (card.special === SPECIAL.DOG) return 0;
  if (card.special === SPECIAL.MAHJONG) return 1;
  if (card.special === SPECIAL.PHOENIX) return 1.5;
  if (card.special === SPECIAL.DRAGON) return 15;
  return card.rank;
}
