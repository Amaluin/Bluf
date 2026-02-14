import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import {
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
} from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

io.on('connection', (socket) => {
  socket.on('create_room', (playerName, cb) => {
    let code = generateRoomCode();
    while (getRoom(code)) code = generateRoomCode();
    const room = createRoom(code);
    const result = addPlayer(code, socket.id, playerName);
    if (!result.ok) return cb?.(result);
    socket.join(code);
    cb?.({ ok: true, roomCode: code, playerId: result.playerId, playerIndex: result.playerIndex });
    io.to(code).emit('room_updated', getRoomState(code));
  });

  socket.on('join_room', ({ roomCode, playerName }, cb) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = getRoom(code);
    if (!room) return cb?.({ ok: false, error: 'room_not_found' });
    const result = addPlayer(code, socket.id, playerName);
    if (!result.ok) return cb?.(result);
    socket.join(code);
    cb?.({ ok: true, roomCode: code, playerId: result.playerId, playerIndex: result.playerIndex });
    io.to(code).emit('room_updated', getRoomState(code));
  });

  socket.on('set_ready', (roomCode, cb) => {
    if (setReady(roomCode, socket.id)) {
      io.to(roomCode).emit('room_updated', getRoomState(roomCode));
      cb?.({ ok: true });
    } else cb?.({ ok: false });
  });

  function broadcastGameState(roomCode) {
    const room = getRoom(roomCode);
    if (!room) return;
    const { forPlayers } = getGameStateForRoom(room);
    forPlayers.forEach((state, i) => {
      const sid = room.players[i]?.socketId;
      if (sid) io.to(sid).emit('game_state', state);
    });
  }

  socket.on('start_game', (roomCode, cb) => {
    const result = startGame(roomCode, socket.id);
    if (!result.ok) return cb?.(result);
    io.to(roomCode).emit('dice_rolled', result.diceRolls);
    cb?.({ ok: true, diceRolls: result.diceRolls });
  });

  socket.on('confirm_dice_roll', (roomCode, cb) => {
    const result = confirmDiceRoll(roomCode, socket.id);
    if (!result.ok) return cb?.(result);
    io.to(roomCode).emit('game_started');
    broadcastGameState(roomCode);
    cb?.({ ok: true });
  });

  socket.on('play_cards', ({ roomCode, cardIds, claimedRank }, cb) => {
    const result = playCards(roomCode, socket.id, cardIds, claimedRank);
    if (!result.ok) return cb?.(result);
    broadcastGameState(roomCode);
    cb?.({ ok: true, ...result });
  });

  socket.on('challenge', (roomCode, cb) => {
    const result = challenge(roomCode, socket.id);
    if (!result.ok) return cb?.(result);
    io.to(roomCode).emit('challenge_result', result);
    broadcastGameState(roomCode);
    cb?.({ ok: true, ...result });
  });

  socket.on('trust', (roomCode, cb) => {
    const result = trust(roomCode, socket.id);
    if (!result.ok) return cb?.(result);
    broadcastGameState(roomCode);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    for (const [code, room] of io.sockets.adapter.rooms) {
      if (code.length === 6 && room.has(socket.id)) {
        const updated = removePlayer(code, socket.id);
        if (updated) io.to(code).emit('room_updated', getRoomState(code));
        else io.to(code).emit('room_closed');
        break;
      }
    }
  });
});

function getRoomState(roomCode) {
  const room = getRoom(roomCode);
  if (!room) return null;
  return {
    code: room.code,
    state: room.state,
    players: room.players.map((p, i) => ({
      index: i,
      id: p.id,
      socketId: p.socketId,
      name: p.name,
      isReady: p.isReady,
      handCount: p.hand?.length ?? 0,
    })),
  };
}

function getGameStateForRoom(room) {
  if (!room) return null;
  const publicState = {
    state: room.state,
    currentPlayerIndex: room.currentPlayerIndex,
    lastClaim: room.lastClaim,
    pileCount: room.pile.reduce((s, p) => s + p.cardIds.length, 0),
    discardCount: room.discard?.length || 0,
    winnerIndex: room.winnerIndex,
    players: room.players.map((p, i) => ({
      index: i,
      id: p.id,
      name: p.name,
      handCount: p.hand.length,
    })),
  };
  const perPlayer = room.players.map((p, i) => ({
    ...publicState,
    myIndex: i,
    myHand: p.hand,
    isMyTurn: room.state === 'playing' && room.currentPlayerIndex === i,
  }));
  return { public: publicState, forPlayers: perPlayer };
}

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`Bluf: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
