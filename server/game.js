/**
 * Логика игры "Верю / Не верю" (Bluff / Cheat).
 * Колода 52 карты, 1–4 игрока, равная раздача, остаток случайным игрокам.
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_NAMES = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}${suit}`, rank, suit, suitKey: SUIT_NAMES[suit] });
    }
  }
  return deck;
}

function shuffle(deck) {
  const a = [...deck];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Раздаёт карты поровну. Если 52 не делится на число игроков,
 * остаток случайно распределяется между игроками.
 * @param {number} playerCount 1–4
 * @returns {string[][]} массив рук (массив id карт для каждого игрока)
 */
function dealCards(playerCount) {
  const deck = shuffle(createDeck());
  const baseCount = Math.floor(52 / playerCount);
  const remainder = 52 % playerCount;
  const hands = Array.from({ length: playerCount }, () => []);
  let idx = 0;
  for (let i = 0; i < playerCount; i++) {
    for (let j = 0; j < baseCount; j++) {
      hands[i].push(deck[idx++].id);
    }
  }
  if (remainder > 0) {
    const whoGetsExtra = Array.from({ length: playerCount }, (_, i) => i);
    for (let i = whoGetsExtra.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [whoGetsExtra[i], whoGetsExtra[j]] = [whoGetsExtra[j], whoGetsExtra[i]];
    }
    for (let e = 0; e < remainder; e++) {
      hands[whoGetsExtra[e]].push(deck[idx++].id);
    }
  }
  return hands;
}

/**
 * Проверяет, что заявленный ранг совпадает с картами.
 */
function cardsMatchClaim(cardIds, claimedRank) {
  return cardIds.every(id => getRankFromId(id) === claimedRank);
}

/**
 * Из id карты возвращает ранг (для отображения).
 */
function getRankFromId(id) {
  const r = id.replace(/[♠♥♦♣]/g, '').trim();
  return r || id;
}

export {
  RANKS,
  SUITS,
  SUIT_NAMES,
  createDeck,
  dealCards,
  cardsMatchClaim,
  getRankFromId,
};
