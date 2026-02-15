/**
 * Комнаты и состояние игры на сервере.
 * Один экземпляр — одна комната (для простоты можно масштабировать через Map по roomId).
 */

import { dealCards, cardsMatchClaim, getRankFromId } from './game.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

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

  // Определяем порядок игроков по результатам броска кубика
  const maxRoll = Math.max(...room.players.map(p => p.diceRoll));
  const firstPlayerIndex = room.players.findIndex(p => p.diceRoll === maxRoll);

  // Переупорядочиваем игроков по часовой стрелке от первого
  const reordered = [];
  for (let i = 0; i < n; i++) {
    reordered.push(room.players[(firstPlayerIndex + i) % n]);
  }
  room.players = reordered;

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

  if (player.hand.length === 0) {
    room.winnerIndex = playerIndex;
    room.state = 'finished';
  } else {
    room.currentPlayerIndex = (playerIndex + 1) % room.players.length;
  }
  return {
    ok: true,
    nextPlayerIndex: room.currentPlayerIndex,
    gameOver: room.state === 'finished',
    winnerIndex: room.winnerIndex,
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

  // Если блеф раскрыт, ход переходит к тому, кто раскрыл
  // Если не блеф, ход переходит к следующему игроку
  room.currentPlayerIndex = wasLying ? challengerIndex : (challengerIndex + 1) % room.players.length;

  if (loser.hand.length >= 52) {
    room.state = 'finished';
    room.winnerIndex = room.players.findIndex((_, i) => i !== loserIndex && room.players[i].hand.length > 0);
    if (room.players.filter(p => p.hand.length > 0).length === 1) {
      room.winnerIndex = room.players.findIndex(p => p.hand.length > 0);
    }
  }

  return {
    ok: true,
    wasLying,
    revealedCards: lastPlay.cardIds.map(id => ({ id, rank: getRankFromId(id) })),
    claimedRank: lastPlay.claimedRank,
    loserIndex,
    cardCount,
    nextPlayerIndex: room.currentPlayerIndex,
    gameOver: room.state === 'finished',
    winnerIndex: room.winnerIndex,
  };
}

function trust(roomCode, socketId) {
  const room = rooms.get(roomCode);
  if (!room || room.state !== 'playing') return { ok: false, error: 'not_playing' };
  const playerIndex = room.players.findIndex(p => p.socketId === socketId);
  if (playerIndex === -1) return { ok: false, error: 'not_in_room' };
  if (room.currentPlayerIndex !== playerIndex) return { ok: false, error: 'not_your_turn' };

 // Если "Верю" и там действительно те карты, карты уходят в отбой и ход переходит тому, кто сказал «Верю»
  const lastPlay = room.pile[room.pile.length - 1];
  const wasRight = lastPlay && cardsMatchClaim(lastPlay.cardIds, lastPlay.claimedRank);
  if (wasRight) {
    const allCards = room.pile.flatMap(p => p.cardIds);
    room.discard.push(...allCards);
    room.pile = [];
    room.lastClaim = null;
    room.currentPlayerIndex = playerIndex;
  } else {
    room.currentPlayerIndex = (playerIndex + 1) % room.players.length;
  }
  return { ok: true, nextPlayerIndex: room.currentPlayerIndex };
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
