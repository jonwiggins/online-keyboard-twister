const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { customAlphabet } = require('nanoid');
const { KEYBOARD_LAYOUT, ASSIGNABLE_CODES, ALL_KEY_CODES } = require('./keyboard');

const PORT = process.env.PORT || 3000;
const TURN_TIMEOUT_MS = 10000;
const CODE_SIZE = 5;
const COUNTDOWN_MS = 5000;

const generateCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', CODE_SIZE);
const VALID_KEY_CODES = new Set(ALL_KEY_CODES);

const PLAYER_COLORS = [
  '#ff6b6b',
  '#4ecdc4',
  '#ffe66d',
  '#6c5ce7',
  '#ff9f1c',
  '#1dd3b0',
  '#f15bb5',
  '#00bbf9'
];

const sessions = new Map();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '..', 'public')));

io.on('connection', (socket) => {
  log('socket:connected', { socketId: socket.id });

  socket.on('createSession', (payload, ack) => {
    handleCreateSession(socket, payload, ack);
  });

  socket.on('joinSession', (payload, ack) => {
    handleJoinSession(socket, payload, ack);
  });

  socket.on('startGame', (ack) => {
    handleStartGame(socket, ack);
  });

  socket.on('resetGame', (ack) => {
    handleResetGame(socket, ack);
  });

  socket.on('player:keyDown', (payload = {}) => {
    handleKeyDown(socket, payload);
  });

  socket.on('player:keyUp', (payload = {}) => {
    handleKeyUp(socket, payload);
  });

  socket.on('leaveSession', () => {
    handleLeave(socket, 'left');
  });

  socket.on('disconnect', () => {
    log('socket:disconnected', { socketId: socket.id });
    handleLeave(socket, 'disconnect');
  });
});

server.listen(PORT, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  log('server:listening', { port });
});

function handleCreateSession(socket, payload, ack) {
  const name = sanitizeName(payload?.name);
  if (!name) {
    return sendAck(ack, { ok: false, error: 'Name is required.' });
  }

  let code;
  do {
    code = generateCode();
  } while (sessions.has(code));

  const session = createSession(code);
  sessions.set(code, session);

  const player = addPlayerToSession(session, socket, name, { isHost: true });
  if (!player) {
    return sendAck(ack, { ok: false, error: 'Could not create session.' });
  }

  logSession(session, 'session:create', {
    hostId: player.id,
    hostName: player.name
  });

  sendAck(ack, {
    ok: true,
    playerId: player.id,
    session: getPublicSessionState(session),
    keyboardLayout: KEYBOARD_LAYOUT
  });
  broadcastSessionState(session);
}

function handleJoinSession(socket, payload, ack) {
  const code = String(payload?.code || '').trim().toUpperCase();
  const name = sanitizeName(payload?.name);

  if (!code) {
    return sendAck(ack, { ok: false, error: 'Game code is required.' });
  }

  const session = sessions.get(code);
  if (!session) {
    return sendAck(ack, { ok: false, error: 'Game code not found.' });
  }

  if (session.state !== 'waiting') {
    return sendAck(ack, { ok: false, error: 'Game already started.' });
  }

  if (!name) {
    return sendAck(ack, { ok: false, error: 'Name is required.' });
  }

  const player = addPlayerToSession(session, socket, name, { isHost: false });
  if (!player) {
    return sendAck(ack, { ok: false, error: 'Unable to join game.' });
  }

  logSession(session, 'session:join', {
    playerId: player.id,
    playerName: player.name
  });

  sendAck(ack, {
    ok: true,
    playerId: player.id,
    session: getPublicSessionState(session),
    keyboardLayout: KEYBOARD_LAYOUT
  });
  broadcastSessionState(session);
}

function handleStartGame(socket, ack) {
  const session = getSocketSession(socket);
  if (!session) {
    return sendAck(ack, { ok: false, error: 'Join a game first.' });
  }

  const playerId = socket.data.playerId;
  if (session.hostId !== playerId) {
    return sendAck(ack, { ok: false, error: 'Only the host can start the game.' });
  }

  if (session.state !== 'waiting') {
    return sendAck(ack, { ok: false, error: 'Game already running.' });
  }

  const now = Date.now();
  session.state = 'countdown';
  session.turnIndex = -1;
  session.winnerId = null;
  session.lastEvent = {
    type: 'countdown',
    at: now,
    endsAt: now + COUNTDOWN_MS
  };
  session.countdownStartedAt = now;
  session.countdownEndsAt = now + COUNTDOWN_MS;

  // Reset player state
  session.players.forEach((player) => {
    player.status = 'playing';
  });

  const activePlayers = getActivePlayers(session);
  session.initialPlayerCount = activePlayers.length;

  broadcastSessionState(session);
  scheduleCountdownStart(session);
  logSession(session, 'game:countdown', {
    hostId: playerId,
    countdownMs: COUNTDOWN_MS
  });
  sendAck(ack, { ok: true });
}

function handleResetGame(socket, ack) {
  const session = getSocketSession(socket);
  if (!session) {
    return sendAck(ack, { ok: false, error: 'Join a game first.' });
  }

  const playerId = socket.data.playerId;
  if (session.hostId !== playerId) {
    return sendAck(ack, { ok: false, error: 'Only the host can reset the game.' });
  }

  if (session.state !== 'ended') {
    return sendAck(ack, { ok: false, error: 'Finish the game before starting a new round.' });
  }

  cancelTurnTimer(session);
  cancelCountdown(session);

  session.state = 'waiting';
  session.turnIndex = -1;
  session.winnerId = null;
  session.currentTurn = null;
  session.countdownStartedAt = null;
  session.countdownEndsAt = null;
  session.livePresses.clear();
  session.initialPlayerCount = null;

  session.requiredKeys.clear();
  session.holdingKeys.clear();
  session.players.forEach((player) => {
    player.status = 'waiting';
    session.requiredKeys.set(player.id, new Set());
    session.holdingKeys.set(player.id, new Set());
  });

  session.lastEvent = {
    type: 'reset',
    playerId,
    at: Date.now()
  };

  broadcastSessionState(session);
  logSession(session, 'session:reset', {
    hostId: playerId
  });
  sendAck(ack, { ok: true });
}

function handleKeyDown(socket, payload) {
  const key = typeof payload.key === 'string' ? payload.key : null;
  if (!key) {
    return;
  }

  const session = getSocketSession(socket);
  if (!session) {
    return;
  }

  const playerId = socket.data.playerId;
  const player = session.players.get(playerId);
  if (!player) {
    return;
  }

  if (!VALID_KEY_CODES.has(key)) {
    return;
  }

  const liveChanged = updateLivePress(session, key, playerId, true);
  if (liveChanged) {
    broadcastSessionState(session);
  }

  if (session.state !== 'running') {
    return;
  }

  if (player.status !== 'playing') {
    return;
  }

  const holding = session.holdingKeys.get(playerId);
  if (!holding) {
    return;
  }

  if (!holding.has(key)) {
    holding.add(key);
  }

  const currentTurn = session.currentTurn;
  if (
    currentTurn &&
    currentTurn.playerId === playerId &&
    currentTurn.key === key
  ) {
    confirmKeyPress(session, playerId, key);
  }
}

function handleKeyUp(socket, payload) {
  const key = typeof payload.key === 'string' ? payload.key : null;
  if (!key) {
    return;
  }

  const session = getSocketSession(socket);
  if (!session) {
    return;
  }

  const playerId = socket.data.playerId;
  if (!VALID_KEY_CODES.has(key)) {
    return;
  }

  const liveChanged = updateLivePress(session, key, playerId, false);
  if (liveChanged) {
    broadcastSessionState(session);
  }

  if (session.state !== 'running') {
    return;
  }

  const player = session.players.get(playerId);
  if (!player || player.status !== 'playing') {
    return;
  }

  const required = session.requiredKeys.get(playerId);
  const holding = session.holdingKeys.get(playerId);

  if (holding) {
    holding.delete(key);
  }

  if (required && required.has(key)) {
    eliminatePlayer(session, playerId, 'released-key');
  }
}

function handleLeave(socket, reason) {
  const session = getSocketSession(socket);
  if (!session) {
    return;
  }
  const playerId = socket.data.playerId;
  removePlayer(session, playerId, reason);
}

function createSession(code) {
  return {
    code,
    state: 'waiting',
    hostId: null,
    players: new Map(),
    order: [],
    requiredKeys: new Map(),
    holdingKeys: new Map(),
    currentTurn: null,
    turnIndex: -1,
    turnTimer: null,
    winnerId: null,
    lastEvent: null,
    createdAt: Date.now(),
    countdownStartedAt: null,
    countdownEndsAt: null,
    countdownTimer: null,
    livePresses: new Map(),
    initialPlayerCount: null
  };
}

function addPlayerToSession(session, socket, name, { isHost }) {
  if (session.state !== 'waiting') {
    return null;
  }

  const color = pickColor(session);
  const player = {
    id: socket.id,
    name,
    color,
    status: 'waiting',
    joinedAt: Date.now()
  };

  session.players.set(player.id, player);
  session.order.push(player.id);
  session.requiredKeys.set(player.id, new Set());
  session.holdingKeys.set(player.id, new Set());

  if (!session.hostId || isHost) {
    session.hostId = player.id;
  }

  socket.data.sessionCode = session.code;
  socket.data.playerId = player.id;
  socket.join(session.code);

  session.lastEvent = {
    type: 'join',
    playerId: player.id,
    at: Date.now()
  };

  return player;
}

function sanitizeName(rawName) {
  if (typeof rawName !== 'string') {
    return null;
  }
  const trimmed = rawName.trim().slice(0, 24);
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/[\s]+/g, ' ');
}

function pickColor(session) {
  const used = new Set();
  session.players.forEach((player) => used.add(player.color));
  for (const color of PLAYER_COLORS) {
    if (!used.has(color)) {
      return color;
    }
  }
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

function getSocketSession(socket) {
  const code = socket.data.sessionCode;
  if (!code) {
    return null;
  }
  return sessions.get(code) || null;
}

function confirmKeyPress(session, playerId, key) {
  const required = session.requiredKeys.get(playerId);
  if (!required) {
    return;
  }

  required.add(key);
  logSession(session, 'turn:confirm', { playerId, key });

  const holding = session.holdingKeys.get(playerId);
  if (holding) {
    holding.add(key);
  }

  cancelTurnTimer(session);

  session.lastEvent = {
    type: 'hold',
    playerId,
    key,
    at: Date.now()
  };

  session.currentTurn = null;
  broadcastSessionState(session);

  if (session.state === 'running') {
    setImmediate(() => advanceTurn(session));
  }
}

function advanceTurn(session) {
  if (session.state !== 'running') {
    return;
  }

  cancelTurnTimer(session);

  const activePlayers = getActivePlayers(session);
  if (activePlayers.length === 0) {
    endGame(session, null, 'no-players');
    return;
  }
  if (activePlayers.length === 1 && session.initialPlayerCount > 1) {
    const winnerId = activePlayers[0].id;
    endGame(session, winnerId, 'last-standing');
    return;
  }

  if (!session.order.length) {
    return;
  }

  const maxAttempts = session.order.length;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    session.turnIndex = (session.turnIndex + 1) % session.order.length;
    const nextId = session.order[session.turnIndex];
    const player = session.players.get(nextId);
    if (!player || player.status !== 'playing') {
      continue;
    }

    const key = chooseKeyForPlayer(session, nextId);
    const now = Date.now();
    session.currentTurn = {
      playerId: nextId,
      key,
      startedAt: now,
      expiresAt: now + TURN_TIMEOUT_MS
    };

    logSession(session, 'turn:start', {
      playerId: nextId,
      key,
      expiresAt: session.currentTurn.expiresAt
    });

    session.lastEvent = {
      type: 'turn',
      playerId: nextId,
      key,
      at: now
    };

    broadcastSessionState(session);

    const alreadyPressed = session.livePresses.get(key);
    if (alreadyPressed && alreadyPressed.has(nextId)) {
      logSession(session, 'turn:auto-confirm', {
        playerId: nextId,
        key
      });
      confirmKeyPress(session, nextId, key);
      return;
    }
    scheduleTurnTimeout(session);
    return;
  }
}

function scheduleTurnTimeout(session) {
  cancelTurnTimer(session);
  if (!session.currentTurn) {
    return;
  }
  session.turnTimer = setTimeout(() => {
    const current = session.currentTurn;
    if (!current) {
      return;
    }
    session.lastEvent = {
      type: 'timeout',
      playerId: current.playerId,
      key: current.key,
      at: Date.now()
    };
    eliminatePlayer(session, current.playerId, 'timeout');
  }, TURN_TIMEOUT_MS);
}

function cancelTurnTimer(session) {
  if (session.turnTimer) {
    clearTimeout(session.turnTimer);
    session.turnTimer = null;
  }
}

function getActivePlayers(session) {
  const active = [];
  session.players.forEach((player) => {
    if (player.status === 'playing') {
      active.push(player);
    }
  });
  return active;
}

function chooseKeyForPlayer(session, playerId) {
  const required = session.requiredKeys.get(playerId) || new Set();
  const taken = new Set();
  session.requiredKeys.forEach((keys) => {
    keys.forEach((code) => taken.add(code));
  });

  const uniqueCandidates = ASSIGNABLE_CODES.filter(
    (code) => !taken.has(code) && !required.has(code)
  );
  let pool = uniqueCandidates;

  if (!pool.length) {
    const withoutDuplicateForPlayer = ASSIGNABLE_CODES.filter(
      (code) => !required.has(code)
    );
    pool = withoutDuplicateForPlayer.length ? withoutDuplicateForPlayer : ASSIGNABLE_CODES;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

function eliminatePlayer(session, playerId, reason) {
  const player = session.players.get(playerId);
  if (!player || player.status === 'eliminated') {
    return;
  }

  player.status = 'eliminated';
  session.requiredKeys.delete(playerId);
  session.holdingKeys.delete(playerId);
  clearPlayerLivePresses(session, playerId);

  logSession(session, 'player:eliminated', {
    playerId,
    reason
  });

  if (session.currentTurn?.playerId === playerId) {
    cancelTurnTimer(session);
    session.currentTurn = null;
  }

  session.lastEvent = {
    type: 'eliminated',
    playerId,
    reason,
    at: Date.now()
  };

  broadcastSessionState(session);

  if (session.state === 'running') {
    const activePlayers = getActivePlayers(session);
    if (activePlayers.length === 0) {
      endGame(session, null, 'no-players');
    } else if (activePlayers.length === 1 && session.initialPlayerCount > 1) {
      endGame(session, activePlayers[0].id, 'last-standing');
    } else {
      advanceTurn(session);
    }
  } else {
    cleanupSessionIfEmpty(session);
  }
}

function removePlayer(session, playerId, reason) {
  const player = session.players.get(playerId);
  if (!player) {
    return;
  }

  if (session.state === 'running') {
    eliminatePlayer(session, playerId, reason);
    return;
  }

  session.players.delete(playerId);
  session.order = session.order.filter((id) => id !== playerId);
  session.requiredKeys.delete(playerId);
  session.holdingKeys.delete(playerId);
  clearPlayerLivePresses(session, playerId);

  if (session.hostId === playerId) {
    session.hostId = session.order.find((id) => session.players.has(id)) || null;
  }

  session.lastEvent = {
    type: 'left',
    playerId,
    reason,
    at: Date.now()
  };

  logSession(session, 'session:leave', {
    playerId,
    reason
  });

  broadcastSessionState(session);
  cleanupSessionIfEmpty(session);
}

function endGame(session, winnerId, reason) {
  cancelTurnTimer(session);
  cancelCountdown(session);
  session.state = 'ended';
  session.winnerId = winnerId;
  session.currentTurn = null;
  session.livePresses.clear();
  session.lastEvent = {
    type: 'end',
    winnerId,
    reason,
    at: Date.now()
  };
  broadcastSessionState(session);
  logSession(session, 'game:end', {
    winnerId,
    reason
  });
}

function broadcastSessionState(session) {
  io.to(session.code).emit('session:update', getPublicSessionState(session));
}

function getPublicSessionState(session) {
  return {
    code: session.code,
    state: session.state,
    hostId: session.hostId,
    players: Array.from(session.players.values()).map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      status: player.status,
      isHost: player.id === session.hostId,
      keyCount: (session.requiredKeys.get(player.id)?.size) || 0,
      keys: Array.from(session.requiredKeys.get(player.id) || []),
      joinedAt: player.joinedAt
    })),
    currentTurn: session.currentTurn
      ? {
          playerId: session.currentTurn.playerId,
          key: session.currentTurn.key,
          startedAt: session.currentTurn.startedAt,
          expiresAt: session.currentTurn.expiresAt
        }
      : null,
    winnerId: session.winnerId,
    lastEvent: session.lastEvent,
    countdown: session.state === 'countdown'
      ? {
          startedAt: session.countdownStartedAt,
          endsAt: session.countdownEndsAt,
          duration: COUNTDOWN_MS
        }
      : null,
    livePresses: Array.from(session.livePresses.entries()).map(([keyCode, players]) => ({
      key: keyCode,
      playerIds: Array.from(players)
    }))
  };
}

function cleanupSessionIfEmpty(session) {
  if (session.players.size === 0) {
    cancelTurnTimer(session);
    cancelCountdown(session);
    logSession(session, 'session:cleanup', { reason: 'no-active-players' });
    sessions.delete(session.code);
  }
}

function sendAck(ack, payload) {
  if (typeof ack === 'function') {
    ack(payload);
  }
}

function scheduleCountdownStart(session) {
  cancelCountdown(session);
  if (session.state !== 'countdown') {
    return;
  }
  const msRemaining = Math.max(0, session.countdownEndsAt - Date.now());
  session.countdownTimer = setTimeout(() => {
    beginRunningPhase(session);
  }, msRemaining);
}

function beginRunningPhase(session) {
  session.countdownTimer = null;
  if (session.state !== 'countdown') {
    return;
  }

  const activePlayers = getActivePlayers(session);
  const initialCount = session.initialPlayerCount ?? activePlayers.length;

  if (activePlayers.length === 0) {
    endGame(session, null, 'no-players');
    return;
  }

  if (activePlayers.length === 1 && initialCount > 1) {
    endGame(session, activePlayers[0].id, 'last-standing');
    return;
  }

  session.state = 'running';
  session.countdownStartedAt = null;
  session.countdownEndsAt = null;
  session.lastEvent = {
    type: 'start',
    at: Date.now()
  };

  logSession(session, 'game:start', {
    activePlayers: activePlayers.length
  });

  broadcastSessionState(session);
  advanceTurn(session);
}

function cancelCountdown(session) {
  if (session.countdownTimer) {
    clearTimeout(session.countdownTimer);
    session.countdownTimer = null;
  }
  session.countdownStartedAt = null;
  session.countdownEndsAt = null;
}

function updateLivePress(session, key, playerId, isPressed) {
  let changed = false;
  const map = session.livePresses;
  if (isPressed) {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    if (!set.has(playerId)) {
      set.add(playerId);
      changed = true;
    }
  } else {
    const set = map.get(key);
    if (set && set.has(playerId)) {
      set.delete(playerId);
      changed = true;
      if (set.size === 0) {
        map.delete(key);
      }
    }
  }
  return changed;
}

function clearPlayerLivePresses(session, playerId) {
  session.livePresses.forEach((set, key) => {
    if (set.delete(playerId) && set.size === 0) {
      session.livePresses.delete(key);
    }
  });
}

function log(event, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level: 'info',
    event,
    ...details
  };

  try {
    console.log(JSON.stringify(entry, jsonReplacer));
  } catch (error) {
    console.log(`[${entry.ts}] ${event}`, details);
  }
}

function jsonReplacer(key, value) {
  if (value instanceof Set || value instanceof Map) {
    return Array.from(value);
  }
  if (value instanceof Error) {
    return {
      message: value.message,
      stack: value.stack
    };
  }
  return value;
}

function logSession(session, event, details = {}) {
  log(event, { session: session?.code, ...details });
}
