/**
 * Клиент игры «Верю / Не верю» — Socket.IO, экраны, карты, действия.
 * Поддержка вертикальной и горизонтальной ориентации.
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = { '♠': 'spades', '♥': 'hearts', '♦': 'diamonds', '♣': 'clubs' };
const SUIT_ORDER = ['♠', '♥', '♦', '♣'];

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
    const suitDiff = suitValue(pa.suit) - suitValue(pb.suit);
    return suitDiff !== 0 ? suitDiff : rankValue(pa.rank) - rankValue(pb.rank);
  });
}

let socket = null;
let roomCode = null;
let myPlayerId = null; // Уникальный ID игрока для переподключения
let myIndex = -1;
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

    // Если мы были в комнате, пытаемся переподключиться
    if (roomCode && myPlayerId) {
      console.log('Reconnecting to room:', roomCode, 'with playerId:', myPlayerId);
      socket.emit('rejoin_room', { roomCode, playerId: myPlayerId }, (res) => {
        if (res?.ok) {
          console.log('Successfully rejoined room');
          myIndex = res.playerIndex;

          // Запрашиваем текущее состояние игры
          if (res.gameState) {
            gameState = res.gameState;
            myIndex = res.gameState.myIndex;
            myHand = sortHand(res.gameState.myHand || []);
            selectedCards.clear();

            // Определяем текущий экран на основе состояния
            if (res.gameState.state === 'playing') {
              showScreen('screen-game');
              updateGameUI(res.gameState);
            } else if (res.gameState.state === 'dice_roll') {
              showScreen('screen-dice');
            } else if (res.gameState.state === 'lobby') {
              showScreen('screen-lobby');
            }
          }
        } else {
          console.log('Failed to rejoin room, returning to welcome screen');
          roomCode = null;
          myPlayerId = null;
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
    const list = $('lobby-players');
    list.innerHTML = state.players.map(p => `<li>${escapeHtml(p.name)}</li>`).join('');

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

  socket.on('dice_rolled', (diceRolls) => {
    showScreen('screen-dice');
    const resultsEl = $('dice-results');
    const maxRoll = Math.max(...diceRolls.map(d => d.roll));
    resultsEl.innerHTML = diceRolls.map(d => `
      <div class="dice-result ${d.roll === maxRoll ? 'winner' : ''}">
        <span class="dice-player-name">${escapeHtml(d.name)}</span>
        <span class="dice-roll-value">${d.roll}</span>
      </div>
    `).join('');
  });

  socket.on('room_closed', () => {
    roomCode = null;
    myPlayerId = null;
    updateChatVisibility();
    showScreen('screen-welcome');
  });

  socket.on('chat_message', (data) => {
    if (!data || !data.playerName) return;
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
    if (state.players && state.players.length) ensureChatColors(state.players);
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

        let cardsHtml = '';
        for (let i = 0; i < visibleCards; i++) {
          cardsHtml += '<div class="opponent-card-back"></div>';
        }
        if (cardCount > maxVisible) {
          cardsHtml += `<div class="opponent-card-badge">+${cardCount - maxVisible}</div>`;
        }

        return `<div class="opponent ${isCurrent ? 'current' : ''}">
          <div class="opponent-name">${escapeHtml(p.name)}</div>
          <div class="opponent-hand">${cardsHtml}</div>
        </div>`;
      })
      .join('');
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
  // На смартфонах подскроллить выбранную карту в зону видимости
  if (!wasSelected && selectedCards.has(cardId)) {
    requestAnimationFrame(() => {
      const handEl = $('my-hand');
      const el = [...handEl.querySelectorAll('.card-in-hand')].find(c => c.dataset.cardId === cardId);
      if (el && el.classList.contains('selected')) {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
  }
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

function sendChatMessage() {
  var input = document.getElementById('chat-input');
  if (!input || !roomCode || !socket) return;
  var text = (input.value || '').trim();
  if (!text) return;
  socket.emit('chat_message', { roomCode: roomCode, text: text }, function () {
    input.value = '';
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

function init() {
  // Обработка видимости страницы
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && roomCode && socket) {
      console.log('Page became visible, checking connection...');

      // Если соединение разорвано, пытаемся переподключиться
      if (!socket.connected) {
        console.log('Socket disconnected, reconnecting...');
        socket.connect();
      } else {
        // Если соединение активно, запрашиваем обновление состояния
        console.log('Socket connected, requesting state update...');
        socket.emit('rejoin_room', { roomCode, playerId: myPlayerId }, (res) => {
          if (res?.ok && res.gameState) {
            gameState = res.gameState;
            myIndex = res.gameState.myIndex ?? res.playerIndex;
            myHand = sortHand(res.gameState.myHand || []);
            selectedCards.clear();

            if (res.gameState.state === 'playing') {
              showScreen('screen-game');
              updateGameUI(res.gameState);
            } else if (res.gameState.state === 'dice_roll') {
              showScreen('screen-dice');
            } else if (res.gameState.state === 'lobby') {
              showScreen('screen-lobby');
            }
          }
        });
      }
    }
  });

  // Обработка событий для мобильных устройств (iOS/Android)
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && roomCode && socket) {
      console.log('Page restored from cache, checking connection...');

      if (!socket.connected) {
        socket.connect();
      } else {
        socket.emit('rejoin_room', { roomCode, playerId: myPlayerId }, (res) => {
          if (res?.ok && res.gameState) {
            gameState = res.gameState;
            myIndex = res.gameState.myIndex ?? res.playerIndex;
            myHand = sortHand(res.gameState.myHand || []);
            selectedCards.clear();

            if (res.gameState.state === 'playing') {
              showScreen('screen-game');
              updateGameUI(res.gameState);
            } else if (res.gameState.state === 'dice_roll') {
              showScreen('screen-dice');
            } else if (res.gameState.state === 'lobby') {
              showScreen('screen-lobby');
            }
          }
        });
      }
    }
  });

  // Обработка возврата в приложение (для PWA)
  window.addEventListener('focus', () => {
    if (roomCode && socket && socket.connected) {
      console.log('Window focused, checking state...');
      socket.emit('rejoin_room', { roomCode, playerId: myPlayerId }, (res) => {
        if (res?.ok && res.gameState) {
          gameState = res.gameState;
          myIndex = res.gameState.myIndex ?? res.playerIndex;
          myHand = sortHand(res.gameState.myHand || []);
          selectedCards.clear();
          updateGameUI(res.gameState);
          if (res.gameState.state === 'playing') {
            showScreen('screen-game');
          } else if (res.gameState.state === 'dice_roll') {
            showScreen('screen-dice');
          } else if (res.gameState.state === 'lobby') {
            showScreen('screen-lobby');
          }
        }
      });
    }
  });

  $('btn-create').addEventListener('click', () => {
    const name = ($('input-name').value || 'Игрок').trim();
    socket.emit('create_room', name, (res) => {
      if (res?.ok) {
        roomCode = res.roomCode;
        myPlayerId = res.playerId || null;
        myIndex = res.playerIndex;
        isHost = true; // Создатель комнаты всегда хост
        updateChatVisibility();
        showScreen('screen-lobby');
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
        isHost = false; // Присоединившийся игрок не хост
        updateChatVisibility();
        showScreen('screen-lobby');
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
    roomCode = null;
    myPlayerId = null;
    updateChatVisibility();
    showScreen('screen-welcome');
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
    roomCode = null;
    myPlayerId = null;
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
