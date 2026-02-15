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

// Хранилище таймеров отключения
const disconnectTimers = new Map();

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

  socket.on('rejoin_room', (data, cb) => {
    const roomCodeRaw = typeof data === 'object' && data !== null ? data.roomCode : data;
    const code = (roomCodeRaw || '').toUpperCase().trim();
    const room = getRoom(code);
    if (!room) return cb?.({ ok: false, error: 'room_not_found' });

    // Находим игрока по старому socketId или создаем нового
    let playerIndex = room.players.findIndex(p => p.socketId === socket.id);

    // Если игрок не найден, пытаемся найти отключенного игрока
    if (playerIndex === -1) {
      // Ищем первого игрока без активного соединения
      playerIndex = room.players.findIndex(p => !io.sockets.sockets.get(p.socketId));

      if (playerIndex !== -1) {
        const oldSocketId = room.players[playerIndex].socketId;

        // Отменяем таймер удаления для старого соединения
        if (disconnectTimers.has(oldSocketId)) {
          clearTimeout(disconnectTimers.get(oldSocketId));
          disconnectTimers.delete(oldSocketId);
          console.log(`Cancelled disconnect timer for ${oldSocketId}`);
        }

        // Обновляем socketId для переподключившегося игрока
        room.players[playerIndex].socketId = socket.id;
        console.log(`Player ${room.players[playerIndex].name} reconnected to room ${code}`);
      } else {
        return cb?.({ ok: false, error: 'player_not_found' });
      }
    }

    socket.join(code);

    // Отправляем текущее состояние игры
    let gameState = null;
    if (room.state === 'playing' || room.state === 'finished') {
      const { forPlayers } = getGameStateForRoom(room);
      gameState = forPlayers[playerIndex];
    }

    cb?.({
      ok: true,
      roomCode: code,
      playerIndex,
      gameState: gameState || { state: room.state }
    });

    // Обновляем состояние комнаты для всех
    io.to(code).emit('room_updated', getRoomState(code));

    // Если игра идет, отправляем обновленное состояние
    if (room.state === 'playing') {
      broadcastGameState(code);
    }
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

  socket.on('chat_message', (data, cb) => {
    const ack = typeof cb === 'function' ? cb : null;
    try {
      const roomCode = data && data.roomCode;
      const text = data && data.text;
      const code = roomCode && String(roomCode).toUpperCase().trim();
      console.log('[chat] received from', socket.id, { roomCode: code, textLen: (text && String(text).length) || 0 });
      if (!code) {
        ack?.({ ok: false, error: 'room_not_found' });
        return;
      }
      const room = getRoom(code);
      if (!room) {
        console.log('[chat] error: room_not_found', code);
        ack?.({ ok: false, error: 'room_not_found' });
        return;
      }
      let player = room.players.find(p => p.socketId === socket.id);
      if (!player && io.sockets.adapter.rooms.get(code)?.has(socket.id)) {
        const disconnectedIndex = room.players.findIndex(p => !io.sockets.sockets.get(p.socketId));
        if (disconnectedIndex !== -1) {
          room.players[disconnectedIndex].socketId = socket.id;
          player = room.players[disconnectedIndex];
          console.log('[chat] reattached socket to player', player.name, 'in room', code);
        }
      }
      if (!player) {
        console.log('[chat] error: not_in_room', socket.id, code);
        ack?.({ ok: false, error: 'not_in_room' });
        return;
      }
      const msg = String(text ?? '').trim();
      if (!msg) {
        ack?.({ ok: true });
        return;
      }
      const payload = { playerName: player.name, playerId: player.id, text: msg };
      console.log('[chat] broadcast to room', code, payload.playerName);
      io.to(code).emit('chat_message', payload);
      ack?.({ ok: true });
    } catch (err) {
      console.error('[chat] handler error', err);
      ack?.({ ok: false, error: 'server_error' });
    }
  });

  // WebRTC сигналинг: пересылка offer/answer/ice только внутри комнаты
  function forwardWebRTC(roomCode, targetSocketId, event, payload) {
    const code = roomCode && String(roomCode).toUpperCase().trim();
    const room = getRoom(code);
    if (!room) return false;
    const senderInRoom = room.players.some(p => p.socketId === socket.id);
    const targetInRoom = room.players.some(p => p.socketId === targetSocketId);
    if (!senderInRoom || !targetInRoom || targetSocketId === socket.id) return false;
    io.to(targetSocketId).emit(event, { fromSocketId: socket.id, ...payload });
    return true;
  }

  socket.on('webrtc_offer', ({ roomCode, targetSocketId, sdp }, cb) => {
    if (!forwardWebRTC(roomCode, targetSocketId, 'webrtc_offer', { sdp })) return cb?.({ ok: false });
    cb?.({ ok: true });
  });

  socket.on('webrtc_answer', ({ roomCode, targetSocketId, sdp }, cb) => {
    if (!forwardWebRTC(roomCode, targetSocketId, 'webrtc_answer', { sdp })) return cb?.({ ok: false });
    cb?.({ ok: true });
  });

  socket.on('webrtc_ice', ({ roomCode, targetSocketId, candidate }, cb) => {
    if (!forwardWebRTC(roomCode, targetSocketId, 'webrtc_ice', { candidate })) return cb?.({ ok: false });
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);

    // Находим комнату игрока
    let playerRoom = null;
    let playerData = null;

    for (const [code] of io.sockets.adapter.rooms) {
      if (code.length === 6) {
        const roomData = getRoom(code);
        if (roomData) {
          const player = roomData.players.find(p => p.socketId === socket.id);
          if (player) {
            playerRoom = code;
            playerData = player;
            break;
          }
        }
      }
    }

    if (playerRoom && playerData) {
      console.log(`Player ${playerData.name} disconnected from room ${playerRoom}, waiting for reconnection...`);

      // Устанавливаем таймер на удаление игрока (30 секунд)
      const timerId = setTimeout(() => {
        // Проверяем, переподключился ли игрок
        const roomData = getRoom(playerRoom);
        if (roomData) {
          const player = roomData.players.find(p => p.socketId === socket.id);
          if (player) {
            // Проверяем, активно ли соединение
            const socketStillExists = io.sockets.sockets.get(socket.id);
            if (!socketStillExists) {
              console.log(`Removing player ${playerData.name} from room ${playerRoom} after timeout`);
              const updated = removePlayer(playerRoom, socket.id);
              if (updated) {
                io.to(playerRoom).emit('room_updated', getRoomState(playerRoom));
              } else {
                io.to(playerRoom).emit('room_closed');
              }
              disconnectTimers.delete(socket.id);
            }
          }
        }
      }, 30000); // 30 секунд на переподключение

      disconnectTimers.set(socket.id, timerId);
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
    code: room.code,
    state: room.state,
    currentPlayerIndex: room.currentPlayerIndex,
    lastClaim: room.lastClaim,
    pileCount: room.pile.reduce((s, p) => s + p.cardIds.length, 0),
    discardCount: room.discard?.length || 0,
    winnerIndex: room.winnerIndex,
    players: room.players.map((p, i) => ({
      index: i,
      id: p.id,
      socketId: p.socketId,
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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__dirname, 'index.js');
if (isMain) {
  httpServer.listen(PORT, HOST, () => {
    console.log(`Bluf: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${httpServer.address().port}`);
  });
}

export { httpServer, io };
