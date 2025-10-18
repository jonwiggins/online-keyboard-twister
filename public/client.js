const socket = window.io();

const state = {
  connected: false,
  session: null,
  playerId: null,
  keyboardLayout: [],
  keyLabelMap: new Map(),
  assignableCodes: new Set(),
  keyboardCodes: new Set(),
  playersById: new Map(),
  keyAssignments: new Map(),
  livePresses: new Map(),
  livePressesByPlayer: new Map(),
  createError: '',
  joinError: '',
  startError: '',
  resetError: '',
  lastEventText: '',
  currentView: 'landing'
};

let countdownInterval = null;

const appEl = document.getElementById('app');
const particleRoot = document.getElementById('particle-root');

registerSocketHandlers();
registerKeyHandlers();
render();

function registerSocketHandlers() {
  socket.on('connect', () => {
    state.connected = true;
    render();
  });

  socket.on('disconnect', () => {
    state.connected = false;
    resetSessionState();
    render();
  });

  socket.on('session:update', (session) => {
    state.session = session;
    refreshDerivedState();
    render();
    handleParticles(session);
  });
}

function registerKeyHandlers() {
  window.addEventListener('keydown', (event) => {
    if (event.repeat) {
      return;
    }
    if (!shouldSendKeyEvents()) {
      return;
    }
    const code = event.code;
    if (!state.keyboardCodes.has(code)) {
      return;
    }
    event.preventDefault();
  socket.emit('player:keyDown', { key: code });
  spawnKeyParticle(code, 'down');
  });

  window.addEventListener('keyup', (event) => {
    if (!shouldSendKeyEvents()) {
      return;
    }
    const code = event.code;
    if (!state.keyboardCodes.has(code)) {
      return;
    }
    event.preventDefault();
  socket.emit('player:keyUp', { key: code });
  spawnKeyParticle(code, 'up');
  });
}

function shouldSendKeyEvents() {
  if (!state.session) {
    return false;
  }
  const me = getMe();
  if (!me) {
    return false;
  }
  switch (state.session.state) {
    case 'countdown':
      return true;
    case 'running':
      return me.status === 'playing';
    case 'ended':
      return true;
    default:
      return false;
  }
}

function getMe() {
  if (!state.session) {
    return null;
  }
  return state.playersById.get(state.playerId) || null;
}

function refreshDerivedState() {
  if (!state.session) {
    state.playersById = new Map();
    state.keyAssignments = new Map();
    state.livePresses = new Map();
    state.livePressesByPlayer = new Map();
    state.lastEventText = '';
    state.resetError = '';
    manageCountdown();
    return;
  }

  const playersById = new Map();
  const keyAssignments = new Map();
  const livePresses = new Map();
  const livePressesByPlayer = new Map();
  state.session.players.forEach((player) => {
    playersById.set(player.id, player);
    player.keys.forEach((keyCode) => {
      keyAssignments.set(keyCode, player);
    });
  });

  (state.session.livePresses || []).forEach(({ key, playerIds }) => {
    const pressedPlayers = playerIds
      .map((id) => playersById.get(id))
      .filter(Boolean);
    if (!pressedPlayers.length) {
      return;
    }
    livePresses.set(key, pressedPlayers);
    pressedPlayers.forEach((player) => {
      if (!livePressesByPlayer.has(player.id)) {
        livePressesByPlayer.set(player.id, []);
      }
      livePressesByPlayer.get(player.id).push(key);
    });
  });

  state.playersById = playersById;
  state.keyAssignments = keyAssignments;
  state.livePresses = livePresses;
  state.livePressesByPlayer = livePressesByPlayer;
  state.lastEventText = formatLastEvent(state.session.lastEvent);
  if (state.session.state !== 'ended') {
    state.resetError = '';
  }
  manageCountdown();
}

function render() {
  if (!appEl) {
    return;
  }

  let markup = '';
  if (!state.session) {
    state.currentView = 'landing';
    markup = renderLanding();
  } else if (state.session.state === 'waiting') {
    state.currentView = 'lobby';
    markup = renderLobby();
  } else {
    state.currentView = 'game';
    markup = renderGame();
  }

  appEl.innerHTML = markup;
  bindCurrentViewHandlers();
  updateCountdownDisplay();
}

function renderLanding() {
  return `
    <div class="layout">
      <header class="hero">
        <h1>Online Twister</h1>
        <p>Share a game code with friends, keep holding your keys, and be the last keyboard acrobat standing.</p>
      </header>
      <section class="panels">
        <form id="create-form" class="panel">
          <h2>Create Game</h2>
          <label class="field">
            <span>Name</span>
            <input id="create-name" name="name" autocomplete="off" required maxlength="24" placeholder="Host name">
          </label>
          <button type="submit" class="primary">Create &amp; Join</button>
          ${state.createError ? `<p class="error">${escapeHtml(state.createError)}</p>` : ''}
        </form>
        <form id="join-form" class="panel">
          <h2>Join Game</h2>
          <label class="field">
            <span>Name</span>
            <input id="join-name" name="name" autocomplete="off" required maxlength="24" placeholder="Your nickname">
          </label>
          <label class="field">
            <span>Game Code</span>
            <input id="join-code" name="code" autocomplete="off" required maxlength="5" placeholder="ABCDE">
          </label>
          <button type="submit" class="primary">Join</button>
          ${state.joinError ? `<p class="error">${escapeHtml(state.joinError)}</p>` : ''}
        </form>
      </section>
      <section class="info">
        <h3>How It Works</h3>
        <ul>
          <li>Create or join a game using the shared code.</li>
          <li>Everyone gets a color and the host starts the game.</li>
          <li>When it’s your turn, press the highlighted key within ten seconds and keep it held.</li>
          <li>If you release any required key, you’re out. Last player holding wins.</li>
        </ul>
      </section>
    </div>
  `;
}

function renderLobby() {
  const me = getMe();
  const isHost = me?.isHost;
  const players = state.session.players.slice().sort((a, b) => a.joinedAt - b.joinedAt);

  return `
    <div class="layout">
      <header class="topbar">
        <div>
          <h1>Game Lobby</h1>
          <p>Share this code with friends</p>
          <div class="code-box">
            <strong id="game-code">${escapeHtml(state.session.code)}</strong>
            <button type="button" id="copy-code" class="secondary small">Copy</button>
          </div>
        </div>
        <div class="actions">
          <button type="button" id="leave-lobby" class="ghost small">Leave</button>
          ${isHost ? `<button type="button" id="start-game" class="primary">Start Game</button>` : ''}
          ${state.startError ? `<p class="error">${escapeHtml(state.startError)}</p>` : ''}
        </div>
      </header>
      <section class="panel">
        <h2>Players (${players.length})</h2>
        <ul class="player-list">
          ${players.map(renderPlayerListItem).join('')}
        </ul>
        <p class="lobby-tip">${isHost ? 'Start the game whenever you are ready—even solo runs are welcome.' : 'Waiting for the host to start the game.'}</p>
      </section>
    </div>
  `;
}

function renderGame() {
  const me = getMe();
  const isHost = me?.isHost;
  const currentTurn = state.session.currentTurn;
  const winner = state.session.winnerId ? state.playersById.get(state.session.winnerId) : null;
  const players = state.session.players.slice().sort((a, b) => a.joinedAt - b.joinedAt);

  return `
    <div class="layout">
      <header class="topbar">
        <div>
          <h1>Game Code: <span id="game-code">${escapeHtml(state.session.code)}</span></h1>
          <p>${state.session.state === 'ended' ? 'Game finished' : 'Game in progress'}</p>
        </div>
        <div class="actions">
          <button type="button" id="copy-code" class="secondary small">Copy Code</button>
          <button type="button" id="leave-lobby" class="ghost small">Leave Game</button>
          ${state.session.state === 'ended' && isHost ? '<button type="button" id="play-again" class="primary small">Play Again</button>' : ''}
          ${state.session.state === 'ended' && isHost && state.resetError ? `<p class="error">${escapeHtml(state.resetError)}</p>` : ''}
        </div>
      </header>
      <section class="columns">
        <div class="column column--wide">
          <div class="panel current-turn">
            ${renderCurrentTurnInfo(currentTurn, me, winner)}
          </div>
          <div class="panel keyboard-panel">
            <h2>Keyboard</h2>
            ${renderKeyboard()}
          </div>
        </div>
        <div class="column">
          <div class="panel">
            <h2>Players</h2>
            <ul class="player-list">
              ${players.map((player) => renderPlayerListItem(player, currentTurn)).join('')}
            </ul>
          </div>
          <div class="panel events">
            <h2>Events</h2>
            <p>${state.lastEventText ? escapeHtml(state.lastEventText) : 'Waiting for the next move…'}</p>
          </div>
          <div class="panel me-panel">
            <h2>Your Status</h2>
            ${renderMyStatus(me)}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderCurrentTurnInfo(currentTurn, me, winner) {
  if (state.session.state === 'countdown') {
    return renderCountdownInfo();
  }

  if (state.session.state === 'ended') {
    if (winner) {
      return `
        <div class="winner">
          <h2>Winner: <span style="color:${escapeHtml(winner.color)}">${escapeHtml(winner.name)}</span></h2>
          <p>Great job keeping those keys pressed!</p>
        </div>
      `;
    }
    return `
      <div class="winner">
        <h2>No winner</h2>
        <p>The game ended without a winner.</p>
      </div>
    `;
  }

  if (!currentTurn) {
    return `
      <div class="turn-info">
        <h2>Preparing next turn…</h2>
      </div>
    `;
  }

  const player = state.playersById.get(currentTurn.playerId);
  const label = state.keyLabelMap.get(currentTurn.key) || currentTurn.key;
  const isYou = player?.id === me?.id;
  const countdownText = getTurnCountdownText(currentTurn);
  return `
    <div class="turn-info">
      <h2>${isYou ? 'Your turn!' : `${escapeHtml(player?.name || 'Unknown')}'s turn`}</h2>
      <p class="turn-key" style="--key-color:${escapeHtml(player?.color || '#fff')}">
        Press &amp; hold <span>${escapeHtml(label)}</span>
      </p>
      <p class="countdown">Time left:
        <span id="turn-countdown">${escapeHtml(countdownText)}</span>s
      </p>
      <p class="turn-hint">${isYou ? 'Press the key and keep it held to stay in the game.' : 'Get ready, your turn is coming up!'}</p>
    </div>
  `;
}

function getTurnCountdownText(currentTurn) {
  if (!currentTurn) {
    return '10.00';
  }
  const msLeft = Math.max(0, currentTurn.expiresAt - Date.now());
  return (msLeft / 1000).toFixed(2);
}

function renderCountdownInfo() {
  const countdown = state.session.countdown;
  const duration = countdown?.duration ?? 5000;
  const msLeft = countdown ? Math.max(0, countdown.endsAt - Date.now()) : duration;
  const display = (msLeft / 1000).toFixed(2);
  const progress = 1 - msLeft / duration;
  return `
    <div class="countdown" aria-live="polite">
      <div class="countdown-ring" data-countdown-ring style="--progress:${escapeHtml(progress.toFixed(4))}">
        <div class="countdown-number" id="start-countdown-number">${escapeHtml(display)}</div>
      </div>
      <p class="countdown-headline">Launch pad ready</p>
      <p class="countdown-subtext">Press any keys to paint the keyboard with your color.</p>
    </div>
  `;
}

function renderKeyboard() {
  if (!state.keyboardLayout.length) {
    return '<p class="muted">Loading keyboard…</p>';
  }

  const currentKey = state.session?.currentTurn?.key || null;
  return `
    <div class="keyboard">
      ${state.keyboardLayout
        .map(
          (row) => `
            <div class="key-row">
              ${row.map((key) => renderKey(key, currentKey)).join('')}
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function renderKey(key, currentKey) {
  const assignment = state.keyAssignments.get(key.code);
  const pressedPlayers = state.livePresses.get(key.code) || [];
  const particleId = `key-${key.code}`;
  const classes = ['key'];
  const sizeClass = getKeySizeClass(key.code);
  if (sizeClass) {
    classes.push(sizeClass);
  }
  if (!key.assignable) {
    classes.push('key--inactive');
  }
  if (assignment) {
    classes.push('key--assigned');
    if (assignment.id === state.playerId) {
      classes.push('key--mine');
    }
  }
  if (pressedPlayers.length) {
    classes.push('key--pressed');
  }
  if (currentKey === key.code) {
    classes.push('key--current');
  }

  const styleParts = [];
  if (assignment) {
    styleParts.push(`--key-color:${assignment.color}`);
  }
  if (pressedPlayers.length) {
    const pressColor = pressedPlayers[0].color || '#6c5ce7';
    styleParts.push(`--press-color:${pressColor}`);
  }
  if (currentKey === key.code) {
    const currentPlayer = state.playersById.get(state.session?.currentTurn?.playerId);
    if (currentPlayer) {
      styleParts.push(`--current-color:${currentPlayer.color}`);
    }
  }

  const styleAttr = styleParts.length ? ` style="${styleParts.map(escapeHtml).join(';')}"` : '';
  return `
    <div class="${classes.join(' ')}"${styleAttr} data-key-code="${escapeHtml(key.code)}" data-particle-id="${particleId}">
      <span>${escapeHtml(key.label)}</span>
    </div>
  `;
}

function getKeySizeClass(code) {
  switch (code) {
    case 'Backspace':
    case 'Tab':
      return 'key--wide';
    case 'CapsLock':
    case 'Enter':
    case 'ShiftLeft':
    case 'ShiftRight':
      return 'key--extra';
    case 'Space':
      return 'key--space';
    default:
      return '';
  }
}

function renderPlayerListItem(player, currentTurn) {
  const classes = ['player'];
  if (player.id === state.playerId) {
    classes.push('player--me');
  }
  if (player.status === 'eliminated') {
    classes.push('player--out');
  } else if (player.status === 'playing') {
    classes.push('player--active');
  }
  if (currentTurn?.playerId === player.id) {
    classes.push('player--turn');
  }

  const statusText =
    player.status === 'waiting'
      ? 'Waiting'
      : player.status === 'playing'
      ? `Holding ${player.keys.length} key${player.keys.length === 1 ? '' : 's'}`
      : 'Eliminated';

  const keyLabels = player.keys.map((code) => state.keyLabelMap.get(code) || code);
  const pressingLabels = (state.livePressesByPlayer.get(player.id) || [])
    .map((code) => state.keyLabelMap.get(code) || code);

  return `
    <li class="${classes.join(' ')}">
      <span class="player-dot" style="background:${escapeHtml(player.color)}"></span>
      <span class="player-name">${escapeHtml(player.name)}</span>
      ${player.isHost ? '<span class="player-tag">Host</span>' : ''}
      <span class="player-status">${escapeHtml(statusText)}</span>
      ${
        keyLabels.length
          ? `<span class="player-keys">${keyLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join('')}</span>`
          : '<span class="player-keys muted">No keys yet</span>'
      }
      ${
        pressingLabels.length
          ? `<span class="player-pressing">${pressingLabels
              .map((label) => `<span>${escapeHtml(label)}</span>`)
              .join('')}</span>`
          : ''
      }
    </li>
  `;
}

function renderMyStatus(me) {
  if (!me) {
    return '<p class="muted">You are not part of this game.</p>';
  }
  if (state.session.state === 'countdown') {
    const warmupLabels = (state.livePressesByPlayer.get(me.id) || [])
      .map((code) => state.keyLabelMap.get(code) || code);
    const warmupList = warmupLabels.length
      ? warmupLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join('')
      : '<span class="muted">Tap keys to test your reach…</span>';
    return `<p>Countdown engaged. Warm up those fingers!</p><div class="held-keys">${warmupList}</div>`;
  }
  if (state.session.state === 'ended') {
    const winnerId = state.session.winnerId;
    if (winnerId === me.id) {
      return '<p>You won! Take a break and brag about it.</p>';
    }
    if (me.isHost) {
      return '<p>The round is over. Hit “Play Again” when everyone is ready.</p>';
    }
    const winner = winnerId ? state.playersById.get(winnerId) : null;
    const winnerLine = winner ? `${escapeHtml(winner.name)} won the round. ` : '';
    return `<p>${winnerLine}Waiting for the host to start another round.</p>`;
  }
  if (me.status === 'eliminated') {
    return '<p>You have been eliminated. Watch the chaos unfold!</p>';
  }
  if (me.status === 'playing') {
    const keyLabels = me.keys.map((code) => state.keyLabelMap.get(code) || code);
    const list = keyLabels.length
      ? keyLabels.map((label) => `<span>${escapeHtml(label)}</span>`).join('')
      : '<span class="muted">Waiting for first key…</span>';
    return `<p>Keep holding:</p><div class="held-keys">${list}</div>`;
  }
  return '<p>Waiting for the host to start the game.</p>';
}

function formatLastEvent(event) {
  if (!event) {
    return '';
  }
  const player = event.playerId ? state.playersById.get(event.playerId) : null;
  const playerName = player ? player.name : 'Someone';
  const keyLabel = event.key ? state.keyLabelMap.get(event.key) || event.key : null;
  switch (event.type) {
    case 'countdown':
      return 'Countdown initiated. Warm up your fingers!';
    case 'join':
      return `${playerName} joined the lobby.`;
    case 'left':
      return `${playerName} left the lobby.`;
    case 'turn':
      return `${playerName} must hold ${keyLabel}.`;
    case 'hold':
      return `${playerName} secured ${keyLabel}.`;
    case 'timeout':
      return `${playerName} ran out of time for ${keyLabel}.`;
    case 'eliminated':
      if (event.reason === 'released-key') {
        return `${playerName} released a required key.`;
      }
      if (event.reason === 'timeout') {
        return `${playerName} failed to press their key in time.`;
      }
      return `${playerName} has been eliminated.`;
    case 'start':
      return 'Game started!';
    case 'end':
      if (event.winnerId) {
        const winner = state.playersById.get(event.winnerId);
        if (winner) {
          return `${winner.name} wins the game!`;
        }
      }
      return 'Game ended.';
    case 'reset':
      return `${playerName} reset the lobby. Ready for another round.`;
    default:
      return '';
  }
}

function bindCurrentViewHandlers() {
  if (state.currentView === 'landing') {
    bindLandingHandlers();
  } else if (state.currentView === 'lobby') {
    bindLobbyHandlers();
  } else if (state.currentView === 'game') {
    bindGameHandlers();
  }
}

function bindLandingHandlers() {
  const createForm = document.getElementById('create-form');
  const joinForm = document.getElementById('join-form');

  if (createForm) {
    createForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(createForm);
      const name = formData.get('name');
      socket.emit('createSession', { name }, (response) => {
        if (!response?.ok) {
          state.createError = response?.error || 'Could not create game.';
          render();
          return;
        }
        state.createError = '';
        state.joinError = '';
        state.resetError = '';
        state.session = response.session;
        state.playerId = response.playerId;
        setKeyboardLayout(response.keyboardLayout);
        refreshDerivedState();
        render();
      });
    });
  }

  if (joinForm) {
    joinForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(joinForm);
      const name = formData.get('name');
      const code = formData.get('code');
      socket.emit('joinSession', { name, code }, (response) => {
        if (!response?.ok) {
          state.joinError = response?.error || 'Could not join game.';
          render();
          return;
        }
        state.joinError = '';
        state.createError = '';
        state.resetError = '';
        state.session = response.session;
        state.playerId = response.playerId;
        setKeyboardLayout(response.keyboardLayout);
        refreshDerivedState();
        render();
      });
    });
  }
}

function bindLobbyHandlers() {
  const copyBtn = document.getElementById('copy-code');
  const startBtn = document.getElementById('start-game');
  const leaveBtn = document.getElementById('leave-lobby');

  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyCode());
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => leaveSession());
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      socket.emit('startGame', (response) => {
        if (!response?.ok) {
          state.startError = response?.error || 'Unable to start game.';
          render();
          return;
        }
        state.startError = '';
      });
    });
  }
}

function bindGameHandlers() {
  const copyBtn = document.getElementById('copy-code');
  const leaveBtn = document.getElementById('leave-lobby');
  const playAgainBtn = document.getElementById('play-again');

  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyCode());
  }

  if (leaveBtn) {
    leaveBtn.addEventListener('click', () => leaveSession());
  }

  if (playAgainBtn) {
    playAgainBtn.addEventListener('click', () => {
      socket.emit('resetGame', (response) => {
        if (!response?.ok) {
          state.resetError = response?.error || 'Unable to start a new round.';
          render();
          return;
        }
        state.resetError = '';
      });
    });
  }
}

function leaveSession() {
  socket.emit('leaveSession');
  resetSessionState();
  render();
}

function copyCode() {
  const code = state.session?.code;
  if (!code) {
    return;
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(code).then(
      () => showTemporaryMessage('Code copied!'),
      () => showTemporaryMessage('Unable to copy.')
    );
  } else {
    showTemporaryMessage('Copy not supported in this browser.');
  }
}

let messageTimeout = null;
function showTemporaryMessage(text) {
  const messageBox = document.createElement('div');
  messageBox.className = 'toast';
  messageBox.textContent = text;
  document.body.appendChild(messageBox);
  requestAnimationFrame(() => {
    messageBox.classList.add('visible');
  });
  clearTimeout(messageTimeout);
  messageTimeout = setTimeout(() => {
    messageBox.classList.remove('visible');
    setTimeout(() => {
      if (messageBox.parentNode) {
        messageBox.parentNode.removeChild(messageBox);
      }
    }, 300);
  }, 2000);
}

function setKeyboardLayout(layout) {
  if (!Array.isArray(layout)) {
    return;
  }
  state.keyboardLayout = layout;
  const assignable = new Set();
  const allCodes = new Set();
  const labels = new Map();
  layout.forEach((row) => {
    row.forEach((key) => {
      labels.set(key.code, key.label);
      allCodes.add(key.code);
      if (key.assignable) {
        assignable.add(key.code);
      }
    });
  });
  state.assignableCodes = assignable;
  state.keyboardCodes = allCodes;
  state.keyLabelMap = labels;
}

function manageCountdown() {
  const session = state.session;
  const hasCountdown = Boolean(
    session &&
      ((session.state === 'countdown' && session.countdown) ||
        (session.state === 'running' && session.currentTurn))
  );

  if (hasCountdown && !countdownInterval) {
    countdownInterval = setInterval(updateCountdownDisplay, 50);
  } else if (!hasCountdown && countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function updateCountdownDisplay() {
  if (!state.session) {
    return;
  }

  if (state.session.state === 'countdown' && state.session.countdown) {
    const { endsAt, duration } = state.session.countdown;
    const msLeft = Math.max(0, endsAt - Date.now());
    const displayValue = (msLeft / 1000).toFixed(2);
    const progress = duration ? Math.min(1, Math.max(0, 1 - msLeft / duration)) : 1;
    const numberEl = document.getElementById('start-countdown-number');
    if (numberEl) {
      numberEl.textContent = displayValue;
    }
    const ringEl = document.querySelector('[data-countdown-ring]');
    if (ringEl) {
      ringEl.style.setProperty('--progress', progress.toFixed(4));
      ringEl.classList.toggle('countdown-ring--final', msLeft <= 0);
    }
  }

  const turnElement = document.getElementById('turn-countdown');
  if (turnElement && state.session.state === 'running' && state.session.currentTurn) {
    const msLeft = Math.max(0, state.session.currentTurn.expiresAt - Date.now());
    turnElement.textContent = (msLeft / 1000).toFixed(2);
  } else if (turnElement) {
    turnElement.textContent = '';
  }
}

function resetSessionState() {
  state.session = null;
  state.playerId = null;
  state.keyboardLayout = [];
  state.keyLabelMap = new Map();
  state.assignableCodes = new Set();
  state.keyboardCodes = new Set();
  state.playersById = new Map();
  state.keyAssignments = new Map();
  state.livePresses = new Map();
  state.livePressesByPlayer = new Map();
  state.resetError = '';
  state.lastEventText = '';
  manageCountdown();
  clearParticles();
}

function escapeHtml(value) {
  if (value == null) {
    return '';
  }
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#039;';
      default:
        return char;
    }
  });
}
