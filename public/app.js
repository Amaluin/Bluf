/**
 * Клиент игры «Верю / Не верю» — Socket.IO, экраны, карты, действия.
 * Поддержка вертикальной и горизонтальной ориентации.
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
// Порядок мастей: чёрная–красная чередуются (♠♥♣♦)
const SUIT_ORDER = ['♠', '♥', '♣', '♦'];

function cardWordRu(n) {
  return n === 1 ? 'карта' : (n >= 2 && n <= 4 ? 'карты' : 'карт');
}

function sortHand(cardIds) {
  if (!Array.isArray(cardIds) || cardIds.length === 0) return cardIds;
  const rankValue = (r) => {
    const i = RANKS.indexOf(r);
    return i >= 0 ? i : 99;
  };
  const suitValue = (s) => {
    const i = SUIT_ORDER.indexOf(s);
    return i >= 0 ? i : 99;
  };
  return [...cardIds].sort((a, b) => {
    const pa = parseCardId(a);
    const pb = parseCardId(b);
    const rankDiff = rankValue(pa.rank) - rankValue(pb.rank);
    return rankDiff !== 0 ? rankDiff : suitValue(pa.suit) - suitValue(pb.suit);
  });
}

let socket = null;
let roomCode = null;
let myPlayerId = null; // Уникальный ID игрока для переподключения
let myIndex = -1;

const SESSION_ROOM = 'bluf_room';
const SESSION_PLAYER = 'bluf_player';

function persistRoom() {
  try {
    if (roomCode) sessionStorage.setItem(SESSION_ROOM, roomCode); else sessionStorage.removeItem(SESSION_ROOM);
    if (myPlayerId) sessionStorage.setItem(SESSION_PLAYER, myPlayerId); else sessionStorage.removeItem(SESSION_PLAYER);
  } catch (e) {}
}

function restoreRoomFromStorage() {
  try {
    var r = sessionStorage.getItem(SESSION_ROOM);
    var p = sessionStorage.getItem(SESSION_PLAYER);
    if (r) roomCode = r;
    if (p) myPlayerId = p;
  } catch (e) {}
}
let myHand = [];
let gameState = null;
let selectedCards = new Set();
let isHost = false;

/* Цвета имён в чате: палитра, у каждого игрока свой цвет */
var CHAT_COLORS = [
  '#e8b4bc', '#7ec8e3', '#9ddf9b', '#f7dc6f', '#bb8fce',
  '#85c1e9', '#f8b88b', '#a3e4d7', '#f5b7b1', '#aed6f1',
  '#d7bde2', '#f9e79f', '#82e0aa', '#fadbd8', '#d5f5e3',
];
var chatNameToColor = {};
var chatColorIndex = 0;

/* Лобби: видео/звук WebRTC (STUN + опционально TURN для смартфонов) */
function getLobbyIceServers() {
  var servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  var turn = typeof window !== 'undefined' && window.BLUF_TURN;
  if (turn && turn.url) {
    servers.push({
      urls: turn.url,
      username: turn.username || '',
      credential: turn.credential || ''
    });
  }
  return { iceServers: servers };
}
var LOBBY_STUN = getLobbyIceServers();
var lobbyMediaRequested = false;
var localLobbyStream = null;
var lobbyPeerConnections = {};
var lobbyRemoteStreams = {};
var lobbyRemoteMuted = {};
var lobbyIceQueue = {};
var lobbyRetryIntervalId = null;
var lastLobbyState = null;

const $ = (id) => document.getElementById(id);
const showScreen = (id) => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
};

function parseCardId(id) {
  const suitChar = id.match(/[♠♥♦♣]/)?.[0];
  const rank = id.replace(/[♠♥♦♣]/g, '').trim();
  return { rank, suit: suitChar || '', suitKey: SUITS[suitChar] || 'spades' };
}

function isRed(suitKey) {
  return suitKey === 'hearts' || suitKey === 'diamonds';
}

function renderCard(id, options = {}) {
  const inHand = options.inHand === true;
  const { rank, suit, suitKey } = parseCardId(id);
  const red = isRed(suitKey);
  const selected = options.selected || selectedCards.has(id);
  const back = options.back === true;
  const div = document.createElement('div');
  div.className = 'card' + (red ? ' red' : '') + (selected ? ' selected' : '') + (back ? ' back' : '') + (inHand ? ' card-in-hand' : '');
  div.dataset.cardId = id;
  if (!back) {
    div.innerHTML = inHand
      ? `<span class="card-corner"><span class="rank">${rank}</span><span class="suit">${suit}</span></span>`
      : `<span class="rank">${rank}</span><span class="suit">${suit}</span>`;
  } else {
    div.innerHTML = `<span class="rank">?</span><span class="suit">?</span>`;
  }
  return div;
}

function connect() {
  var serverUrl = (typeof window !== 'undefined' && window.BLUF_SERVER_URL) || '';
  socket = io(serverUrl, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity
  });

  socket.on('connect', () => {
    console.log('Connected');

    if (roomCode && myPlayerId) {
      console.log('Reconnecting to room:', roomCode, 'with playerId:', myPlayerId);
      socket.emit('rejoin_room', { roomCode, playerId: myPlayerId }, (res) => {
        if (res?.ok) {
          console.log('Successfully rejoined room');
          applyRejoinState(res);
        } else {
          console.log('Failed to rejoin room, returning to welcome screen');
          roomCode = null;
          myPlayerId = null;
          persistRoom();
          showScreen('screen-welcome');
        }
      });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    showConnectionStatus(false, { inRoom: !!roomCode });
  });

  socket.on('reconnect', (attemptNumber) => {
    console.log('Reconnected after', attemptNumber, 'attempts');
    showConnectionStatus(true, {});
  });

  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log('Reconnection attempt:', attemptNumber);
  });

  socket.on('reconnect_error', (error) => {
    console.log('Reconnection error:', error);
  });

  socket.on('room_updated', (state) => {
    if (!state) return;
    roomCode = state.code;
    updateChatVisibility();
    ensureChatColors(state.players || []);
    $('lobby-code').textContent = state.code;

    if (state.state === 'lobby') {
      lastLobbyState = state;
      if (state.players && state.players.length) {
        requestLobbyMedia().then(function () {
          renderLobbyWithVideos(state.players);
          ensureLobbyConnections(state.players);
        });
        if (state.players.length >= 2) {
          if (lobbyRetryIntervalId) clearInterval(lobbyRetryIntervalId);
          lobbyRetryIntervalId = setInterval(function () {
            if (!lastLobbyState || !lastLobbyState.players || lastLobbyState.players.length < 2) {
              if (lobbyRetryIntervalId) { clearInterval(lobbyRetryIntervalId); lobbyRetryIntervalId = null; }
              return;
            }
            ensureLobbyConnections(lastLobbyState.players);
          }, 3000);
        }
      } else {
        renderLobbyWithVideos(state.players || []);
      }
    } else {
      lastLobbyState = null;
      if (lobbyRetryIntervalId) { clearInterval(lobbyRetryIntervalId); lobbyRetryIntervalId = null; }
      renderLobbyWithVideos(state.players || []);
    }

    // Определяем, является ли текущий игрок хостом (первый игрок в списке)
    const firstPlayer = state.players[0];
    if (firstPlayer && firstPlayer.socketId === socket.id) {
      isHost = true;
    }

    const canStart = isHost && state.players.length >= 2 && state.players.length <= 6;

    // Показываем кнопку "Начать игру" только для хоста
    const startBtn = $('btn-start');
    if (isHost) {
      startBtn.style.display = 'block';
      startBtn.disabled = !canStart;
    } else {
      startBtn.style.display = 'none';
    }
  });

  function drainLobbyIceQueue(remoteSocketId) {
    var pc = lobbyPeerConnections[remoteSocketId];
    var queue = lobbyIceQueue[remoteSocketId];
    if (!pc || !queue || !queue.length) return;
    delete lobbyIceQueue[remoteSocketId];
    queue.forEach(function (c) {
      pc.addIceCandidate(new RTCIceCandidate(c)).catch(function (err) { console.warn('Lobby addIceCandidate (drain):', err); });
    });
  }

  socket.on('webrtc_offer', function (data) {
    var fromSocketId = data.fromSocketId;
    var sdp = data.sdp;
    if (!fromSocketId || !sdp || !roomCode) return;
    var existingPc = lobbyPeerConnections[fromSocketId];
    if (existingPc && existingPc.localDescription && existingPc.localDescription.type === 'offer') return;
    function doAnswer() {
      var pc = getOrCreateLobbyPeer(fromSocketId);
      if (localLobbyStream) localLobbyStream.getTracks().forEach(function (t) { pc.addTrack(t, localLobbyStream); });
      pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
        drainLobbyIceQueue(fromSocketId);
        return pc.createAnswer();
      }).then(function (answer) {
        return pc.setLocalDescription(answer);
      }).then(function () {
        socket.emit('webrtc_answer', { roomCode: roomCode, targetSocketId: fromSocketId, sdp: pc.localDescription });
      }).catch(function (err) { console.warn('Lobby answer error:', err); });
    }
    if (localLobbyStream) doAnswer();
    else requestLobbyMedia().then(doAnswer);
  });

  socket.on('webrtc_answer', function (data) {
    var fromSocketId = data.fromSocketId;
    var sdp = data.sdp;
    if (!fromSocketId || !sdp) return;
    var pc = lobbyPeerConnections[fromSocketId];
    if (!pc) return;
    pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
      drainLobbyIceQueue(fromSocketId);
    }).catch(function (err) { console.warn('Lobby setRemote answer:', err); });
  });

  socket.on('webrtc_ice', function (data) {
    var fromSocketId = data.fromSocketId;
    var candidate = data.candidate;
    if (!fromSocketId || !candidate) return;
    var pc = lobbyPeerConnections[fromSocketId];
    if (!pc) {
      if (!lobbyIceQueue[fromSocketId]) lobbyIceQueue[fromSocketId] = [];
      lobbyIceQueue[fromSocketId].push(candidate);
      return;
    }
    if (pc.remoteDescription) {
      pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(function (err) { console.warn('Lobby addIceCandidate:', err); });
    } else {
      if (!lobbyIceQueue[fromSocketId]) lobbyIceQueue[fromSocketId] = [];
      lobbyIceQueue[fromSocketId].push(candidate);
    }
  });

  socket.on('dice_rolled', (data) => {
    const diceRolls = Array.isArray(data) ? data : (data && data.diceRolls);
    if (!diceRolls || !diceRolls.length) return;
    showScreen('screen-dice');
    const resultsEl = $('dice-results');
    const maxRoll = Math.max(...diceRolls.map(d => d.roll));
    const isReroll = !Array.isArray(data) && data && data.tieReroll;
    if (isReroll && resultsEl) {
      const toast = document.createElement('div');
      toast.className = 'dice-reroll-toast';
      toast.textContent = 'Переброс при одинаковом результате';
      resultsEl.parentElement?.insertBefore(toast, resultsEl);
      setTimeout(() => toast.remove(), 2500);
    }
    if (resultsEl) {
      resultsEl.innerHTML = diceRolls.map(d => `
        <div class="dice-result ${d.roll === maxRoll ? 'winner' : ''}">
          <span class="dice-player-name">${escapeHtml(d.name)}</span>
          <span class="dice-roll-value">${d.roll}</span>
        </div>
      `).join('');
    }
  });

  socket.on('room_closed', () => {
    stopLobbyMedia();
    roomCode = null;
    myPlayerId = null;
    persistRoom();
    updateChatVisibility();
    showScreen('screen-welcome');
  });

  socket.on('player_disconnected', (data) => {
    if (data && data.playerName) {
      appendSystemMessage('Игрок ' + escapeHtml(data.playerName) + ' отключился. Ожидание переподключения (30 сек)…');
    }
  });

  socket.on('player_left', (data) => {
    if (data && data.playerName) {
      appendSystemMessage('Игрок ' + escapeHtml(data.playerName) + ' вышел из игры.');
    }
  });

  socket.on('chat_message', (data) => {
    console.log('[chat] received:', data);
    if (!data || !data.playerName) {
      console.log('[chat] receive ignored: no data or playerName');
      return;
    }
    var isOurEcho = data.playerName === getMyPlayerName() && data.text === lastSentChatText && (Date.now() - lastSentChatTime) < 5000;
    if (isOurEcho) {
      lastSentChatText = '';
      return;
    }
    ensureChatColors([{ name: data.playerName }]);
    appendChatMessage(data.playerName, data.text);
  });

  socket.on('game_started', () => {
    showScreen('screen-game');
  });

  socket.on('game_state', (state) => {
    gameState = state;
    myIndex = state.myIndex;
    myHand = sortHand(state.myHand || []);
    selectedCards.clear();
    if (state.code) roomCode = state.code;
    if (state.players && state.players.length) ensureChatColors(state.players);
    updateChatVisibility();
    updateGameUI(state);
  });

  socket.on('challenge_result', (result) => {
    const msg = result.wasLying
      ? `Блеф! Заявлено: ${result.claimedRank}. Карты уходят игроку, который положил.`
      : `Правда. Карты забирает вызвавший «Не верю».`;

    // Показываем сообщение о результате
    const toast = $('challenge-toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');

    // Если есть карты для показа, отображаем их на 3 секунды
    if (result.revealedCards && result.revealedCards.length > 0) {
      showRevealedCards(result.revealedCards, () => {
        // После показа карт скрываем тост и анимируем перемещение
        setTimeout(() => {
          toast.classList.add('hidden');
          if (result.loserIndex !== undefined) {
            animateCardsToPlayer(result.loserIndex, result.cardCount || 1);
          }
        }, 500);
      });
    } else {
      // Если карт нет, просто скрываем тост через 4 секунды
      setTimeout(() => toast.classList.add('hidden'), 4000);
      if (result.loserIndex !== undefined) {
        animateCardsToPlayer(result.loserIndex, result.cardCount || 1);
      }
    }
  });
}

function updateGameUI(state) {
  console.log('updateGameUI called with state:', state);

  $('game-status').textContent = state.isMyTurn ? 'Ваш ход' : `Ход: ${state.players[state.currentPlayerIndex]?.name || '—'}`;
  const claimEl = $('game-claim');
  const claimCountEl = $('game-claim-count');
  const claimCardsEl = $('game-claim-cards');
  if (state.lastClaim) {
    claimEl.classList.remove('hidden');
    var n = state.lastClaim.count;
    var rank = state.lastClaim.rank;
    var cardWord = n === 1 ? 'карта' : (n >= 2 && n <= 4 ? 'карты' : 'карт');
    claimCountEl.textContent = n + ' ' + cardWord + ' — ' + rank;
    claimCardsEl.innerHTML = Array(n)
      .fill(rank)
      .map(function (r) {
        return '<span class="claim-chip">' + escapeHtml(r) + '</span>';
      })
      .join('');
  } else {
    claimEl.classList.add('hidden');
    claimCountEl.textContent = '';
    claimCardsEl.innerHTML = '';
  }

  const pileCount = state.pileCount || 0;
  const pileEl = $('pile-cards');
  const pileCountEl = $('pile-count');
  pileEl.innerHTML = '';
  if (pileCount > 0) {
    const maxVisible = 15;
    for (let i = 0; i < Math.min(pileCount, maxVisible); i++) {
      const back = document.createElement('div');
      back.className = 'card card-back pile-card';
      back.style.setProperty('--pile-i', i);
      pileEl.appendChild(back);
    }
    if (pileCount > maxVisible) {
      const badge = document.createElement('span');
      badge.className = 'pile-badge';
      badge.textContent = '+' + (pileCount - maxVisible);
      pileEl.appendChild(badge);
    }
    pileCountEl.textContent = `Карт в куче: ${pileCount}`;
  } else {
    pileCountEl.textContent = '';
  }

  // Отображение отбоя
  const discardCount = state.discardCount || 0;
  const discardCountEl = $('discard-count');
  const discardCardsEl = $('discard-cards');

  if (discardCountEl) {
    discardCountEl.textContent = `Отбой: ${discardCount}`;
  }

  // Отображаем стопку карт в отбое
  if (discardCardsEl) {
    discardCardsEl.innerHTML = '';
    const maxVisible = 8;
    const visibleCount = Math.min(discardCount, maxVisible);

    for (let i = 0; i < visibleCount; i++) {
      const card = document.createElement('div');
      card.className = 'discard-card';

      // Случайный поворот для каждой карты
      const rotation = (Math.random() - 0.5) * 15;
      const offsetX = (Math.random() - 0.5) * 4;
      const offsetY = (Math.random() - 0.5) * 4;

      card.style.setProperty('--discard-rotation', `${rotation}deg`);
      card.style.left = `${offsetX}px`;
      card.style.top = `${offsetY}px`;
      card.style.zIndex = i;
      card.style.animationDelay = `${i * 0.05}s`;

      discardCardsEl.appendChild(card);
    }
  }

  const opponentsEl = $('opponents');
  const opponents = state.players.filter((_, i) => i !== myIndex);

  console.log('Opponents data:', opponents);
  console.log('My index:', myIndex);
  console.log('All players:', state.players);

  if (opponents.length === 0) {
    opponentsEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem;">Ожидание других игроков...</div>';
  } else {
    opponentsEl.innerHTML = opponents
      .map(p => {
        const isCurrent = p.index === state.currentPlayerIndex;
        const cardCount = p.handCount || 0;
        const maxVisible = 8;
        const visibleCards = Math.min(cardCount, maxVisible);
        const sid = p.socketId || '';

        let cardsHtml = '';
        for (let i = 0; i < visibleCards; i++) {
          cardsHtml += '<div class="opponent-card-back"></div>';
        }
        if (cardCount > maxVisible) {
          cardsHtml += `<div class="opponent-card-badge">+${cardCount - maxVisible}</div>`;
        }

        const soundLabel = lobbyRemoteMuted[sid] ? 'Вкл. звук' : 'Выкл. звук';
        const cardCountText = cardCount + ' ' + cardWordRu(cardCount);
        return `<div class="opponent ${isCurrent ? 'current' : ''}" data-socket-id="${escapeHtml(sid)}">
          <div class="opponent-video-wrap">
            <video class="opponent-video-el" autoplay playsinline muted></video>
            <div class="opponent-video-placeholder"></div>
          </div>
          <div class="opponent-info">
            <div class="opponent-name">${escapeHtml(p.name)}</div>
            <div class="opponent-card-count">${escapeHtml(cardCountText)}</div>
            <button type="button" class="btn btn-ghost btn-sm game-btn-sound" data-socket-id="${escapeHtml(sid)}">${escapeHtml(soundLabel)}</button>
            <div class="opponent-hand">${cardsHtml}</div>
          </div>
        </div>`;
      })
      .join('');
    opponentsEl.querySelectorAll('.opponent').forEach(function (el) {
      var sid = el.getAttribute('data-socket-id');
      var video = el.querySelector('.opponent-video-el');
      var placeholder = el.querySelector('.opponent-video-placeholder');
      if (!video || !placeholder) return;
      if (sid && lobbyRemoteStreams[sid]) {
        video.srcObject = lobbyRemoteStreams[sid];
        video.muted = !!lobbyRemoteMuted[sid];
        video.style.display = 'block';
        placeholder.style.display = 'none';
        video.play().catch(function () {});
      } else {
        video.srcObject = null;
        video.style.display = 'none';
        placeholder.style.display = 'block';
      }
    });
  }

  var myVideoWrap = document.getElementById('my-video-wrap');
  if (myVideoWrap) {
    var myV = myVideoWrap.querySelector('.my-video-el');
    var myPh = myVideoWrap.querySelector('.my-video-placeholder');
    if (myV && myPh) {
      if (localLobbyStream) {
        myV.srcObject = localLobbyStream;
        myV.style.display = 'block';
        myPh.style.display = 'none';
      } else {
        myV.srcObject = null;
        myV.style.display = 'none';
        myPh.style.display = 'block';
      }
    }
    var myState = getMyLobbyCamMicState();
    var camBtn = myVideoWrap.querySelector('.game-btn-cam');
    var micBtn = myVideoWrap.querySelector('.game-btn-mic');
    if (camBtn) {
      camBtn.textContent = 'Камера ' + (myState.cam ? 'вкл' : 'выкл');
      camBtn.classList.toggle('lobby-btn-off', !myState.cam);
    }
    if (micBtn) {
      micBtn.textContent = 'Микрофон ' + (myState.mic ? 'вкл' : 'выкл');
      micBtn.classList.toggle('lobby-btn-off', !myState.mic);
    }
  }

  // Используем redrawHand для отрисовки карт
  redrawHand();

  const isFirstMove = !state.lastClaim;
  const canPlayCards = state.isMyTurn && selectedCards.size >= 1 && selectedCards.size <= 4;
  const canTrust = state.isMyTurn && state.lastClaim;
  const canChallenge = state.isMyTurn && state.lastClaim;

  const rankSelect = $('select-rank');
  const rankButtons = $('rank-buttons');
  if (state.isMyTurn && isFirstMove && myHand.length > 0) {
    rankSelect.classList.remove('hidden');
    rankButtons.innerHTML = RANKS.map(r => `<button type="button" class="rank-btn" data-rank="${r}">${r}</button>`).join('');
    rankButtons.querySelectorAll('.rank-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const rank = btn.dataset.rank;
        if (selectedCards.size >= 1 && selectedCards.size <= 4) {
          socket.emit('play_cards', {
            roomCode,
            cardIds: [...selectedCards],
            claimedRank: rank,
          }, (res) => {
            if (res && res.ok) {
              selectedCards.clear();
              rankSelect.classList.add('hidden');
            }
          });
        }
      });
    });
    $('btn-play').disabled = true;
    $('btn-trust').disabled = true;
    $('btn-challenge').disabled = true;
  } else if (state.isMyTurn && state.lastClaim && canPlayCards) {
    rankSelect.classList.add('hidden');
    $('btn-play').disabled = false;
    $('btn-trust').disabled = false;
    $('btn-challenge').disabled = false;
  } else {
    rankSelect.classList.add('hidden');
    $('btn-play').disabled = !canPlayCards;
    $('btn-trust').disabled = !canTrust;
    $('btn-challenge').disabled = !canChallenge;
  }

  $('btn-play').onclick = () => {
    if (!gameState?.isMyTurn || selectedCards.size < 1 || selectedCards.size > 4) return;
    const claimedRank = gameState.lastClaim ? gameState.lastClaim.rank : null;
    if (!claimedRank) return;
    socket.emit('play_cards', {
      roomCode,
      cardIds: [...selectedCards],
      claimedRank,
    }, (res) => {
      if (res?.ok) selectedCards.clear();
    });
  };

  if (state.gameOver !== undefined && state.winnerIndex >= 0) {
    const winner = state.players[state.winnerIndex];
    $('game-status').textContent = winner ? `Победитель: ${winner.name}` : 'Игра окончена';
    $('btn-play').disabled = true;
    $('btn-trust').disabled = true;
    $('btn-challenge').disabled = true;
  }

  // Финальная таблица очков (когда игра завершена с подсчётом)
  const overlay = $('game-final-overlay');
  const tbody = $('game-final-tbody');
  const winnerEl = $('game-final-winner');
  if (overlay && tbody && winnerEl) {
    if (state.state === 'finished' && state.finalScores && state.finalScores.length > 0) {
      overlay.classList.remove('hidden');
      const winner = state.winnerIndex >= 0 ? state.players[state.winnerIndex] : null;
      winnerEl.textContent = winner ? `Победитель: ${winner.name}` : 'Игра окончена';
      tbody.innerHTML = state.finalScores.map((row, i) => {
        const isWinner = state.winnerIndex >= 0 && row.playerIndex === state.winnerIndex;
        return `<tr class="${isWinner ? 'final-winner-row' : ''}">
          <td>${escapeHtml(row.name)}</td>
          <td>${row.points}</td>
        </tr>`;
      }).join('');
    } else {
      overlay.classList.add('hidden');
    }
  }
}

function toggleCard(cardId) {
  if (!gameState?.isMyTurn) return;

  const wasSelected = selectedCards.has(cardId);

  if (wasSelected) {
    selectedCards.delete(cardId);
  } else {
    if (selectedCards.size >= 4) {
      // Вибрация при достижении лимита (если поддерживается)
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      return;
    }
    selectedCards.add(cardId);
    // Легкая вибрация при выборе карты
    if (navigator.vibrate) {
      navigator.vibrate(20);
    }
  }

  updateSelectedIndicator();
  redrawHand();
  updateGameUI(gameState);
}

function updateSelectedIndicator() {
  const indicator = $('selected-indicator');
  const countEl = $('selected-count');
  if (selectedCards.size > 0) {
    countEl.textContent = selectedCards.size;
    indicator.classList.remove('hidden');

    // Подсветка при достижении максимума
    if (selectedCards.size >= 4) {
      indicator.classList.add('max-reached');
    } else {
      indicator.classList.remove('max-reached');
    }
  } else {
    indicator.classList.add('hidden');
    indicator.classList.remove('max-reached');
  }
}

function redrawHand() {
  const handCountEl = document.getElementById('my-hand-count');
  if (handCountEl) {
    const n = myHand.length;
    handCountEl.textContent = n + ' ' + cardWordRu(n);
    handCountEl.classList.toggle('hidden', n === 0);
  }
  const handEl = $('my-hand');
  handEl.innerHTML = '';
  myHand.forEach((cardId, index) => {
    const card = renderCard(cardId, { inHand: true, selected: selectedCards.has(cardId) });
    card.style.setProperty('--card-index', index);
    card.style.setProperty('--card-total', myHand.length);
    if (selectedCards.has(cardId)) {
      const selectedIndex = [...selectedCards].indexOf(cardId);
      card.style.setProperty('--selected-index', selectedIndex);
    }

    // Улучшенная обработка касаний для мобильных
    let touchStartTime = 0;
    let touchMoved = false;

    card.addEventListener('touchstart', (e) => {
      touchStartTime = Date.now();
      touchMoved = false;
    }, { passive: true });

    card.addEventListener('touchmove', () => {
      touchMoved = true;
    }, { passive: true });

    card.addEventListener('touchend', (e) => {
      const touchDuration = Date.now() - touchStartTime;
      // Игнорируем случайные касания (слишком короткие или с движением)
      if (!touchMoved && touchDuration > 50 && touchDuration < 500) {
        e.preventDefault();
        toggleCard(cardId);
      }
    });

    // Для десктопа оставляем обычный клик
    card.addEventListener('click', (e) => {
      // Проверяем, что это не touch событие
      if (e.detail !== 0) {
        toggleCard(cardId);
      }
    });

    handEl.appendChild(card);
  });
}

let reconnectionTimeoutId = null;

function showConnectionStatus(connected, options) {
  let statusEl = $('connection-status');

  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'connection-status';
    statusEl.className = 'connection-status';
    document.body.appendChild(statusEl);
  }

  if (reconnectionTimeoutId) {
    clearTimeout(reconnectionTimeoutId);
    reconnectionTimeoutId = null;
  }

  if (connected) {
    statusEl.textContent = 'Подключено';
    statusEl.classList.add('connected');
    statusEl.classList.remove('disconnected', 'retry');
    statusEl.onclick = null;
    statusEl.title = '';

    setTimeout(() => {
      statusEl.classList.add('hidden');
    }, 2000);
  } else {
    const inRoom = options && options.inRoom;
    statusEl.classList.add('disconnected');
    statusEl.classList.remove('connected', 'hidden');

    if (inRoom) {
      statusEl.textContent = 'Переподключение...';
      statusEl.classList.remove('retry');
      statusEl.onclick = null;
      statusEl.title = '';

      reconnectionTimeoutId = setTimeout(() => {
        reconnectionTimeoutId = null;
        statusEl.textContent = 'Нет связи. Нажмите для повтора';
        statusEl.classList.add('retry');
        statusEl.title = 'Нажмите, чтобы переподключиться';
        statusEl.onclick = () => {
          if (socket && !socket.connected) {
            statusEl.textContent = 'Переподключение...';
            statusEl.classList.remove('retry');
            statusEl.onclick = null;
            socket.connect();
          }
        };
      }, 20000);
    } else {
      statusEl.textContent = 'Нет соединения';
      statusEl.title = 'Соединение восстановится автоматически';
      statusEl.onclick = null;
    }
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function ensureChatColors(players) {
  if (!players || !players.length) return;
  players.forEach(function (p) {
    var name = p && p.name ? String(p.name) : '';
    if (name && !chatNameToColor[name]) {
      chatNameToColor[name] = CHAT_COLORS[chatColorIndex % CHAT_COLORS.length];
      chatColorIndex += 1;
    }
  });
}

function getChatColorForName(playerName) {
  var name = playerName ? String(playerName) : '';
  return chatNameToColor[name] || CHAT_COLORS[0];
}

function updateChatVisibility() {
  var w = document.getElementById('chat-widget');
  if (!w) return;
  if (roomCode) {
    w.classList.remove('hidden');
  } else {
    w.classList.add('hidden');
    w.classList.remove('is-open');
    var list = document.getElementById('chat-messages');
    if (list) list.innerHTML = '';
  }
}

function getMyPlayerName() {
  if (gameState && gameState.players && gameState.players[myIndex]) return gameState.players[myIndex].name;
  if (lastLobbyState && lastLobbyState.players && lastLobbyState.players[myIndex]) return lastLobbyState.players[myIndex].name;
  return 'Вы';
}

function appendChatMessage(playerName, text) {
  var list = document.getElementById('chat-messages');
  if (!list) return;
  var color = getChatColorForName(playerName);
  var msg = document.createElement('div');
  msg.className = 'chat-message';
  msg.innerHTML = '<span class="chat-name" style="color:' + escapeHtml(color) + '">' + escapeHtml(playerName) + ':</span> ' + escapeHtml(text);
  list.appendChild(msg);
  list.scrollTop = list.scrollHeight;
}

function appendSystemMessage(text) {
  var list = document.getElementById('chat-messages');
  if (!list) return;
  var msg = document.createElement('div');
  msg.className = 'chat-message chat-message-system';
  msg.textContent = text;
  list.appendChild(msg);
  list.scrollTop = list.scrollHeight;
}

var lastSentChatText = '';
var lastSentChatTime = 0;

function sendChatMessage() {
  var input = document.getElementById('chat-input');
  if (!input || !roomCode || !socket) {
    console.log('[chat] send skipped: input=', !!input, 'roomCode=', roomCode, 'socket=', !!socket);
    return;
  }
  var text = (input.value || '').trim();
  if (!text) {
    console.log('[chat] send skipped: empty text');
    return;
  }
  input.value = '';
  var myName = getMyPlayerName();
  ensureChatColors([{ name: myName }]);
  appendChatMessage(myName, text);
  lastSentChatText = text;
  lastSentChatTime = Date.now();

  console.log('[chat] sending:', { socketId: socket.id, roomCode: roomCode, textLen: text.length, connected: socket.connected });
  var sendTimeout = setTimeout(function () {
    sendTimeout = null;
    console.warn('[chat] send timeout — нет ответа от сервера.');
    showChatError('Сообщение может не дойти до других. Переподключаемся…');
    if (roomCode && myPlayerId && socket) {
      socket.disconnect();
      socket.connect();
    }
  }, 6000);
  socket.emit('chat_message', { roomCode: roomCode, text: text }, function (res) {
    if (sendTimeout) {
      clearTimeout(sendTimeout);
      sendTimeout = null;
    }
    if (!res || !res.ok) {
      console.warn('[chat] send callback error:', res);
      if (res && res.error === 'not_in_room') showChatError('Сессия устарела. Выйдите и зайдите в комнату снова.');
      else if (res && res.error === 'room_not_found') showChatError('Комната не найдена.');
      else showChatError('Не удалось отправить.');
      return;
    }
    console.log('[chat] send ok');
  });
}

function showChatError(msg) {
  var panel = document.getElementById('chat-panel');
  if (!panel) return;
  var el = document.createElement('div');
  el.className = 'chat-error-toast';
  el.textContent = msg;
  panel.appendChild(el);
  setTimeout(function () { el.remove(); }, 4000);
}

function isMediaAllowedByBrowser() {
  // Камера/микрофон доступны только в безопасном контексте: https или localhost
  return typeof window !== 'undefined' && window.isSecureContext === true;
}

function showLobbyToast(msg) {
  var lobby = document.getElementById('screen-lobby');
  if (!lobby) return;
  var el = document.createElement('div');
  el.className = 'copy-notification';
  el.style.marginTop = '8px';
  el.textContent = msg;
  lobby.querySelector('.lobby-card')?.appendChild(el);
  setTimeout(function () { el.remove(); }, 8000);
}

function requestLobbyMedia() {
  if (lobbyMediaRequested) return Promise.resolve();
  lobbyMediaRequested = true;
  if (!isMediaAllowedByBrowser()) {
    showLobbyToast('Камера и микрофон работают только по HTTPS или с localhost. На сервере включите HTTPS или заходите с этого компьютера по http://localhost:3000');
    return Promise.resolve();
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.resolve();
  }
  var audioConstraints = {
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: true
  };
  return navigator.mediaDevices.getUserMedia({
    video: true,
    audio: audioConstraints
  })
    .then(function (stream) {
      localLobbyStream = stream;
    })
    .catch(function (err) {
      localLobbyStream = null;
      console.warn('Lobby camera/mic:', err);
    });
}

function stopLobbyMedia() {
  lobbyMediaRequested = false;
  if (localLobbyStream) {
    localLobbyStream.getTracks().forEach(function (t) { t.stop(); });
    localLobbyStream = null;
  }
  Object.keys(lobbyPeerConnections).forEach(function (sid) {
    try { lobbyPeerConnections[sid].close(); } catch (e) {}
  });
  lobbyPeerConnections = {};
  lobbyRemoteStreams = {};
  lobbyRemoteMuted = {};
  lobbyIceQueue = {};
}

function getOrCreateLobbyPeer(remoteSocketId) {
  if (lobbyPeerConnections[remoteSocketId]) return lobbyPeerConnections[remoteSocketId];
  var pc = new RTCPeerConnection(getLobbyIceServers());
  pc._remoteSocketId = remoteSocketId;
  pc.onicecandidate = function (e) {
    if (!e.candidate || !roomCode || !socket) return;
    socket.emit('webrtc_ice', { roomCode: roomCode, targetSocketId: remoteSocketId, candidate: e.candidate });
  };
  pc.ontrack = function (e) {
    var stream = e.streams && e.streams[0] ? e.streams[0] : (e.track ? new MediaStream([e.track]) : null);
    if (!stream) return;
    lobbyRemoteStreams[remoteSocketId] = stream;
    function playVideo(v) {
      if (!v || !v.srcObject) return;
      v.muted = true;
      v.play().catch(function () {});
    }
    var list = document.querySelectorAll('.lobby-player');
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute('data-socket-id') === remoteSocketId) {
        var video = list[i].querySelector('.lobby-video-el');
        if (video) {
          video.srcObject = stream;
          video.muted = !!lobbyRemoteMuted[remoteSocketId];
          playVideo(video);
        }
        break;
      }
    }
    var opponentEls = document.querySelectorAll('.opponent');
    for (var j = 0; j < opponentEls.length; j++) {
      if (opponentEls[j].getAttribute('data-socket-id') !== remoteSocketId) continue;
      var v = opponentEls[j].querySelector('.opponent-video-el');
      var ph = opponentEls[j].querySelector('.opponent-video-placeholder');
      if (v) {
        v.srcObject = stream;
        v.muted = !!lobbyRemoteMuted[remoteSocketId];
        v.style.display = 'block';
        playVideo(v);
      }
      if (ph) ph.style.display = 'none';
    }
  };
  pc.onconnectionstatechange = function () {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
      delete lobbyRemoteStreams[remoteSocketId];
    }
  };
  lobbyPeerConnections[remoteSocketId] = pc;
  return pc;
}

function createLobbyOffer(remoteSocketId) {
  if (!localLobbyStream || !roomCode || !socket) return;
  var pc = getOrCreateLobbyPeer(remoteSocketId);
  localLobbyStream.getTracks().forEach(function (track) { pc.addTrack(track, localLobbyStream); });
  pc.createOffer().then(function (offer) {
    return pc.setLocalDescription(offer);
  }).then(function () {
    socket.emit('webrtc_offer', { roomCode: roomCode, targetSocketId: remoteSocketId, sdp: pc.localDescription });
  }).catch(function (err) { console.warn('Lobby offer error:', err); });
}

function ensureLobbyConnections(players) {
  if (!socket || !roomCode || !players || !players.length) return;
  var myId = socket.id;
  var currentIds = players.map(function (p) { return p.socketId; }).filter(Boolean);
  currentIds.forEach(function (sid) {
    if (sid === myId) return;
    if (myId < sid) {
      var pc = lobbyPeerConnections[sid];
      if (!pc || pc.connectionState === 'new' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        createLobbyOffer(sid);
      }
    }
  });
  Object.keys(lobbyPeerConnections).forEach(function (sid) {
    if (currentIds.indexOf(sid) === -1) {
      try { lobbyPeerConnections[sid].close(); } catch (e) {}
      delete lobbyPeerConnections[sid];
      delete lobbyRemoteStreams[sid];
      delete lobbyIceQueue[sid];
    }
  });
}

function getMyLobbyCamMicState() {
  var cam = true;
  var mic = true;
  if (localLobbyStream) {
    var vt = localLobbyStream.getVideoTracks()[0];
    var at = localLobbyStream.getAudioTracks()[0];
    if (vt) cam = vt.enabled;
    if (at) mic = at.enabled;
  }
  return { cam: cam, mic: mic };
}

function renderLobbyWithVideos(players) {
  var list = $('lobby-players');
  if (!list) return;
  if (!players || !players.length) {
    list.innerHTML = '';
    return;
  }
  var myId = socket ? socket.id : '';
  var myState = getMyLobbyCamMicState();
  list.innerHTML = players.map(function (p) {
    var sid = p.socketId || '';
    var name = escapeHtml(p.name || '');
    var isSelf = sid === myId;
    var stream = isSelf ? localLobbyStream : lobbyRemoteStreams[sid];
    var hasVideo = !!stream;
    var videoHtml = hasVideo
      ? '<video class="lobby-video-el" autoplay playsinline ' + (isSelf ? 'muted ' : '') + 'style="transform:scaleX(' + (isSelf ? '-1' : '1') + ')"></video>'
      : '<div class="lobby-video-placeholder"></div>';
    var buttonsHtml;
    if (isSelf) {
      var camClass = myState.cam ? '' : ' lobby-btn-off';
      var micClass = myState.mic ? '' : ' lobby-btn-off';
      buttonsHtml = '<div class="lobby-player-buttons">' +
        '<button type="button" class="btn btn-ghost btn-sm lobby-btn-toggle' + camClass + '" data-action="cam">Камера ' + (myState.cam ? 'вкл' : 'выкл') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm lobby-btn-toggle' + micClass + '" data-action="mic">Микрофон ' + (myState.mic ? 'вкл' : 'выкл') + '</button>' +
        '</div>';
    } else {
      var soundLabel = lobbyRemoteMuted[sid] ? 'Вкл. звук' : 'Выкл. звук';
      buttonsHtml = '<button type="button" class="btn btn-ghost btn-sm lobby-btn-toggle" data-action="sound">' + escapeHtml(soundLabel) + '</button>';
    }
    return '<li class="lobby-player" data-socket-id="' + escapeHtml(sid) + '" data-is-self="' + (isSelf ? '1' : '0') + '">' +
      '<div class="lobby-video-wrap">' + videoHtml + '</div>' +
      '<div class="lobby-player-info">' +
      '<span class="lobby-player-name">' + name + '</span>' +
      buttonsHtml +
      '</div></li>';
  }).join('');
  list.querySelectorAll('.lobby-video-el').forEach(function (video, i) {
    var li = video.closest('.lobby-player');
    var sid = li && li.getAttribute('data-socket-id');
    if (!sid) return;
    if (sid === myId) {
      video.srcObject = localLobbyStream;
    } else {
      if (lobbyRemoteStreams[sid]) {
        video.srcObject = lobbyRemoteStreams[sid];
        video.muted = !!lobbyRemoteMuted[sid];
        video.play().catch(function () {});
      }
    }
  });
}

function animateCardsToPlayer(playerIndex, cardCount = 1) {
  const pileEl = $('pile-cards');
  if (!pileEl) return;

  const pileRect = pileEl.getBoundingClientRect();
  let targetEl;

  if (playerIndex === myIndex) {
    targetEl = $('my-hand');
  } else {
    const opponents = document.querySelectorAll('.opponent');
    const opponentIndex = gameState?.players.filter((_, i) => i !== myIndex).findIndex(p => p.index === playerIndex);
    targetEl = opponents[opponentIndex];
  }

  if (!targetEl) return;

  const targetRect = targetEl.getBoundingClientRect();
  const numCards = Math.min(cardCount, 10);

  for (let i = 0; i < numCards; i++) {
    setTimeout(() => {
      const card = document.createElement('div');
      card.className = 'flying-card';

      card.style.left = `${pileRect.left + pileRect.width / 2 - 22}px`;
      card.style.top = `${pileRect.top + pileRect.height / 2 - 30}px`;

      const endX = targetRect.left + targetRect.width / 2 - pileRect.left - pileRect.width / 2;
      const endY = targetRect.top + targetRect.height / 2 - pileRect.top - pileRect.height / 2;
      const midX = endX * 0.5 + (Math.random() - 0.5) * 100;
      const midY = endY * 0.5 - 100;

      card.style.setProperty('--fly-mid-x', `${midX}px`);
      card.style.setProperty('--fly-mid-y', `${midY}px`);
      card.style.setProperty('--fly-end-x', `${endX}px`);
      card.style.setProperty('--fly-end-y', `${endY}px`);

      document.body.appendChild(card);

      setTimeout(() => {
        card.remove();
      }, 800);
    }, i * 80);
  }
}

function showRevealedCards(cards, onComplete) {
  // Создаем оверлей для показа карт
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    animation: fadeIn 0.3s ease;
  `;

  const title = document.createElement('div');
  title.textContent = 'Раскрытые карты:';
  title.style.cssText = `
    color: var(--gold);
    font-size: 1.2rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
  `;
  overlay.appendChild(title);

  const cardsContainer = document.createElement('div');
  cardsContainer.style.cssText = `
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    justify-content: center;
    max-width: 90%;
  `;

  cards.forEach((cardId, index) => {
    const card = renderCard(cardId, { inHand: false });
    card.style.cssText = `
      width: 60px;
      height: 84px;
      min-width: 60px;
      min-height: 84px;
      animation: cardReveal 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;
      animation-delay: ${index * 0.1}s;
    `;
    cardsContainer.appendChild(card);
  });

  overlay.appendChild(cardsContainer);
  document.body.appendChild(overlay);

  // Автоматически закрываем через 3 секунды
  setTimeout(() => {
    overlay.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => {
      overlay.remove();
      if (onComplete) onComplete();
    }, 300);
  }, 3000);
}

function copyRoomCode() {
  const codeEl = $('lobby-code');
  const notification = $('copy-notification');
  const code = codeEl.textContent;

  if (!code) return;

  // Пытаемся скопировать в буфер обмена
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(() => {
      showCopyNotification(notification);
    }).catch(() => {
      // Fallback для старых браузеров
      fallbackCopyToClipboard(code, notification);
    });
  } else {
    fallbackCopyToClipboard(code, notification);
  }
}

function fallbackCopyToClipboard(text, notification) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
    showCopyNotification(notification);
  } catch (err) {
    console.error('Не удалось скопировать код:', err);
  }
  document.body.removeChild(textArea);
}

function showCopyNotification(notification) {
  if (!notification) return;
  notification.classList.remove('hidden');
  setTimeout(() => {
    notification.classList.add('hidden');
  }, 2000);
}

function applyRejoinState(res) {
  if (!res?.ok) return;
  if (res.roomCode) roomCode = res.roomCode;
  myIndex = res.playerIndex;
  if (res.gameState) {
    gameState = res.gameState;
    myIndex = res.gameState.myIndex ?? res.playerIndex;
    myHand = sortHand(res.gameState.myHand || []);
    selectedCards.clear();
    if (res.gameState.code) roomCode = res.gameState.code;
    updateChatVisibility();
    ensureChatColors(res.gameState.players || []);
    if (res.gameState.state === 'playing') {
      showScreen('screen-game');
      updateGameUI(res.gameState);
    } else if (res.gameState.state === 'dice_roll') {
      showScreen('screen-dice');
    } else if (res.gameState.state === 'lobby') {
      showScreen('screen-lobby');
      if (roomCode && $('lobby-code')) $('lobby-code').textContent = roomCode;
    }
  }
  updateChatVisibility();
  persistRoom();
}

function tryRejoinOnReturn() {
  restoreRoomFromStorage();
  if (!roomCode || !myPlayerId || !socket) return;
  console.log('Return to app: reconnecting/rejoining...');
  var rejoinDone = false;
  function doRejoin() {
    if (rejoinDone || !socket.connected) return;
    rejoinDone = true;
    socket.emit('rejoin_room', { roomCode: roomCode, playerId: myPlayerId }, function (res) {
      if (res?.ok) {
        applyRejoinState(res);
      } else {
        rejoinDone = false;
        socket.disconnect();
        socket.connect();
      }
    });
  }
  if (socket.connected) {
    doRejoin();
    return;
  }
  socket.once('connect', doRejoin);
  socket.connect();
  setTimeout(function () { doRejoin(); }, 800);
}

function init() {
  restoreRoomFromStorage();

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    restoreRoomFromStorage();
    if (!roomCode || !myPlayerId) return;
    tryRejoinOnReturn();
  });

  window.addEventListener('pageshow', function (e) {
    restoreRoomFromStorage();
    if (!roomCode || !myPlayerId) return;
    tryRejoinOnReturn();
  });

  window.addEventListener('focus', function () {
    restoreRoomFromStorage();
    if (!roomCode || !myPlayerId || !socket) return;
    if (!socket.connected) {
      socket.connect();
    } else {
      setTimeout(function () {
        if (!socket.connected) return;
        socket.emit('rejoin_room', { roomCode: roomCode, playerId: myPlayerId }, applyRejoinState);
      }, 200);
    }
  });

  $('btn-create').addEventListener('click', () => {
    const name = ($('input-name').value || 'Игрок').trim();
    socket.emit('create_room', name, (res) => {
      if (res?.ok) {
        roomCode = res.roomCode;
        myPlayerId = res.playerId || null;
        myIndex = res.playerIndex;
        persistRoom();
        isHost = true; // Создатель комнаты всегда хост
        updateChatVisibility();
        showScreen('screen-lobby');
        requestLobbyMedia();
        socket.emit('set_ready', roomCode);
        $('lobby-code').textContent = roomCode;

        // Показываем кнопку для хоста, но она будет disabled пока не будет 2+ игроков
        const startBtn = $('btn-start');
        startBtn.style.display = 'block';
        startBtn.disabled = true;
      }
    });
  });

  $('btn-join').addEventListener('click', () => {
    const name = ($('input-name').value || 'Игрок').trim();
    const code = ($('input-code').value || '').toUpperCase().trim();
    if (!code) return;
    socket.emit('join_room', { roomCode: code, playerName: name }, (res) => {
      if (res?.ok) {
        roomCode = res.roomCode;
        myPlayerId = res.playerId || null;
        myIndex = res.playerIndex;
        persistRoom();
        isHost = false; // Присоединившийся игрок не хост
        updateChatVisibility();
        showScreen('screen-lobby');
        requestLobbyMedia();
        socket.emit('set_ready', roomCode);

        // Скрываем кнопку для не-хоста
        const startBtn = $('btn-start');
        startBtn.style.display = 'none';
      } else {
        alert(res?.error === 'room_not_found' ? 'Комната не найдена' : 'Не удалось войти');
      }
    });
  });

  $('btn-start').addEventListener('click', () => {
    socket.emit('start_game', roomCode, (res) => {
      if (!res?.ok) {
        alert(res?.error === 'not_host' ? 'Только создатель комнаты может начать' : 'Не удалось начать игру');
      }
    });
  });

  $('btn-confirm-dice').addEventListener('click', () => {
    socket.emit('confirm_dice_roll', roomCode, (res) => {
      if (!res?.ok) {
        alert('Не удалось подтвердить бросок кубика');
      }
    });
  });

  $('btn-leave-lobby').addEventListener('click', () => {
    if (lobbyRetryIntervalId) { clearInterval(lobbyRetryIntervalId); lobbyRetryIntervalId = null; }
    stopLobbyMedia();
    lastLobbyState = null;
    roomCode = null;
    myPlayerId = null;
    persistRoom();
    updateChatVisibility();
    showScreen('screen-welcome');
  });

  var btnLobbyCamera = document.getElementById('btn-lobby-camera');
  if (btnLobbyCamera) {
    btnLobbyCamera.addEventListener('click', function () {
      requestLobbyMedia().then(function () {
        if (lastLobbyState && lastLobbyState.players) {
          renderLobbyWithVideos(lastLobbyState.players);
          ensureLobbyConnections(lastLobbyState.players);
        }
      });
    });
  }

  var lobbyPlayersList = document.getElementById('lobby-players');
  if (lobbyPlayersList) {
    lobbyPlayersList.addEventListener('click', function (e) {
      var btn = e.target.closest('.lobby-btn-toggle');
      if (!btn) return;
      var li = btn.closest('.lobby-player');
      if (!li) return;
      var sid = li.getAttribute('data-socket-id');
      var isSelf = li.getAttribute('data-is-self') === '1';
      var action = btn.getAttribute('data-action');
      if (isSelf && action === 'cam') {
        if (!localLobbyStream) return;
        localLobbyStream.getVideoTracks().forEach(function (t) { t.enabled = !t.enabled; });
        if (lastLobbyState && lastLobbyState.players) renderLobbyWithVideos(lastLobbyState.players);
      } else if (isSelf && action === 'mic') {
        if (!localLobbyStream) return;
        localLobbyStream.getAudioTracks().forEach(function (t) { t.enabled = !t.enabled; });
        if (lastLobbyState && lastLobbyState.players) renderLobbyWithVideos(lastLobbyState.players);
      } else if (!isSelf && action === 'sound') {
        lobbyRemoteMuted[sid] = !lobbyRemoteMuted[sid];
        var video = li.querySelector('.lobby-video-el');
        if (video) video.muted = !!lobbyRemoteMuted[sid];
        btn.textContent = lobbyRemoteMuted[sid] ? 'Вкл. звук' : 'Выкл. звук';
      }
    });
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.game-btn-cam, .game-btn-mic, .game-btn-sound');
    if (!btn) return;
    if (btn.classList.contains('game-btn-cam') || btn.classList.contains('game-btn-mic')) {
      if (!localLobbyStream) return;
      var action = btn.getAttribute('data-action');
      if (action === 'cam') {
        localLobbyStream.getVideoTracks().forEach(function (t) { t.enabled = !t.enabled; });
      } else if (action === 'mic') {
        localLobbyStream.getAudioTracks().forEach(function (t) { t.enabled = !t.enabled; });
      }
      var myState = getMyLobbyCamMicState();
      var wrap = document.getElementById('my-video-wrap');
      if (wrap) {
        var camBtn = wrap.querySelector('.game-btn-cam');
        var micBtn = wrap.querySelector('.game-btn-mic');
        if (camBtn) {
          camBtn.textContent = 'Камера ' + (myState.cam ? 'вкл' : 'выкл');
          camBtn.classList.toggle('lobby-btn-off', !myState.cam);
        }
        if (micBtn) {
          micBtn.textContent = 'Микрофон ' + (myState.mic ? 'вкл' : 'выкл');
          micBtn.classList.toggle('lobby-btn-off', !myState.mic);
        }
      }
      return;
    }
    if (btn.classList.contains('game-btn-sound')) {
      var sid = btn.getAttribute('data-socket-id');
      if (!sid) return;
      lobbyRemoteMuted[sid] = !lobbyRemoteMuted[sid];
      var opponent = btn.closest('.opponent');
      if (opponent) {
        var video = opponent.querySelector('.opponent-video-el');
        if (video) video.muted = !!lobbyRemoteMuted[sid];
      }
      btn.textContent = lobbyRemoteMuted[sid] ? 'Вкл. звук' : 'Выкл. звук';
    }
  });

  // Копирование кода комнаты при клике
  $('lobby-code').addEventListener('click', copyRoomCode);

  $('btn-trust').addEventListener('click', () => {
    socket.emit('trust', roomCode, (res) => {
      if (!res?.ok) console.warn('Trust failed', res);
    });
  });

  $('btn-challenge').addEventListener('click', () => {
    socket.emit('challenge', roomCode, (res) => {
      if (!res?.ok) console.warn('Challenge failed', res);
    });
  });

  $('btn-leave-game').addEventListener('click', () => {
    stopLobbyMedia();
    roomCode = null;
    myPlayerId = null;
    persistRoom();
    updateChatVisibility();
    showScreen('screen-welcome');
  });

  var chatToggle = document.getElementById('chat-toggle');
  var chatWidget = document.getElementById('chat-widget');
  var chatInput = document.getElementById('chat-input');
  var chatSend = document.getElementById('chat-send');
  if (chatToggle && chatWidget) {
    chatToggle.addEventListener('click', function () {
      chatWidget.classList.toggle('is-open');
      if (chatWidget.classList.contains('is-open')) chatInput && chatInput.focus();
    });
  }
  if (chatSend) chatSend.addEventListener('click', sendChatMessage);
  if (chatInput) {
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage();
      }
    });
  }

  connect();
}

init();
