import test from 'node:test';
import assert from 'node:assert';
import { httpServer } from '../server/index.js';
import { io } from 'socket.io-client';

test('chat: message is delivered and ack is ok', async () => {
  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const port = httpServer.address().port;
  const url = `http://127.0.0.1:${port}`;
  const client1 = io(url, { forceNew: true });
  const client2 = io(url, { forceNew: true });
  await Promise.all([
    new Promise((r) => client1.once('connect', r)),
    new Promise((r) => client2.once('connect', r)),
  ]);

  const roomCode = await new Promise((resolve) => {
    client1.emit('create_room', 'Alice', (res) => resolve(res?.roomCode));
  });
  assert.ok(roomCode, 'create_room must return roomCode');

  await new Promise((resolve) => {
    client2.emit('join_room', { roomCode, playerName: 'Bob' }, () => resolve());
  });

  let received = null;
  client2.on('chat_message', (data) => {
    received = data;
  });

  const ack = await new Promise((resolve) => {
    client1.emit('chat_message', { roomCode, text: 'Hi' }, (cb) => resolve(cb));
  });
  assert.strictEqual(ack?.ok, true, 'chat_message ack must be ok: true');

  await new Promise((r) => setTimeout(r, 150));
  assert.ok(received, 'second client must receive chat_message');
  assert.strictEqual(received.text, 'Hi');
  assert.ok(received.playerName);
  assert.ok(received.playerId != null);

  client1.close();
  client2.close();
  await new Promise((resolve) => httpServer.close(() => resolve()));
});

test('chat: room not found returns ok: false', async () => {
  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const port = httpServer.address().port;
  const client = io(`http://127.0.0.1:${port}`, { forceNew: true });
  await new Promise((r) => client.once('connect', r));

  const ack = await new Promise((resolve) => {
    client.emit('chat_message', { roomCode: 'FAKE99', text: 'x' }, (cb) => resolve(cb));
  });
  assert.strictEqual(ack?.ok, false);
  assert.strictEqual(ack?.error, 'room_not_found');

  client.close();
  await new Promise((resolve) => httpServer.close(() => resolve()));
});

test('chat: not in room returns ok: false', async () => {
  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const port = httpServer.address().port;
  const client1 = io(`http://127.0.0.1:${port}`, { forceNew: true });
  const client2 = io(`http://127.0.0.1:${port}`, { forceNew: true });
  await Promise.all([
    new Promise((r) => client1.once('connect', r)),
    new Promise((r) => client2.once('connect', r)),
  ]);

  const roomCode = await new Promise((resolve) => {
    client1.emit('create_room', 'A', (res) => resolve(res?.roomCode));
  });
  // client2 не заходит в комнату
  const ack = await new Promise((resolve) => {
    client2.emit('chat_message', { roomCode, text: 'Hi' }, (cb) => resolve(cb));
  });
  assert.strictEqual(ack?.ok, false);
  assert.strictEqual(ack?.error, 'not_in_room');

  client1.close();
  client2.close();
  await new Promise((resolve) => httpServer.close(() => resolve()));
});
