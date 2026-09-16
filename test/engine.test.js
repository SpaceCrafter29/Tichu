import assert from 'node:assert/strict';
import { createDeck, cardPoints, rankOf, SPECIAL } from '../engine/cards.js';
import { classify, canBeat, COMBO } from '../engine/combos.js';
import { Round, Match, teamOf } from '../engine/game.js';

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

function card(suit, rank) {
  return { id: `${suit}${rank}`, suit, rank, special: null };
}
function special(kind) {
  const names = { MAHJONG: 1, PHOENIX: null, DOG: null, DRAGON: 15 };
  return { id: kind, suit: null, rank: names[kind], special: kind };
}

// ---- Karten/Deck ----
test('Deck hat 56 Karten, 100 Punkte gesamt (Drache +25, Phönix -25)', () => {
  const deck = createDeck();
  assert.equal(deck.length, 56);
  const total = deck.reduce((s, c) => s + cardPoints(c), 0);
  assert.equal(total, 100);
  assert.equal(deck.filter((c) => c.rank === 5 && !c.special).length, 4);
});

// ---- Kombinationen erkennen ----
test('Single erkannt', () => {
  const c = classify([card('Jade', 7)]);
  assert.equal(c.type, COMBO.SINGLE);
  assert.equal(c.rank, 7);
});

test('Paar erkannt, verschiedene Ränge ungültig', () => {
  assert.equal(classify([card('Jade', 7), card('Schwert', 7)]).type, COMBO.PAIR);
  assert.equal(classify([card('Jade', 7), card('Schwert', 8)]), null);
});

test('Paar mit Phönix', () => {
  const c = classify([card('Jade', 9), special('PHOENIX')]);
  assert.equal(c.type, COMBO.PAIR);
  assert.equal(c.rank, 9.5);
});

test('Drilling erkannt', () => {
  const c = classify([card('Jade', 4), card('Schwert', 4), card('Pagode', 4)]);
  assert.equal(c.type, COMBO.TRIPLE);
  assert.equal(c.rank, 4);
});

test('Full House erkannt (natürlich und mit Phönix)', () => {
  const a = classify([card('Jade', 6), card('Schwert', 6), card('Pagode', 6), card('Jade', 9), card('Stern', 9)]);
  assert.equal(a.type, COMBO.FULLHOUSE);
  assert.equal(a.rank, 6);
  const b = classify([card('Jade', 6), card('Schwert', 6), card('Jade', 9), card('Stern', 9), special('PHOENIX')]);
  assert.equal(b.type, COMBO.FULLHOUSE);
  assert.equal(b.rank, 9); // Phönix ergänzt das höhere Paar zum Drilling
});

test('Straße erkannt, inkl. Mahjong am unteren Ende und Phönix als Lücke', () => {
  const straight = classify([card('Jade', 3), card('Schwert', 4), card('Pagode', 5), card('Stern', 6), card('Jade', 7)]);
  assert.equal(straight.type, COMBO.STRAIGHT);
  assert.equal(straight.rank, 7);

  const withMahjong = classify([special('MAHJONG'), card('Schwert', 2), card('Pagode', 3), card('Stern', 4), card('Jade', 5)]);
  assert.equal(withMahjong.type, COMBO.STRAIGHT);

  const withPhoenix = classify([card('Jade', 3), card('Schwert', 4), special('PHOENIX'), card('Stern', 6), card('Jade', 7)]);
  assert.equal(withPhoenix.type, COMBO.STRAIGHT);
  assert.equal(withPhoenix.rank, 7);

  assert.equal(classify([card('Jade', 3), card('Schwert', 4), card('Pagode', 5), card('Stern', 6), card('Jade', 9)]), null);
});

test('Treppe (aufeinanderfolgende Paare) erkannt', () => {
  const stairs = classify([card('Jade', 5), card('Schwert', 5), card('Pagode', 6), card('Stern', 6)]);
  assert.equal(stairs.type, COMBO.STAIRS);
  assert.equal(stairs.rank, 6);
  const withPhoenix = classify([card('Jade', 5), card('Schwert', 5), card('Pagode', 6), special('PHOENIX')]);
  assert.equal(withPhoenix.type, COMBO.STAIRS);
});

test('Bomben erkannt: Vierling und Straßenbombe', () => {
  const quad = classify([card('Jade', 8), card('Schwert', 8), card('Pagode', 8), card('Stern', 8)]);
  assert.equal(quad.type, COMBO.BOMB_QUAD);
  assert.equal(quad.isBomb, true);

  const flush = classify([card('Jade', 3), card('Jade', 4), card('Jade', 5), card('Jade', 6), card('Jade', 7)]);
  assert.equal(flush.type, COMBO.BOMB_STRAIGHTFLUSH);
  assert.equal(flush.isBomb, true);

  // Phönix ist in keiner Bombe erlaubt
  const noBombWithPhoenix = classify([card('Jade', 8), card('Schwert', 8), card('Pagode', 8), special('PHOENIX')]);
  assert.notEqual(noBombWithPhoenix && noBombWithPhoenix.isBomb, true);
});

// ---- Vergleich / canBeat ----
test('Drache schlägt alle normalen Singles, Phönix schlägt den Drachen', () => {
  const dragon = classify([special('DRAGON')]);
  const king = classify([card('Jade', 13)]);
  assert.equal(canBeat(dragon, king), true);
  assert.equal(canBeat(king, dragon), false);

  const phoenix = classify([special('PHOENIX')]);
  assert.equal(canBeat(phoenix, dragon), true);
});

test('Bombe schlägt jede Nicht-Bombe unabhängig vom Typ', () => {
  const straightOfSingles = classify([card('Jade', 13)]); // einfaches hohes Single
  const quadBomb = classify([card('Jade', 9), card('Schwert', 9), card('Pagode', 9), card('Stern', 9)]);
  assert.equal(canBeat(quadBomb, straightOfSingles), true);
});

test('Straßenbombe schlägt Vierling-Bombe', () => {
  const quad = classify([card('Jade', 9), card('Schwert', 9), card('Pagode', 9), card('Stern', 9)]);
  const flush = classify([card('Jade', 2), card('Jade', 3), card('Jade', 4), card('Jade', 5), card('Jade', 6)]);
  assert.equal(canBeat(flush, quad), true);
  assert.equal(canBeat(quad, flush), false);
});

test('Hund darf nur angespielt werden und schlägt/wird nie geschlagen', () => {
  const dog = classify([special('DOG')]);
  assert.equal(canBeat(dog, null), true);
  const single = classify([card('Jade', 5)]);
  assert.equal(canBeat(single, dog), false);
  assert.equal(canBeat(dog, single), false);
});

// ---- Vollständige Rundensimulation ----
function lowestSingle(hand) {
  return hand.slice().sort((a, b) => rankOf(a) - rankOf(b))[0];
}

// Jeder Spieler schupft seine drei niedrigsten Karten reihum an die anderen drei.
function schupfenLowestThree(round) {
  const passMatrix = [{}, {}, {}, {}];
  for (let i = 0; i < 4; i++) {
    const sorted = round.hands[i].slice().sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 3);
    const targets = [(i + 1) % 4, (i + 2) % 4, (i + 3) % 4];
    targets.forEach((t, idx) => {
      passMatrix[i][t] = sorted[idx];
    });
  }
  round.schupfen(passMatrix);
}

function simulateRound(rng) {
  const round = new Round({ rng });
  for (let i = 0; i < 4; i++) round.callGrandTichu(i, false);
  round.dealRest();
  schupfenLowestThree(round);

  let guard = 0;
  while (!round.over) {
    guard++;
    assert.ok(guard < 5000, 'Simulation hängt fest');

    if (round.pendingDragonGiveaway) {
      const winner = round.pendingDragonGiveaway.winnerIdx;
      const opponent = [0, 1, 2, 3].find((p) => teamOf(p) !== teamOf(winner));
      round.giveDragonTrick(opponent);
      continue;
    }

    const p = round.turn;
    const hand = round.hands[p];
    const current = round.currentTrick.combo;

    if (round.pendingWish != null) {
      const wishCard = hand.find((c) => c.rank === round.pendingWish && !c.special);
      if (wishCard) {
        const combo = classify([wishCard]);
        if (canBeat(combo, current)) {
          round.play(p, [wishCard]);
          continue;
        }
      }
    }

    if (current === null) {
      const lowest = lowestSingle(hand);
      const opts = lowest.special === SPECIAL.MAHJONG ? { wish: 2 + Math.floor(rng() * 13) } : {};
      round.play(p, [lowest], opts);
      continue;
    }

    const sorted = hand.slice().sort((a, b) => rankOf(a) - rankOf(b));
    const beating = sorted.find((c) => canBeat(classify([c]), current));
    if (beating) {
      round.play(p, [beating]);
    } else {
      round.pass(p);
    }
  }
  return round;
}

test('Bombe darf jederzeit außer der Reihe geworfen werden', () => {
  const bombCards = [card('Jade', 7), card('Schwert', 7), card('Pagode', 7), card('Stern', 7)];
  const hands = [
    bombCards.concat([card('Jade', 2)]), // Spieler 0: hat die Bombe, ist aber NICHT am Zug
    [card('Jade', 9), card('Schwert', 6)], // zweite Karte, damit Spieler 1 nach dem Ausspielen nicht fertig ist
    [card('Jade', 3)],
    [card('Jade', 4)],
  ];
  const round = new Round({ hands });
  round.schupfenDone = true;
  round.playedAny = [false, false, false, false];
  round.turn = 1;
  round.currentTrick = { leaderIdx: 1, winnerIdx: null, combo: null, cardsInTrick: [], passesSinceLastPlay: 0 };

  round.play(1, [card('Jade', 9)]); // Spieler 1 eröffnet den Stich
  assert.equal(round.turn, 2); // regulär wäre jetzt Spieler 2 dran

  // Eine normale Karte darf Spieler 0 weiterhin nur am eigenen Zug spielen...
  assert.throws(() => round.play(0, [card('Jade', 2)]), /Nicht am Zug/);
  // ...eine Bombe aber jederzeit, auch außer der Reihe.
  round.play(0, bombCards);
  assert.equal(round.currentTrick.combo.type, COMBO.BOMB_QUAD);
  assert.equal(round.currentTrick.winnerIdx, 0);
  // Danach geht's normal im Uhrzeigersinn ab der Bomberin/dem Bomber weiter (Spieler 2 wird übersprungen).
  assert.equal(round.turn, 1);
});

test('Vollständige Runde: Punkte ergeben 100 (oder 200/0 bei Doppelsieg) plus Tichu-Boni', () => {
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let trial = 0; trial < 25; trial++) {
    const round = simulateRound(rng);
    const { teamScore, doubleWin, tichuBonus } = round.result;
    const bonusSum = tichuBonus.reduce((a, b) => a + b, 0);
    const base = doubleWin ? 200 : 100;
    assert.equal(teamScore[0] + teamScore[1], base + bonusSum);
    assert.equal(round.finishOrder.length >= (doubleWin ? 2 : 3), true);
  }
});

test('Match endet, sobald ein Team die Zielpunktzahl erreicht', () => {
  const match = new Match({ target: 50, rng: Math.random });
  let rounds = 0;
  while (!match.isMatchOver() && rounds < 50) {
    const round = match.newRound();
    for (let i = 0; i < 4; i++) round.callGrandTichu(i, false);
    round.dealRest();
    schupfenLowestThree(round);
    while (!round.over) {
      if (round.pendingDragonGiveaway) {
        const winner = round.pendingDragonGiveaway.winnerIdx;
        const opponent = [0, 1, 2, 3].find((p) => teamOf(p) !== teamOf(winner));
        round.giveDragonTrick(opponent);
        continue;
      }
      const p = round.turn;
      const hand = round.hands[p];
      const current = round.currentTrick.combo;
      if (current === null) {
        const lowest = lowestSingle(hand);
        const opts = lowest.special === SPECIAL.MAHJONG ? { wish: null } : {};
        round.play(p, [lowest], opts);
        continue;
      }
      const sorted = hand.slice().sort((a, b) => rankOf(a) - rankOf(b));
      const beating = sorted.find((c) => canBeat(classify([c]), current));
      if (beating) round.play(p, [beating]);
      else round.pass(p);
    }
    match.recordRound(round);
    rounds++;
  }
  assert.equal(match.isMatchOver(), true);
  assert.ok(match.winner() === 0 || match.winner() === 1 || match.winner() === null);
});

console.log(`\n${passed} Tests bestanden.`);
if (process.exitCode) {
  console.error('Es gab fehlgeschlagene Tests.');
}
