// Rundenablauf: Schupfen, Ansagen, Stiche, Punktewertung. Reine Spiellogik, kein Server/UI.
import { createDeck, shuffle, deal, cardPoints } from './cards.js';
import { classify, canBeat, COMBO, resolveSingleValue, isDragonSingle } from './combos.js';

export const TEAMS = [
  [0, 2],
  [1, 3],
];
export function teamOf(playerIdx) {
  return playerIdx % 2 === 0 ? 0 : 1;
}
function otherTeam(t) {
  return t === 0 ? 1 : 0;
}

export class Round {
  constructor({ rng = Math.random } = {}) {
    const deck = shuffle(createDeck(), rng);
    const { first8, rest6 } = deal(deck);
    this.hands = first8.map((h) => h.slice()); // erst nur die ersten 8 (für die Grand-Tichu-Entscheidung)
    this.first8 = first8;
    this.rest6 = rest6;
    this.grandTichu = [null, null, null, null]; // true/false pro Spieler, gesetzt bevor die letzten 6 gesehen werden
    this.tichu = [false, false, false, false];
    this.dealt14 = false;
    this.schupfenDone = false;
    this.wonPiles = [[], [], [], []];
    this.finishOrder = [];
    this.active = new Set([0, 1, 2, 3]);
    this.currentTrick = null; // {combo, winnerIdx, cardsInTrick, passesSinceLastPlay}
    this.turn = null; // wird nach dem Schupfen auf den Mahjong-Halter gesetzt
    this.pendingWish = null;
    this.pendingDragonGiveaway = null; // {winnerIdx, cards}
    this.pendingEnd = null; // {doubleWin,...} - Rundenende wartet auf giveDragonTrick()
    this.over = false;
    this.result = null;
  }

  // Vor dem Schupfen: pro Spieler true (Grand Tichu), false (kein Grand Tichu) oder null (noch offen).
  callGrandTichu(playerIdx, called) {
    if (this.dealt14) throw new Error('Grand Tichu muss vor Erhalt der restlichen 6 Karten entschieden werden');
    this.grandTichu[playerIdx] = called;
  }

  // Gibt die letzten 6 Karten aus, sobald alle vier Spieler über Grand Tichu entschieden haben.
  dealRest(rest6 = this.rest6) {
    if (this.grandTichu.some((v) => v === null)) throw new Error('Nicht alle Spieler haben über Grand Tichu entschieden');
    for (let i = 0; i < 4; i++) this.hands[i] = this.hands[i].concat(rest6[i]);
    this.dealt14 = true;
  }

  // Normales (kleines) Tichu: jederzeit möglich, solange der Spieler noch keine Karte gespielt hat.
  callTichu(playerIdx) {
    if (this.playedAny === undefined) this.playedAny = [false, false, false, false];
    if (this.playedAny[playerIdx]) throw new Error('Tichu nur vor der ersten eigenen Karte möglich');
    if (this.grandTichu[playerIdx]) throw new Error('Grand Tichu wurde bereits angesagt');
    this.tichu[playerIdx] = true;
  }

  // passMatrix[i][j] = Karte, die Spieler i an Spieler j abgibt (für alle i!=j, je eine Karte).
  schupfen(passMatrix) {
    if (!this.dealt14) throw new Error('Schupfen erst nach Erhalt aller 14 Karten');
    const outgoing = [0, 1, 2, 3].map((i) => new Set(Object.values(passMatrix[i]).map((c) => c.id)));
    for (let i = 0; i < 4; i++) {
      const targets = Object.keys(passMatrix[i]).map(Number);
      const others = [0, 1, 2, 3].filter((p) => p !== i);
      if (targets.length !== 3 || !others.every((o) => targets.includes(o))) {
        throw new Error(`Spieler ${i} muss genau je eine Karte an die drei anderen Spieler abgeben`);
      }
      for (const card of Object.values(passMatrix[i])) {
        if (!this.hands[i].some((c) => c.id === card.id)) throw new Error(`Spieler ${i} besitzt die abgegebene Karte nicht`);
      }
    }
    const newHands = [0, 1, 2, 3].map((i) => this.hands[i].filter((c) => !outgoing[i].has(c.id)));
    for (let from = 0; from < 4; from++) {
      for (const [toStr, card] of Object.entries(passMatrix[from])) {
        const to = Number(toStr);
        newHands[to].push(card);
      }
    }
    this.hands = newHands;
    this.schupfenDone = true;
    this.playedAny = [false, false, false, false];
    const mahjongHolder = this.hands.findIndex((h) => h.some((c) => c.special === 'MAHJONG'));
    this.turn = mahjongHolder;
    this.currentTrick = { leaderIdx: mahjongHolder, winnerIdx: null, combo: null, cardsInTrick: [], passesSinceLastPlay: 0 };
  }

  nextActiveFrom(idx) {
    for (let step = 0; step < 4; step++) {
      const cand = (idx + step) % 4;
      if (this.active.has(cand)) return cand;
    }
    return null;
  }

  advanceTurn() {
    let cand = (this.turn + 1) % 4;
    for (let step = 0; step < 4; step++) {
      if (this.active.has(cand)) {
        this.turn = cand;
        return;
      }
      cand = (cand + 1) % 4;
    }
  }

  wishPendingFulfillable(playerIdx) {
    if (this.pendingWish == null) return false;
    const hand = this.hands[playerIdx];
    const wishCards = hand.filter((c) => c.rank === this.pendingWish && !c.special);
    if (wishCards.length === 0) return false;
    const current = this.currentTrick.combo;
    const candidates = [];
    if (wishCards.length >= 1) candidates.push([wishCards[0]]);
    if (wishCards.length >= 2) candidates.push(wishCards.slice(0, 2));
    if (wishCards.length >= 3) candidates.push(wishCards.slice(0, 3));
    if (wishCards.length >= 4) candidates.push(wishCards.slice(0, 4));
    return candidates.some((cards) => {
      const combo = classify(cards);
      return combo && canBeat(combo, current);
    });
  }

  play(playerIdx, cards, opts = {}) {
    if (this.over) throw new Error('Runde ist bereits beendet');
    if (this.turn !== playerIdx) throw new Error('Nicht am Zug');
    if (this.pendingDragonGiveaway) throw new Error('Drachenstich muss erst vergeben werden');
    const hand = this.hands[playerIdx];
    const ids = new Set(cards.map((c) => c.id));
    if (cards.length === 0 || ![...ids].every((id) => hand.some((c) => c.id === id))) {
      throw new Error('Karten nicht auf der Hand');
    }
    const combo = classify(cards);
    if (!combo) throw new Error('Ungültige Kombination');
    const current = this.currentTrick.combo;
    if (!canBeat(combo, current)) throw new Error('Kombination schlägt den Tischstand nicht');

    if (combo.type === COMBO.SINGLE && cards[0].special === 'MAHJONG') {
      const wish = opts.wish;
      if (wish != null && (wish < 2 || wish > 14)) throw new Error('Ungültiger Wunsch');
      this.pendingWish = wish ?? null;
    } else if (this.pendingWish != null && current !== null) {
      // Wunsch bleibt bestehen, bis eine Karte des gewünschten Rangs gespielt wurde
      if (cards.some((c) => c.rank === this.pendingWish)) this.pendingWish = null;
    } else if (this.pendingWish != null && cards.some((c) => c.rank === this.pendingWish)) {
      this.pendingWish = null;
    }

    this.hands[playerIdx] = hand.filter((c) => !ids.has(c.id));
    this.playedAny[playerIdx] = true;
    this.currentTrick.combo = combo;
    this.currentTrick.winnerIdx = playerIdx;
    this.currentTrick.cardsInTrick.push(...cards);
    this.currentTrick.passesSinceLastPlay = 0;

    const finished = this.hands[playerIdx].length === 0;
    if (finished) {
      this.finishOrder.push(playerIdx);
      this.active.delete(playerIdx);
    }

    if (combo.type === COMBO.DOG) {
      this.wonPiles[playerIdx].push(...this.currentTrick.cardsInTrick);
      const partner = (playerIdx + 2) % 4;
      const leader = this.active.has(partner) ? partner : this.nextActiveFrom(partner);
      this.currentTrick = { leaderIdx: leader, winnerIdx: null, combo: null, cardsInTrick: [], passesSinceLastPlay: 0 };
      this.turn = leader;
      this.checkRoundEnd();
      return;
    }

    this.checkRoundEnd();
    if (this.over || this.pendingEnd) return;

    const othersActive = [...this.active].filter((p) => p !== playerIdx);
    if (othersActive.length === 0) {
      this.closeTrick();
      return;
    }
    this.advanceTurn();
  }

  pass(playerIdx) {
    if (this.over) throw new Error('Runde ist bereits beendet');
    if (this.pendingDragonGiveaway) throw new Error('Drachenstich muss erst vergeben werden');
    if (this.turn !== playerIdx) throw new Error('Nicht am Zug');
    if (this.currentTrick.combo === null) throw new Error('Eröffnungsspieler kann nicht passen');
    if (this.wishPendingFulfillable(playerIdx)) throw new Error('Wunsch muss erfüllt werden, falls möglich');
    this.currentTrick.passesSinceLastPlay++;
    const remainingOthers = [...this.active].filter((p) => p !== this.currentTrick.winnerIdx).length;
    if (this.currentTrick.passesSinceLastPlay >= remainingOthers) {
      this.closeTrick();
      return;
    }
    this.advanceTurn();
  }

  closeTrick() {
    const winnerIdx = this.currentTrick.winnerIdx;
    const resolved = this.resolveOpenTrick();
    if (resolved) this.leadNextTrickAfter(winnerIdx);
    this.checkRoundEnd();
  }

  // Nach Gewinn eines Drachenstichs: Punkte gehen an einen Gegner (Team-fremd), die Führung bleibt beim Gewinner.
  giveDragonTrick(toPlayerIdx) {
    if (!this.pendingDragonGiveaway) throw new Error('Kein offener Drachenstich');
    const { winnerIdx, cards } = this.pendingDragonGiveaway;
    if (teamOf(toPlayerIdx) === teamOf(winnerIdx)) throw new Error('Der Drachenstich muss an einen Gegner gehen');
    this.wonPiles[toPlayerIdx].push(...cards);
    this.pendingDragonGiveaway = null;
    if (this.pendingEnd) {
      // Die Runde endete mit dem Drachenstich als letztem offenen Stich - jetzt erst kann gewertet werden.
      const endSpec = this.pendingEnd;
      this.pendingEnd = null;
      this.over = true;
      this.result = this.score(endSpec);
      return;
    }
    this.leadNextTrickAfter(winnerIdx);
    this.checkRoundEnd();
  }

  // Schließt einen noch offenen (nicht fertig ausgereizten) Stich, wenn die Runde mittendrin endet
  // (Doppelsieg oder letzter verbliebener Spieler). Gibt false zurück, wenn dafür erst noch ein
  // Drachenstich vergeben werden muss (siehe pendingEnd/giveDragonTrick).
  resolveOpenTrick() {
    if (!this.currentTrick || this.currentTrick.combo === null) return true;
    const { winnerIdx, combo, cardsInTrick } = this.currentTrick;
    this.currentTrick = { leaderIdx: null, winnerIdx: null, combo: null, cardsInTrick: [], passesSinceLastPlay: 0 };
    if (isDragonSingle(combo)) {
      this.pendingDragonGiveaway = { winnerIdx, cards: cardsInTrick };
      return false;
    }
    this.wonPiles[winnerIdx].push(...cardsInTrick);
    return true;
  }

  leadNextTrickAfter(winnerIdx) {
    const leader = this.active.has(winnerIdx) ? winnerIdx : this.nextActiveFrom(winnerIdx);
    this.currentTrick = { leaderIdx: leader, winnerIdx: null, combo: null, cardsInTrick: [], passesSinceLastPlay: 0 };
    this.turn = leader;
    // pendingWish bleibt absichtlich über Stichgrenzen hinweg bestehen, bis er erfüllt wird
  }

  checkRoundEnd() {
    if (this.over) return;
    let endSpec = null;
    if (this.finishOrder.length >= 2) {
      const [first, second] = this.finishOrder;
      if (teamOf(first) === teamOf(second)) endSpec = { doubleWin: true, winningTeam: teamOf(first) };
    }
    if (!endSpec && this.active.size === 1) {
      endSpec = { doubleWin: false, lastPlace: [...this.active][0] };
    }
    if (!endSpec) return;
    if (this.pendingDragonGiveaway) {
      // Runde soll enden, aber ein zuvor gewonnener Drachenstich ist noch nicht vergeben.
      this.pendingEnd = endSpec;
      return;
    }
    const resolved = this.resolveOpenTrick();
    if (!resolved) {
      // Der letzte offene Stich war ein Drachenstich - Wertung wartet auf giveDragonTrick().
      this.pendingEnd = endSpec;
      return;
    }
    this.over = true;
    this.result = this.score(endSpec);
  }

  score({ doubleWin, winningTeam, lastPlace }) {
    const pointsPerPlayer = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      pointsPerPlayer[i] = this.wonPiles[i].reduce((sum, c) => sum + cardPoints(c), 0);
    }
    let teamScore = [0, 0];
    if (doubleWin) {
      teamScore[winningTeam] = 200;
      teamScore[otherTeam(winningTeam)] = 0;
    } else {
      const handPoints = this.hands[lastPlace].reduce((sum, c) => sum + cardPoints(c), 0);
      const firstPlace = this.finishOrder[0];
      pointsPerPlayer[firstPlace] += pointsPerPlayer[lastPlace];
      pointsPerPlayer[lastPlace] = 0;
      const opposing = otherTeam(teamOf(lastPlace));
      teamScore[0] = pointsPerPlayer[0] + pointsPerPlayer[2];
      teamScore[1] = pointsPerPlayer[1] + pointsPerPlayer[3];
      teamScore[opposing] += handPoints;
    }
    const tichuBonus = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const wonFirst = this.finishOrder[0] === i;
      if (this.grandTichu[i]) tichuBonus[i] = wonFirst ? 200 : -200;
      else if (this.tichu[i]) tichuBonus[i] = wonFirst ? 100 : -100;
    }
    teamScore[0] += tichuBonus[0] + tichuBonus[2];
    teamScore[1] += tichuBonus[1] + tichuBonus[3];
    return { teamScore, pointsPerPlayer, tichuBonus, doubleWin: !!doubleWin, finishOrder: this.finishOrder.slice() };
  }
}

// Ein Match läuft über mehrere Runden bis eine Mannschaft die Zielpunktzahl erreicht (Standard: 1000).
export class Match {
  constructor({ target = 1000, rng = Math.random } = {}) {
    this.target = target;
    this.rng = rng;
    this.totalScore = [0, 0];
    this.rounds = [];
  }

  newRound() {
    return new Round({ rng: this.rng });
  }

  recordRound(round) {
    if (!round.over) throw new Error('Runde ist noch nicht beendet');
    this.rounds.push(round.result);
    this.totalScore[0] += round.result.teamScore[0];
    this.totalScore[1] += round.result.teamScore[1];
    return this.isMatchOver();
  }

  isMatchOver() {
    return this.totalScore[0] >= this.target || this.totalScore[1] >= this.target;
  }

  winner() {
    if (!this.isMatchOver()) return null;
    if (this.totalScore[0] === this.totalScore[1]) return null;
    return this.totalScore[0] > this.totalScore[1] ? 0 : 1;
  }
}
