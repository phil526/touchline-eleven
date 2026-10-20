const PULSES = ['pass', 'through', 'lob', 'strike', 'clear', 'tackle', 'slide', 'switch', 'oneTwo','ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','cancelCharge'];
const neutral = () => ({ mx: 0, mz: 0, sprint: false, jockey: false, pass: false, through: false, passHold: false, throughHold: false, lob: false, shoot: false, finesse: false, chip: false, strike: false, clear: false, tackle: false, slide: false, switch: false, oneTwo: false, ballRoll:false,bodyFeint:false,fakeShot:false,keeperLeft:false,keeperRight:false,keeperCentre:false,keeperDive:false,keeperReady:false,keeperAssist:true,cancelCharge: false, shotAssist: true });
const now = () => performance.now();
const copyState = state => ({ ...state, score: [...state.score], selected: [...state.selected], players: state.players.map(player => ({ ...player })), ball: { ...state.ball } });
const mix = (a, b, t) => a + (b - a) * t;

/** Native browser WebSocket transport; all gameplay outcomes remain server-owned. */
export class NetworkClient {
  constructor({ onRoom = () => {}, onState = () => {}, onStatus = () => {}, onError = () => {}, snapshotTimeoutMs = 3000, connectTimeoutMs = 8000 } = {}) {
    Object.assign(this, { onRoom, onState, onStatus, onError });
    this.status = 'disconnected'; this.team = 0; this.room = null; this.latency = 0;
    this.state = this.latestState = null; this.url = ''; this.token = null; this.socket = null;
    this.seq = 0; this.ack = -1; this.pending = new Map(); this.frames = []; this.queue = [];
    this.actions = neutral(); this.inputDirty = false; this.matchId = -1; this.closedByUser = false;
    this.retryCount = 0; this.graceMs = 20_000; this.disconnectedAt = 0;
    this.snapshotTimeoutMs = Math.max(50, snapshotTimeoutMs); this.connectTimeoutMs = Math.max(50, connectTimeoutMs);
    this.lastSnapshotAt = null; this.snapshotExpectedSince = null; this.awaitingRejoinAt = null; this.cancelConnect = null;
    this.flushTimer = setInterval(() => this.flushInput(), 1000 / 30);
    this.pingTimer = setInterval(() => this.send({ type: 'ping', sentAt: now() }, false), 2000);
    this.watchdogTimer = setInterval(() => this.checkConnection(), Math.min(250, this.snapshotTimeoutMs / 2));
  }
  get stateAgeMs() { return this.lastSnapshotAt === null ? Infinity : Math.max(0, now() - this.lastSnapshotAt); }
  setStatus(status) { if (this.status === status) return; this.status = status; this.onStatus(status); }
  connect(url) {
    this.closedByUser = false;
    let base;
    try { base = new URL(url || location.href, location.href); } catch { return Promise.reject(new Error('Enter a valid match server address.')); }
    base.protocol = base.protocol === 'https:' || base.protocol === 'wss:' ? 'wss:' : 'ws:';
    if (!base.pathname || base.pathname === '/') base.pathname = '/ws';
    this.url = base.href;
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve(this);
    if (this.connectPromise) return this.connectPromise;
    this.setStatus(this.token ? 'reconnecting' : 'connecting');
    let resolveConnect, rejectConnect;
    const connection = new Promise((resolve, reject) => { resolveConnect = resolve; rejectConnect = reject; });
    this.connectPromise = connection;
    let socket, settled = false;
    const settle = error => {
      if (settled) return; settled = true; clearTimeout(this.connectTimer); this.connectTimer = null;
      if (this.connectPromise === connection) this.connectPromise = null;
      this.cancelConnect = null;
      if (error) rejectConnect(error); else resolveConnect(this);
    };
    this.cancelConnect = () => settle(new Error('Connection cancelled.'));
    const failed = message => {
      if (socket && socket !== this.socket) return;
      settle(new Error(message));
      this.abandonSocket(socket, 'Connection unavailable');
      if (!this.closedByUser && this.token && this.room) this.scheduleReconnect(); else this.setStatus('disconnected');
    };
    try {
      socket = new WebSocket(this.url); this.socket = socket;
      this.connectTimer = setTimeout(() => failed('Connection timed out. Check the match server address.'), this.connectTimeoutMs);
      socket.addEventListener('open', () => {
        if (socket !== this.socket || this.closedByUser) return;
        settle();
        if (this.token && this.room) { this.awaitingRejoinAt = now(); this.send({ type: 'rejoin', code: this.room.code, token: this.token }); }
        else { this.setStatus('connected'); this.queue.splice(0).forEach(message => this.send(message)); }
      });
      socket.addEventListener('message', event => {
        if (socket !== this.socket) return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        this.handle(message);
      });
      socket.addEventListener('error', () => { if (socket === this.socket && socket.readyState !== WebSocket.OPEN) failed('Could not connect to the match server.'); });
      socket.addEventListener('close', event => {
        if (socket !== this.socket) return;
        settle(new Error('Connection closed before the match server responded.'));
        this.socket = null;
        if (this.closedByUser) { this.setStatus('disconnected'); return; }
        if (this.token && this.room && ![4001, 4002, 4008].includes(event.code)) this.scheduleReconnect();
        else this.setStatus('disconnected');
      });
    } catch { failed('Could not connect to the match server.'); }
    return connection;
  }
  abandonSocket(socket, reason) {
    if (this.socket === socket) this.socket = null;
    try { socket?.close(1000, reason); } catch { /* A failed handshake may already be closed. */ }
  }
  checkConnection() {
    if (this.closedByUser || !this.token || !this.room || this.socket?.readyState !== WebSocket.OPEN) return;
    if (this.awaitingRejoinAt !== null && now() - this.awaitingRejoinAt > this.connectTimeoutMs) {
      this.awaitingRejoinAt = null; this.abandonSocket(this.socket, 'Rejoin response timed out'); this.scheduleReconnect(); return;
    }
    if (this.room.phase !== 'playing' || this.status !== 'connected') return;
    if (this.latestState?.phase === 'fulltime' && this.matchId === this.room.matchId) return;
    const expectedSince = Math.max(this.lastSnapshotAt ?? 0, this.snapshotExpectedSince ?? now());
    if (now() - expectedSince <= this.snapshotTimeoutMs) return;
    // Stop sending to a silent connection without waiting for its close handshake.
    // The same private token reclaims the reserved slot on the replacement socket.
    this.actions = neutral(); this.inputDirty = false; this.pending.clear();
    this.abandonSocket(this.socket, 'Match updates timed out');
    this.scheduleReconnect();
  }
  scheduleReconnect() {
    if (this.closedByUser || !this.token || !this.room) return;
    this.disconnectedAt ||= now();
    if (now() - this.disconnectedAt >= this.graceMs) { this.setStatus('disconnected'); this.onError('Reconnect window expired. Return to the menu to create another room.'); return; }
    this.setStatus('reconnecting'); clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(this.url).catch(() => {}), Math.min(4000, 400 * 1.5 ** this.retryCount++));
  }
  handle(message) {
    if (message.type === 'hello') { this.graceMs = message.reconnectGraceMs || 20_000; return; }
    if (message.type === 'pong') { if (Number.isFinite(message.sentAt)) this.latency = Math.max(0, now() - message.sentAt); return; }
    if (message.type === 'error') {
      if (message.code === 'rejoin_failed') { this.token = null; this.room = null; this.queue = []; this.pending.clear(); this.setStatus('disconnected'); }
      if (message.code !== 'stale_input') this.onError(message.message, message.code);
      return;
    }
    if (message.type === 'joined' || message.type === 'room') {
      const wasPlaying = this.room?.phase === 'playing' && this.room.matchId === message.room.matchId;
      this.room = message.room; this.team = this.room.team;
      if (this.room.phase === 'playing' && (!wasPlaying || message.type === 'joined')) this.snapshotExpectedSince = now();
      else if (this.room.phase !== 'playing') this.snapshotExpectedSince = null;
      if (message.type === 'joined') {
        this.token = message.token; this.retryCount = 0; this.disconnectedAt = 0; this.ack = message.ack; this.awaitingRejoinAt = null;
        this.seq = Math.max(this.seq, this.ack + 1); this.setStatus('connected');
        for (const [sequence, entry] of this.pending) {
          if (sequence <= this.ack || now() - entry.at > 250) this.pending.delete(sequence);
          else this.send(entry.message, false);
        }
        this.queue.splice(0).forEach(queued => this.send(queued));
      }
      this.onRoom(this.room); return;
    }
    if (message.type === 'snapshot') {
      if (message.matchId !== this.matchId) { this.frames = []; this.matchId = message.matchId; }
      if (this.frames.length && message.state.tick < this.frames.at(-1).state.tick) return;
      this.state = this.latestState = message.state; this.ack = message.ack;
      this.lastSnapshotAt = now();
      for (const sequence of this.pending.keys()) if (sequence <= this.ack) this.pending.delete(sequence);
      this.frames.push({ at: now(), state: message.state }); if (this.frames.length > 10) this.frames.shift();
      this.onState(this.state, { ack: this.ack, serverTime: message.serverTime, tick: this.state.tick, matchId: message.matchId }); return;
    }
    if (message.type === 'closed' || message.type === 'left') {
      this.room = null; this.token = null; this.state = this.latestState = null; this.frames = []; this.pending.clear(); this.queue = [];
      this.lastSnapshotAt = this.snapshotExpectedSince = this.awaitingRejoinAt = null; clearTimeout(this.retryTimer);
      this.onRoom(null); if (message.reason) this.onError(message.reason); this.setStatus('connected');
    }
  }
  send(message, queue = true) {
    if (this.socket?.readyState === WebSocket.OPEN) { this.socket.send(JSON.stringify(message)); return true; }
    if (queue && message.type !== 'input' && this.queue.length < 20) this.queue.push(message);
    return false;
  }
  create(settings = {}) { this.send({ type: 'create', settings }); }
  join(code) { this.send({ type: 'join', code: String(code).trim().toUpperCase() }); }
  ready(value = true) { this.send({ type: 'ready', ready: !!value }); }
  settings(settings) { this.send({ type: 'settings', settings }); }
  rematch() { this.send({ type: 'rematch' }); }
  input(actions) {
    const previous = this.actions;
    this.actions = { ...neutral(), ...actions };
    for (const key of PULSES) this.actions[key] = !!(previous[key] || actions[key]);
    this.inputDirty = true;
  }
  flushInput() {
    if (!this.inputDirty || !this.room || this.room.phase !== 'playing') return;
    const message = { type: 'input', seq: this.seq++, actions: { ...this.actions } };
    this.pending.set(message.seq, { at: now(), message });
    for (const [seq, entry] of this.pending) if (now() - entry.at > 250 || this.pending.size > 30) this.pending.delete(seq);
    this.send(message, false); PULSES.forEach(key => { this.actions[key] = false; }); this.inputDirty = false;
  }
  /** Render 100 ms behind snapshots. Only local movement gets a bounded visual lead. */
  sampleState(time = now()) {
    if (!this.latestState) return null;
    const target = time - 100;
    let before = this.frames[0], after = this.frames.at(-1);
    for (let i = 1; i < this.frames.length; i++) if (this.frames[i].at >= target) { before = this.frames[i - 1]; after = this.frames[i]; break; }
    if (!before || !after) return this.latestState;
    const t = Math.min(1, Math.max(0, (target - before.at) / Math.max(1, after.at - before.at)));
    const state = copyState(this.latestState);
    if (before.state.phase === after.state.phase && after.state.phase === this.latestState.phase) {
      state.players.forEach((player, index) => {
        const a = before.state.players[index], b = after.state.players[index];
        if (Math.hypot(a.x - b.x, a.z - b.z) < 6) { player.x = mix(a.x, b.x, t); player.z = mix(a.z, b.z, t); }
      });
      const a = before.state.ball, b = after.state.ball;
      if (a.state === b.state && a.owner === b.owner && Math.hypot(a.x - b.x, a.z - b.z) < 12) for (const key of ['x', 'y', 'z']) state.ball[key] = mix(a[key], b[key], t);
    }
    const localId = state.selected[this.team], player = state.players[localId], authority = this.latestState.players[localId];
    if (player && authority && state.phase === 'playing' && this.status === 'connected' && this.stateAgeMs <= 250) {
      const lead = Math.min(.12, .04 + this.latency / 2000);
      const magnitude = Math.hypot(this.actions.mx, this.actions.mz), speed = this.actions.sprint ? 7 : 4.8;
      const scale = magnitude > 1 ? 1 / magnitude : 1;
      const dx = this.actions.mx * scale * speed * lead, dz = this.actions.mz * scale * speed * lead;
      player.x = Math.max(-52.5, Math.min(52.5, authority.x + dx)); player.z = Math.max(-34, Math.min(34, authority.z + dz));
    }
    return state;
  }
  leave() {
    this.send({ type: 'leave' }, false); this.token = null; this.room = null; this.state = this.latestState = null;
    this.frames = []; this.pending.clear(); this.queue = []; this.actions = neutral(); this.inputDirty = false;
    this.lastSnapshotAt = this.snapshotExpectedSince = this.awaitingRejoinAt = null;
    clearTimeout(this.retryTimer); this.onRoom(null);
    this.setStatus(this.socket?.readyState === WebSocket.OPEN ? 'connected' : this.connectPromise ? 'connecting' : 'disconnected');
  }
  disconnect() {
    this.closedByUser = true; clearTimeout(this.retryTimer); clearInterval(this.flushTimer); clearInterval(this.pingTimer); clearInterval(this.watchdogTimer);
    this.cancelConnect?.(); clearTimeout(this.connectTimer);
    this.queue = []; this.pending.clear(); this.abandonSocket(this.socket, 'Client closed');
    this.lastSnapshotAt = this.snapshotExpectedSince = this.awaitingRejoinAt = null;
    this.token = null; this.room = null; this.setStatus('disconnected');
  }
}
