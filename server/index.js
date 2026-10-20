import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { createMatch, stepMatch } from '../shared/simulation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUTTONS = ['sprint', 'jockey', 'pass', 'through', 'passHold', 'throughHold', 'lob', 'shoot', 'finesse', 'chip', 'strike', 'clear', 'tackle', 'slide', 'switch', 'oneTwo', 'ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','cancelCharge', 'shotAssist', 'keeperAssist'];
const PULSES = ['pass', 'through', 'lob', 'strike', 'clear', 'tackle', 'slide', 'switch', 'oneTwo','ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','cancelCharge'];
const MENTALITIES = ['defensive', 'balanced', 'attacking'];
const neutral = () => ({ mx: 0, mz: 0, ...Object.fromEntries(BUTTONS.map(k => [k, false])), shotAssist:true, keeperAssist:true });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));
const defaults = () => ({ hostTeam: 0, duration: 360, difficulty: 'standard', tactics: ['balanced', 'balanced'] });

export function validateSettings(value, previous = defaults()) {
  if (!plain(value) || !onlyKeys(value, ['hostTeam', 'duration', 'difficulty', 'tactics'])) throw new Error('Invalid match settings.');
  const result = { ...previous, ...value };
  if (![0, 1].includes(result.hostTeam) || !Number.isInteger(result.duration) || result.duration < 60 || result.duration > 600 || !['easy', 'standard'].includes(result.difficulty) || !Array.isArray(result.tactics) || result.tactics.length !== 2 || result.tactics.some(v => !MENTALITIES.includes(v))) throw new Error('Invalid match settings.');
  return { ...result, tactics: [...result.tactics] };
}

export function validateInput(value) {
  if (!plain(value) || !onlyKeys(value, ['mx', 'mz', ...BUTTONS]) || !Number.isFinite(value.mx) || !Number.isFinite(value.mz) || Math.abs(value.mx) > 1 || Math.abs(value.mz) > 1 || BUTTONS.some(k => value[k] !== undefined && typeof value[k] !== 'boolean')) throw new Error('Invalid input. Send movement and action intentions only.');
  const input = { ...neutral(), ...value };
  const length = Math.hypot(input.mx, input.mz);
  if (length > 1) { input.mx /= length; input.mz /= length; }
  return input;
}

function roomCode(rooms) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (rooms.has(code));
  return code;
}

function tokenMatches(expected, value) {
  if (typeof value !== 'string' || value.length !== expected.length) return false;
  const a = Buffer.from(expected), b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Persistent authoritative service. listen() resolves only once the port is bound. */
export function createGameServer({ port = 8787, host = '127.0.0.1', staticDir = path.join(ROOT, 'dist'), reconnectGraceMs = 20_000, staleInputMs = 250, roomIdleMs = 600_000, maxRooms = 100, allowedOrigins = [] } = {}) {
  const rooms = new Map();
  const sockets = new Set();
  let tickTimer, pingTimer, lastTick = performance.now(), accumulator = 0;
  let started = false, stopped = false;
  const send = (ws, data) => { if (ws?.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 1_000_000) ws.close(4008, 'Slow connection'); else ws.send(JSON.stringify(data)); } };
  const error = (ws, code, message) => send(ws, { type: 'error', code, message });
  const teamOf = (room, index) => index === 0 ? room.settings.hostTeam : 1 - room.settings.hostTeam;
  const publicRoom = (room, index) => ({ code: room.code, slot: index, team: teamOf(room, index), host: index === 0, settings: room.settings, phase: room.state ? room.state.phase === 'fulltime' ? 'finished' : 'playing' : 'lobby', matchId: room.matchId, players: room.slots.map(slot => slot ? { connected: !!slot.ws, ready: slot.ready, rematch: slot.rematch } : null) });
  const broadcastRoom = room => room.slots.forEach((slot, index) => send(slot?.ws, { type: 'room', room: publicRoom(room, index) }));
  const snapshot = room => room.slots.forEach(slot => send(slot?.ws, { type: 'snapshot', state: room.state, matchId: room.matchId, ack: slot.ack, serverTime: Date.now() }));
  const finishDeparture = (room, index) => {
    if (!room.state || room.state.phase === 'fulltime') return;
    room.state.phase = 'fulltime'; room.state.phaseTime = 0;
    room.state.result = { reason: 'disconnect', winner: teamOf(room, 1 - index), departedTeam: teamOf(room, index) };
    room.state.event = { id: (room.state.event?.id || 0) + 1, type: 'fulltime', text: 'Match ended: opponent left.' };
    snapshot(room); broadcastRoom(room);
  };
  const destroyRoom = (room, reason) => { room.slots.forEach(slot => { if (slot?.ws) { send(slot.ws, { type: 'closed', reason }); slot.ws.room = null; slot.ws.slot = null; } }); rooms.delete(room.code); };
  const release = (ws, explicit = false) => {
    const room = ws.room, index = ws.slot;
    ws.room = null; ws.slot = null;
    if (!room || room.slots[index]?.ws !== ws) return;
    const slot = room.slots[index];
    slot.ws = null; slot.ready = false; slot.input = neutral(); slot.pulses = {};
    slot.disconnectedAt = Date.now(); slot.lastInputAt = 0;
    if (explicit) {
      slot.expired = true;
      if (room.state) finishDeparture(room, index);
      else if (index === 0) { destroyRoom(room, 'Host left the lobby.'); return; }
      else room.slots[index] = null;
    }
    room.updatedAt = Date.now(); broadcastRoom(room);
  };
  const startMatch = room => {
    room.matchId += 1;
    room.state = createMatch({ duration: room.settings.duration, difficulty: room.settings.difficulty, tactics: room.settings.tactics, humans: [true, true] });
    room.slots.forEach(slot => { slot.ready = false; slot.rematch = false; slot.input = neutral(); slot.pulses = {}; slot.lastInputAt = 0; });
    room.updatedAt = Date.now(); broadcastRoom(room); snapshot(room);
  };
  const attach = (ws, room, index) => {
    const slot = room.slots[index];
    if (slot.ws && slot.ws !== ws) { const old = slot.ws; old.room = null; old.slot = null; old.close(4001, 'Connection replaced'); }
    ws.room = room; ws.slot = index; slot.ws = ws; slot.disconnectedAt = null;
    room.updatedAt = Date.now();
    send(ws, { type: 'joined', room: publicRoom(room, index), token: slot.token, ack: slot.ack });
    broadcastRoom(room);
    if (room.state) snapshot(room);
  };
  const newSlot = () => ({ ws: null, token: randomBytes(24).toString('base64url'), ready: false, rematch: false, expired: false, disconnectedAt: null, input: neutral(), pulses: {}, lastInputAt: 0, seq: -1, ack: -1 });

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400); response.end('Bad path'); return; }
    if (pathname === '/health') { response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(request.method === 'HEAD' ? '' : JSON.stringify({ ok: true, protocol: 1, rooms: rooms.size })); return; }
    if (pathname.includes('\0') || pathname.includes('\\')) { response.writeHead(400); response.end('Bad path'); return; }
    const base = path.resolve(staticDir);
    const requested = path.resolve(base, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (requested !== base && !requested.startsWith(base + path.sep)) { response.writeHead(403); response.end('Forbidden'); return; }
    try {
      const info = await stat(requested);
      if (!info.isFile()) throw new Error('Not a file');
      const data = await readFile(requested);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
      response.writeHead(200, { 'Content-Type': types[path.extname(requested)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Length': data.length }); response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found. Run npm run build first.'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  server.on('upgrade', (request, socket, head) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; } catch { socket.destroy(); return; }
    if (pathname !== '/ws' || (allowedOrigins.length && !allowedOrigins.includes(request.headers.origin))) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
  });
  wss.on('connection', ws => {
    sockets.add(ws); ws.alive = true; ws.rate = { tokens: 90, at: Date.now() }; ws.inputRate = { tokens: 45, at: Date.now() }; ws.badMessages = 0;
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('close', () => { sockets.delete(ws); release(ws); });
    send(ws, { type: 'hello', protocol: 1, tickRate: 60, inputRate: 30, snapshotRate: 20, reconnectGraceMs });
    const consume = (bucket, refill) => { const now = Date.now(); bucket.tokens = Math.min(refill * 1.5, bucket.tokens + (now - bucket.at) * refill / 1000); bucket.at = now; if (bucket.tokens < 1) return false; bucket.tokens -= 1; return true; };
    ws.on('message', (data, binary) => {
      if (!consume(ws.rate, 60)) { error(ws, 'rate_limit', 'Too many messages.'); ws.close(4008, 'Rate limit'); return; }
      let message;
      try { if (binary) throw new Error('JSON text messages are required.'); message = JSON.parse(data.toString()); if (!plain(message) || typeof message.type !== 'string') throw new Error('Invalid message.'); }
      catch { error(ws, 'invalid_message', 'Expected a valid JSON message.'); if (++ws.badMessages >= 5) ws.close(4002, 'Invalid messages'); return; }
      try {
        const room = ws.room, index = ws.slot, slot = room?.slots[index];
        if (message.type === 'ping') { send(ws, { type: 'pong', sentAt: Number.isFinite(message.sentAt) ? message.sentAt : null, serverTime: Date.now() }); return; }
        if (message.type === 'create') {
          if (room) throw new Error('Leave your current room first.');
          if (rooms.size >= maxRooms) { error(ws, 'server_full', 'Server is full. Please try again later.'); return; }
          const settings = validateSettings(message.settings || {});
          const created = { code: roomCode(rooms), settings, slots: [newSlot(), null], state: null, matchId: 0, updatedAt: Date.now() };
          rooms.set(created.code, created); attach(ws, created, 0); return;
        }
        if (message.type === 'join') {
          if (room) throw new Error('Leave your current room first.');
          const found = typeof message.code === 'string' ? rooms.get(message.code.trim().toUpperCase()) : null;
          if (!found) { error(ws, 'room_missing', 'Room not found. Check the code.'); return; }
          if (found.slots[1] || found.state) { error(ws, 'room_full', 'This room already has two reserved players.'); return; }
          found.slots[1] = newSlot(); attach(ws, found, 1); return;
        }
        if (message.type === 'rejoin') {
          if (room) throw new Error('Already in a room.');
          const found = typeof message.code === 'string' ? rooms.get(message.code.toUpperCase()) : null;
          const foundIndex = found?.slots.findIndex(s => s && !s.expired && tokenMatches(s.token, message.token) && (s.disconnectedAt === null || Date.now() - s.disconnectedAt <= reconnectGraceMs));
          if (!found || foundIndex < 0 || foundIndex === undefined) { error(ws, 'rejoin_failed', 'Reconnect window expired or token is invalid.'); return; }
          attach(ws, found, foundIndex); return;
        }
        if (message.type === 'leave') { release(ws, true); send(ws, { type: 'left' }); return; }
        if (!room || !slot) throw new Error('Join a room first.');
        if (message.type === 'settings') {
          if (room.state) throw new Error('Settings can only change before kick-off.');
          const next = validateSettings(message.settings, room.settings);
          if (index !== 0 && (next.hostTeam !== room.settings.hostTeam || next.duration !== room.settings.duration || next.difficulty !== room.settings.difficulty || next.tactics[teamOf(room, 0)] !== room.settings.tactics[teamOf(room, 0)])) throw new Error('Only the host may change match settings; guests may change their own tactic.');
          room.settings = next; room.slots.forEach(s => { if (s) s.ready = false; }); broadcastRoom(room);
        } else if (message.type === 'ready') {
          if (room.state || typeof message.ready !== 'boolean') throw new Error('Ready is only available in the lobby.');
          slot.ready = message.ready; broadcastRoom(room);
          if (room.slots.every(s => s?.ws && s.ready)) startMatch(room);
        } else if (message.type === 'input') {
          if (!onlyKeys(message, ['type', 'seq', 'actions']) || !Number.isSafeInteger(message.seq) || message.seq < 0) throw new Error('Invalid input sequence.');
          const input = validateInput(message.actions);
          if (!room.state || room.state.phase === 'fulltime') return;
          if (message.seq <= slot.seq) { error(ws, 'stale_input', 'Input sequence already received.'); return; }
          if (!consume(ws.inputRate, 35)) { error(ws, 'input_rate', 'Input rate exceeded.'); return; }
          slot.seq = message.seq; slot.input = input; slot.lastInputAt = Date.now();
          PULSES.forEach(key => { if (input[key]) slot.pulses[key] = true; });
        } else if (message.type === 'rematch') {
          if (room.state?.phase !== 'fulltime' || !room.slots.every(s => s?.ws && !s.expired)) throw new Error('Both players must be connected after full-time.');
          slot.rematch = true; broadcastRoom(room); if (room.slots.every(s => s.rematch)) startMatch(room);
        } else throw new Error('Unknown message type.');
        room.updatedAt = Date.now();
      } catch (caught) { error(ws, 'invalid_request', caught.message); if (++ws.badMessages >= 12) ws.close(4002, 'Invalid requests'); }
    });
  });

  const tick = () => {
    const now = performance.now(); accumulator += Math.min((now - lastTick) / 1000, .1); lastTick = now;
    const wallTime = Date.now();
    for (const room of rooms.values()) {
      room.slots.forEach((slot, index) => {
        if (slot && !slot.ws && !slot.expired && slot.disconnectedAt !== null && wallTime - slot.disconnectedAt >= reconnectGraceMs) {
          slot.expired = true;
          if (room.state) finishDeparture(room, index);
          else if (index === 0) destroyRoom(room, 'Host reconnect window expired.');
          else { room.slots[index] = null; broadcastRoom(room); }
        }
      });
      if (wallTime - room.updatedAt > roomIdleMs && (!room.state || room.state.phase === 'fulltime' || room.slots.every(s => !s?.ws))) destroyRoom(room, 'Inactive room expired.');
    }
    while (accumulator >= 1 / 60) {
      accumulator -= 1 / 60;
      for (const room of rooms.values()) {
        if (!room.state || room.state.phase === 'fulltime') continue;
        const inputs = [null, null];
        room.slots.forEach((slot, index) => {
          if (!slot) return;
          const fresh = !!slot.ws && wallTime - slot.lastInputAt < staleInputMs;
          inputs[teamOf(room, index)] = slot.ws ? (fresh ? { ...slot.input, ...slot.pulses } : {...neutral(),cancelCharge:true}) : null;
          PULSES.forEach(key => { slot.input[key] = false; }); slot.pulses = {};
          slot.ack = slot.seq;
        });
        const oldPhase = room.state.phase;
        stepMatch(room.state, inputs, 1 / 60);
        if (room.state.tick % 3 === 0 || room.state.phase === 'fulltime') snapshot(room);
        if (oldPhase !== 'fulltime' && room.state.phase === 'fulltime') { room.updatedAt = wallTime; broadcastRoom(room); }
      }
    }
  };
  return {
    server, wss, rooms,
    address: () => server.address(),
    async listen() {
      if (started) return server.address();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
      started = true; lastTick = performance.now();
      tickTimer = setInterval(tick, 1000 / 60);
      pingTimer = setInterval(() => { sockets.forEach(ws => { if (!ws.alive) { ws.terminate(); return; } ws.alive = false; ws.ping(); }); }, 15_000);
      return server.address();
    },
    async close() {
      if (stopped) return; stopped = true; clearInterval(tickTimer); clearInterval(pingTimer);
      sockets.forEach(ws => ws.terminate()); rooms.clear();
      await new Promise(resolve => wss.close(resolve));
      if (started) await new Promise(resolve => server.close(resolve));
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const service = createGameServer({ port: Number(process.env.PORT || 8787), host: process.env.HOST || '0.0.0.0', allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean) });
  service.listen().then(address => console.log(`Touchline Eleven on http://localhost:${address.port} — WebSocket /ws`)).catch(error => { console.error(error); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.close().then(() => { process.exitCode = 0; }); });
}
