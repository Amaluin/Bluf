/**
 * Комнаты и состояние игры на сервере.
 * Один экземпляр — одна комната (для простоты можно масштабировать через Map по roomId).
 */

import { dealCards, cardsMatchClaim, getRankFromId, handPoints } from './game.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/**
 * Если в руке есть 4 карты одного достоинства — переносит их в отбой.
 * Повторяет, пока есть такие четвёрки (например, 8 карт одного достоинства).
 * @returns {string[]} ранги, по которым карты ушли в отбой (для оповещения)
 */
function moveFourOfAKindToDiscard(hand, discard) {
  const discardedRanks = [];
  let again = true;
  while (again) {
    again = false;
    const byRank = {};
    for (const id of hand) {
      const r = getRankFromId(id);
      if (!byRank[r]) byRank[r] = [];
      byRank[r].push(id);
    }
    for (const rank of RANKS) {
      if (byRank[rank] && byRank[rank].length >= 4) {
        const four = byRank[rank].slice(0, 4);
        for (const id of four) {
          const idx = hand.indexOf(id);
          if (idx !== -1) hand.splice(idx, 1);
        }
        discard.push(...four);
        discardedRanks.push(rank);
        again = true;
        break;
      }
    }
  }
  return discardedRanks;
}

/** Финальные очки: сумма достоинств карт в руке (2–10 = номинал, В=11, Д=12, К=13, Т=14). */
function computeFinalScores(room) {
  if (!room || !room.players) return [];
  return room.players.map((p, i) => ({
    playerIndex: i,
    name: p.name,
    points: handPoints(p.hand),
  })).sort((a, b) => a.points - b.points); // по возрастанию очков (победитель 0 — первый)
}

const rooms = new Map();

function createRoom(roomCode) {
  if (rooms.has(roomCode)) return null;
  const room = {
    code: roomCode,
    players: [],           // { id, socketId, name, hand: cardIds[], isReady, diceRoll }
    state: 'lobby',        // lobby | dice_roll | playing | finished
    currentPlayerIndex: 0,
    pile: [],              // { cardIds[], claimedRank, playerIndex }
    discard: [],           // карты, которые ушли в отбой (когда "Верю" и правда)
    lastClaim: null,       // { rank, count } для следующего хода
    winnerIndex: -1,
    hands: null,           // после раздачи: массив рук по индексам игроков
  };
  rooms.set(roomCode, room);
  return room;
}

function getRoom(roomCode) {
  return rooms.get(roomCode) || null;
}

function addPlayer(roomCode, socketId, playerName) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'lobby') return { ok: false, error: 'room_busy' };
  if (room.players.length >= 6) return { ok: false, error: 'room_full' };
  const id = `p${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  room.players.push({
    id,
    socketId,
    name: (playerName || `Игрок ${room.players.length + 1}`).slice(0, 20),
    hand: [],
    isReady: false,
    diceRoll: 0,
  });
  return { ok: true, playerId: id, playerIndex: room.players.length - 1 };
}

function setReady(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return false;
  const p = room.players.find(pl => pl.socketId === socketId);
  if (!p) return false;
  p.isReady = true;
  return true;
}

function removePlayer(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return null;
  const index = room.players.findIndex(p => p.socketId === socketId);
  if (index === -1) return null;
  room.players.splice(index, 1);
  if (room.players.length === 0) {
    rooms.delete(roomCode);
    return null;
  }
  if (room.state === 'playing') {
    room.currentPlayerIndex = room.currentPlayerIndex % room.players.length;
    if (room.currentPlayerIndex > index) room.currentPlayerIndex--;
  }
  return room;
}

function startGame(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'lobby') return { ok: false, error: 'not_lobby' };
  const host = room.players[0];
  if (host.socketId !== socketId) return { ok: false, error: 'not_host' };
  const n = room.players.length;
  if (n < 2 || n > 6) return { ok: false, error: 'invalid_players' };

  // Бросаем кубик для каждого игрока
  room.players.forEach(p => {
    p.diceRoll = Math.floor(Math.random() * 6) + 1;
  });

  room.state = 'dice_roll';
  return { ok: true, diceRolls: room.players.map(p => ({ name: p.name, roll: p.diceRoll })) };
}

function confirmDiceRoll(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'dice_roll') return { ok: false, error: 'not_dice_roll' };
  const host = room.players[0];
  if (host.socketId !== socketId) return { ok: false, error: 'not_host' };

  const n = room.players.length;

  // Проверяем, есть ли дубли (одинаковые числа у нескольких игроков)
  const rollCounts = {};
  room.players.forEach(p => {
    rollCounts[p.diceRoll] = (rollCounts[p.diceRoll] || 0) + 1;
  });

  // Находим все числа, которые выпали у нескольких игроков
  const duplicateRolls = Object.keys(rollCounts).filter(roll => rollCounts[roll] > 1).map(Number);

  // Если есть дубли - перебрасывают только игроки с дублями
  if (duplicateRolls.length > 0) {
    const playersToReroll = room.players.filter(p => duplicateRolls.includes(p.diceRoll));
    playersToReroll.forEach(p => {
      p.diceRoll = Math.floor(Math.random() * 6) + 1;
    });
    return {
      ok: true,
      tieReroll: true,
      diceRolls: room.players.map(p => ({ name: p.name, roll: p.diceRoll }))
    };
  }

  // Сортируем игроков по убыванию результата броска
  room.players.sort((a, b) => b.diceRoll - a.diceRoll);

  const hands = dealCards(n);
  room.hands = hands;
  room.players.forEach((p, i) => {
    p.hand = hands[i] || [];
  });
  room.state = 'playing';
  room.currentPlayerIndex = 0;
  room.pile = [];
  room.discard = [];
  room.lastClaim = null;
  room.winnerIndex = -1;
  room.pendingWinnerIndex = undefined; // кто выиграет, если следующий скажет Верю или ошибётся с Не верю

  // 4 карты одного достоинства сразу уходят в отбой
  room.players.forEach((p) => {
    moveFourOfAKindToDiscard(p.hand, room.discard);
  });
  // Проверка победы после автоприбоя: игра заканчивается только если остался один игрок с картами
  const withCards = room.players.filter(p => p.hand.length > 0);
  if (withCards.length === 1) {
    // Победители - все игроки без карт
    const winners = room.players.filter(p => p.hand.length === 0);
    if (winners.length === 1) {
      room.winnerIndex = room.players.findIndex(p => p.hand.length === 0);
    }
    room.state = 'finished';
    room.finalScores = computeFinalScores(room);
  } else if (withCards.length === 0) {
    // Все игроки избавились от карт одновременно
    room.state = 'finished';
    room.finalScores = computeFinalScores(room);
  }

  return { ok: true };
}

function playCards(roomCode, socketId, cardIds, claimedRank) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'playing') return { ok: false, error: 'not_playing' };
  const playerIndex = room.players.findIndex(p => p.socketId === socketId);
  if (playerIndex === -1) return { ok: false, error: 'not_in_room' };
  if (room.currentPlayerIndex !== playerIndex) return { ok: false, error: 'not_your_turn' };
  if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > 4) return { ok: false, error: 'invalid_count' };
  if (!RANKS.includes(claimedRank)) return { ok: false, error: 'invalid_rank' };

  const player = room.players[playerIndex];
  for (const cid of cardIds) {
    const idx = player.hand.indexOf(cid);
    if (idx === -1) return { ok: false, error: 'card_not_in_hand' };
    player.hand.splice(idx, 1);
  }
  room.pile.push({ cardIds, claimedRank, playerIndex });
  room.lastClaim = { rank: claimedRank, count: cardIds.length };

  // Если игрок избавился от всех карт — победа не сразу: следующий должен сказать Верю/Не верю
  if (player.hand.length === 0) {
    room.pendingWinnerIndex = playerIndex;
  }
  room.currentPlayerIndex = (playerIndex + 1) % room.players.length;

  return {
    ok: true,
    nextPlayerIndex: room.currentPlayerIndex,
    gameOver: false,
    winnerIndex: -1,
    pendingWinnerIndex: room.pendingWinnerIndex,
  };
}

function challenge(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'playing') return { ok: false, error: 'not_playing' };
  const challengerIndex = room.players.findIndex(p => p.socketId === socketId);
  if (challengerIndex === -1) return { ok: false, error: 'not_in_room' };
  const lastPlay = room.pile[room.pile.length - 1];
  if (!lastPlay) return { ok: false, error: 'nothing_to_challenge' };

  const wasLying = !cardsMatchClaim(lastPlay.cardIds, lastPlay.claimedRank);
  const loserIndex = wasLying ? lastPlay.playerIndex : challengerIndex;
  const loser = room.players[loserIndex];
  const allCards = room.pile.flatMap(p => p.cardIds);
  const cardCount = allCards.length;
  loser.hand.push(...allCards);
  room.pile = [];
  room.lastClaim = null;

  // 4 карты одного достоинства сразу уходят в отбой
  moveFourOfAKindToDiscard(loser.hand, room.discard);

  // Кто ходит после вызова «Не верю»:
  // — Если вызвавший угадал (был блеф): ход остаётся у него (challengerIndex).
  // — Если вызвавший ошибся (правда): ход переходит следующему по кругу.
  if (wasLying) {
    room.currentPlayerIndex = challengerIndex;
    if (room.pendingWinnerIndex === lastPlay.playerIndex) {
      room.pendingWinnerIndex = undefined;
    }
  } else {
    room.currentPlayerIndex = (challengerIndex + 1) % room.players.length;
    if (room.pendingWinnerIndex !== undefined) {
      room.winnerIndex = room.pendingWinnerIndex;
      room.state = 'finished';
      room.finalScores = computeFinalScores(room);
      room.pendingWinnerIndex = undefined;
    }
  }

  // Игра заканчивается только когда остался один игрок с картами (все остальные избавились)
  const withCards = room.players.filter(p => p.hand.length > 0);
  if (withCards.length === 1 && room.state !== 'finished') {
    room.state = 'finished';
    // Победители - все игроки без карт (их может быть несколько)
    const winners = room.players.filter(p => p.hand.length === 0);
    // Если победитель один, устанавливаем его индекс
    if (winners.length === 1) {
      room.winnerIndex = room.players.findIndex(p => p.hand.length === 0);
    }
    room.finalScores = computeFinalScores(room);
  } else if (withCards.length === 0 && room.state !== 'finished') {
    // Все игроки избавились от карт одновременно (маловероятно, но возможно)
    room.state = 'finished';
    room.finalScores = computeFinalScores(room);
  }

  return {
    ok: true,
    wasLying,
    revealedCards: lastPlay.cardIds,
    claimedRank: lastPlay.claimedRank,
    loserIndex,
    cardCount,
    nextPlayerIndex: room.currentPlayerIndex,
    gameOver: room.state === 'finished',
    winnerIndex: room.winnerIndex,
    finalScores: room.finalScores,
  };
}

function trust(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'playing') return { ok: false, error: 'not_playing' };
  const playerIndex = room.players.findIndex(p => p.socketId === socketId);
  if (playerIndex === -1) return { ok: false, error: 'not_in_room' };
  if (room.currentPlayerIndex !== playerIndex) return { ok: false, error: 'not_your_turn' };

  const lastPlay = room.pile[room.pile.length - 1];
  if (!lastPlay) return { ok: false, error: 'nothing_to_trust' };

  // Проверяем последнюю положенную группу карт
  const wasRight = cardsMatchClaim(lastPlay.cardIds, lastPlay.claimedRank);
  const allCards = room.pile.flatMap(p => p.cardIds);
  const cardCount = allCards.length;

  if (wasRight) {
    // Правда: карты уходят в отбой, ход остаётся у того, кто сказал «Верю» (он угадал)
    const revealedCards = lastPlay.cardIds;
    const claimedRank = lastPlay.claimedRank;
    room.discard.push(...allCards);
    room.pile = [];
    room.lastClaim = null;
    room.currentPlayerIndex = playerIndex; // Ход остаётся у того, кто угадал
    // Если кто-то только что избавился от последних карт — он победил
    if (room.pendingWinnerIndex !== undefined) {
      room.winnerIndex = room.pendingWinnerIndex;
      room.state = 'finished';
      room.finalScores = computeFinalScores(room);
      room.pendingWinnerIndex = undefined;
      return { ok: true, nextPlayerIndex: room.currentPlayerIndex, trustResult: 'discard', revealedCards, claimedRank, gameOver: true, winnerIndex: room.winnerIndex, finalScores: room.finalScores };
    }
    return { ok: true, nextPlayerIndex: room.currentPlayerIndex, trustResult: 'discard', revealedCards, claimedRank };
  }

  // Не правда: карты забирает тот, кто нажал «Верю», ход переходит к тому, кто блефовал (он выиграл)
  const liarIndex = lastPlay.playerIndex;
  const trusterIndex = playerIndex; // тот, кто сказал «Верю», забирает карты
  const loser = room.players[trusterIndex];
  loser.hand.push(...allCards);
  room.pile = [];
  room.lastClaim = null;
  room.currentPlayerIndex = liarIndex; // Ход переходит к тому, кто блефовал (он выиграл)

  moveFourOfAKindToDiscard(loser.hand, room.discard);

  if (room.pendingWinnerIndex !== undefined) {
    room.winnerIndex = room.pendingWinnerIndex;
    room.state = 'finished';
    room.finalScores = computeFinalScores(room);
    room.pendingWinnerIndex = undefined;
  }

  return {
    ok: true,
    wasLying: true,
    revealedCards: lastPlay.cardIds,
    claimedRank: lastPlay.claimedRank,
    loserIndex: trusterIndex,
    cardCount,
    nextPlayerIndex: room.currentPlayerIndex,
    gameOver: room.state === 'finished',
    winnerIndex: room.winnerIndex,
    finalScores: room.finalScores,
  };
}

export {
  createRoom,
  getRoom,
  addPlayer,
  setReady,
  removePlayer,
  startGame,
  confirmDiceRoll,
  playCards,
  challenge,
  trust,
  RANKS,
};
