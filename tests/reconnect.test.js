/**
 * Автотест реконнекта: сценарий как на смартфоне в браузере.
 * Вкладка/приложение уходит в фон (socket отключается), затем пользователь
 * возвращается — новое соединение должно успешно выполнить rejoin_room
 * с сохранёнными roomCode и playerId (как из sessionStorage).
 */
import test from 'node:test';
import assert from 'node:assert';
import { httpServer } from '../server/index.js';
import { io } from 'socket.io-client';

test('reconnect: disconnect then rejoin_room with saved roomCode/playerId restores session', async () => {
  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const port = httpServer.address().port;
  const url = `http://127.0.0.1:${port}`;

  const client1 = io(url, { forceNew: true });
  await new Promise((r) => client1.once('connect', r));

  let roomCode;
  let playerId;
  const createRes = await new Promise((resolve) => {
    client1.emit('create_room', 'MobileUser', (res) => resolve(res));
  });
  assert.ok(createRes?.ok, 'create_room must succeed');
  roomCode = createRes.roomCode;
  playerId = createRes.playerId;
  assert.ok(roomCode && playerId, 'need roomCode and playerId for rejoin');

  const disconnected = new Promise((r) => client1.once('disconnect', r));
  client1.disconnect();
  await disconnected;
  await new Promise((r) => setTimeout(r, 150));

  const client2 = io(url, { forceNew: true });
  await Promise.race([
    new Promise((r) => client2.once('connect', r)),
    new Promise((_, rej) => setTimeout(() => rej(new Error('client2 connect timeout')), 3000)),
  ]);

  const rejoinRes = await Promise.race([
    new Promise((resolve) => {
      client2.emit('rejoin_room', { roomCode, playerId }, (res) => resolve(res));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('rejoin_room ack timeout')), 5000)),
  ]);

  assert.ok(rejoinRes?.ok, 'rejoin_room must succeed after reconnect');
  assert.strictEqual(rejoinRes.roomCode, roomCode);
  assert.strictEqual(typeof rejoinRes.playerIndex, 'number');
  assert.ok(rejoinRes.gameState != null, 'must return gameState (lobby or game)');
  assert.ok(
    rejoinRes.gameState.state === 'lobby' || rejoinRes.gameState.state === 'playing' || rejoinRes.gameState.state === 'finished',
    'gameState.state must be lobby/playing/finished'
  );

  // Проверка, что реконнект привязал новый сокет к тому же игроку (создатель = индекс 0)
  assert.strictEqual(rejoinRes.playerIndex, 0, 'reconnected player must be same slot (creator = 0)');

  // Проверка, что после rejoin новый сокет в комнате и может участвовать в чате (ack ok)
  const chatAck = await Promise.race([
    new Promise((resolve) => {
      client2.emit('chat_message', { roomCode, text: 'After rejoin' }, (cb) => resolve(cb));
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('chat_message ack timeout')), 3000)),
  ]);
  assert.strictEqual(chatAck?.ok, true, 'reconnected socket must be able to send chat (is in room)');

  const client2Gone = new Promise((r) => client2.once('disconnect', r));
  client2.disconnect();
  await client2Gone;
  await new Promise((resolve) => httpServer.close(() => resolve()));
});
