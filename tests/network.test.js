import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createGameServer, validateInput, validateSettings } from '../server/index.js';
import { NetworkClient } from '../client/network.js';

async function eventually(predicate, timeout = 2500) {
  const until = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > until) throw new Error('Condition did not become true'); await delay(10); }
}

class Peer {
  constructor(url) {
    this.ws = new WebSocket(url); this.messages = []; this.waiters = [];
    this.ws.on('message', data => { const message = JSON.parse(data.toString()); this.messages.push(message); this.waiters.slice().forEach(waiter => waiter()); });
    this.ws.on('error', () => {});
  }
  send(message) { this.ws.send(typeof message === 'string' ? message : JSON.stringify(message)); }
  wait(predicate, from = 0, timeout = 2500) {
    return new Promise((resolve, reject) => {
      const check = () => { const found = this.messages.slice(from).find(predicate); if (found) { cleanup(); resolve(found); } };
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for message. Received: ${this.messages.slice(from).map(m => m.type + ':' + (m.code || m.state?.phase || '')).join(', ')}`)); }, timeout);
      const cleanup = () => { clearTimeout(timer); this.waiters = this.waiters.filter(fn => fn !== check); };
      this.waiters.push(check); check();
    });
  }
  close() { this.ws.terminate(); }
}

async function fixture(t, options = {}) {
  const service = createGameServer({ port: 0, reconnectGraceMs: 2000, ...options });
  const address = await service.listen(); const peers = [];
  t.after(async () => { peers.forEach(peer => peer.close()); await service.close(); });
  const peer = async () => { const client = new Peer(`ws://127.0.0.1:${address.port}/ws`); peers.push(client); await client.wait(m => m.type === 'hello'); return client; };
  const pair = async (settings = {}) => {
    const host = await peer(); host.send({ type: 'create', settings }); const joined = await host.wait(m => m.type === 'joined');
    const guest = await peer(); guest.send({ type: 'join', code: joined.room.code }); const guestJoined = await guest.wait(m => m.type === 'joined');
    return { host, guest, code: joined.room.code, token: joined.token, guestToken: guestJoined.token };
  };
  return { service, peer, pair, address };
}

test('a charged human restart cancels when network input becomes stale, then accepts fresh input',async t=>{
  const {pair,service}=await fixture(t);const {host,guest,code}=await pair();
  host.send({type:'ready',ready:true});guest.send({type:'ready',ready:true});await host.wait(m=>m.type==='snapshot');
  const room=service.rooms.get(code),s=room.state;Object.assign(s,{phase:'restart',phaseTime:3,restart:{type:'freeKick',team:0,x:20,z:0,taker:8,armed:false}});
  Object.assign(s.ball,{x:20,y:.11,z:0,owner:8,vx:0,vy:0,vz:0});s.selected[0]=8;
  host.send({type:'input',seq:1,actions:{mx:0,mz:1}});await eventually(()=>room.slots[0].ack===1&&s.restart.armed);
  host.send({type:'input',seq:2,actions:{mx:0,mz:1,shoot:true}});await eventually(()=>s.players[8].charge>.05);
  await eventually(()=>s.players[8].charge===0);assert.equal(s.phase,'restart');assert.equal(s.stats.shots[0],0);
  host.send({type:'input',seq:3,actions:{mx:0,mz:1}});await eventually(()=>s.restart.armed);
  host.send({type:'input',seq:4,actions:{mx:0,mz:1,shoot:true}});await eventually(()=>s.players[8].charge>.05);
  host.send({type:'input',seq:5,actions:{mx:0,mz:1}});await eventually(()=>s.stats.shots[0]===1);assert.ok(s.ball.vz>0);
});

test('settings and intentions reject non-finite, foreign, and oversized values', () => {
  for(const key of ['finesse','chip']){assert.equal(validateInput({mx:0,mz:0,[key]:true})[key],true);assert.throws(()=>validateInput({mx:0,mz:0,[key]:'true'}));}
  assert.throws(() => validateInput({ mx: Infinity, mz: 0 }));
  assert.throws(() => validateInput({ mx: 2, mz: 0 }));
  assert.throws(() => validateInput({ mx: 0, mz: 0, score: [99, 0] }));
  assert.throws(() => validateInput({ mx: 0, mz: 0, shoot: 'yes' }));
  assert.throws(() => validateInput({ mx: 0, mz: 0, slide: 'yes' }));
  assert.throws(() => validateInput({ mx: 0, mz: 0, slide: 1 }));
  assert.equal(validateInput({ mx: 0, mz: 0, slide: true }).slide, true);
  assert.equal(validateInput({ mx: 0, mz: 0 }).slide, false);
  const diagonal = validateInput({ mx: 1, mz: 1, pass: true });
  assert.ok(Math.abs(Math.hypot(diagonal.mx, diagonal.mz) - 1) < 1e-9);
  assert.throws(() => validateSettings({ duration: 36000 }));
  assert.throws(() => validateSettings({ tactics: ['teleport', 'balanced'] }));
  assert.deepEqual(validateSettings({ hostTeam: 1 }).hostTeam, 1);
});

test('slide intentions are consumed once and stale sequence replay cannot enqueue another slide', async t => {
  const { pair, service } = await fixture(t);
  const { host, guest, code } = await pair();
  host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true }); await host.wait(m => m.type === 'snapshot');
  const slot = service.rooms.get(code).slots[0];
  host.send({ type: 'input', seq: 41, actions: { mx: 0, mz: 0, slide: true } });
  await host.wait(m => m.type === 'snapshot' && m.ack === 41);
  assert.equal(slot.input.slide, false); assert.equal(slot.pulses.slide, undefined);
  let mark = host.messages.length;
  host.send({ type: 'input', seq: 42, actions: { mx: 0, mz: 0, slide: 'true' } });
  await host.wait(m => m.type === 'error' && m.code === 'invalid_request', mark);
  assert.equal(slot.seq, 41, 'invalid slide does not consume an input sequence');
  mark = host.messages.length;
  host.send({ type: 'input', seq: 41, actions: { mx: 0, mz: 0, slide: true } });
  await host.wait(m => m.type === 'error' && m.code === 'stale_input', mark);
  assert.equal(slot.seq, 41); assert.equal(slot.input.slide, false); assert.equal(slot.pulses.slide, undefined);
});

test('browser client preserves a short slide pulse until one flush and sends neutral slide thereafter', t => {
  const client = new NetworkClient(); t.after(() => client.disconnect());
  const sent = []; client.send = message => { sent.push(structuredClone(message)); return true; };
  client.room = { phase: 'playing' };
  client.input({ mx: 0, mz: 0, slide: true }); client.input({ mx: 1, mz: 0, slide: false });
  assert.equal(client.actions.slide, true);
  client.flushInput(); assert.equal(sent[0].actions.slide, true); assert.equal(client.actions.slide, false);
  client.input({ mx: 0, mz: 0 }); client.flushInput();
  assert.equal(sent[1].actions.slide, false); assert.equal(sent[1].seq, sent[0].seq + 1);
  assert.equal(client.pending.get(sent[0].seq).message.actions.slide, true, 'retry retains the original sequenced intention');
});

test('shot modifiers survive transport while held and clear on button-up',t=>{
  const client=new NetworkClient();t.after(()=>client.disconnect());const sent=[];
  client.send=message=>{sent.push(structuredClone(message));return true;};client.room={phase:'playing'};
  for(const kind of ['finesse','chip']){
    client.input({mx:0,mz:0,shoot:true,[kind]:true});client.flushInput();
    assert.equal(validateInput(sent.at(-1).actions)[kind],true);assert.equal(client.actions[kind],true);
    client.input({mx:0,mz:0,shoot:false});client.flushInput();assert.equal(sent.at(-1).actions[kind],false);
  }
});

test('held pass intentions persist between flushes and a sub-flush tap retains one release fallback', t => {
  const client=new NetworkClient();t.after(()=>client.disconnect());
  const sent=[];client.send=message=>{sent.push(structuredClone(message));return true;};client.room={phase:'playing'};
  for(const [held,pulse] of [['passHold','pass'],['throughHold','through']]){
    assert.equal(validateInput({mx:0,mz:0,[held]:true})[held],true);
    assert.throws(()=>validateInput({mx:0,mz:0,[held]:'true'}));
    client.input({mx:0,mz:0,[held]:true});client.flushInput();assert.equal(sent.at(-1).actions[held],true);
    client.input({mx:0,mz:0,[held]:true});client.flushInput();assert.equal(sent.at(-1).actions[held],true);
    client.input({mx:0,mz:0,[held]:false,[pulse]:true});client.input({mx:0,mz:0});client.flushInput();
    assert.equal(sent.at(-1).actions[held],false);assert.equal(sent.at(-1).actions[pulse],true);
    client.input({mx:0,mz:0});client.flushInput();assert.equal(sent.at(-1).actions[pulse],false);
    client.input({mx:0,mz:0,[held]:true});client.input({mx:0,mz:0,[held]:false,[pulse]:true});client.flushInput();
    assert.equal(sent.at(-1).actions[held],false);assert.equal(sent.at(-1).actions[pulse],true);
  }
});

test('two clients get the same authority, settings, mapped teams and a strict two-slot room', async t => {
  const { pair, peer } = await fixture(t);
  const { host, guest, code } = await pair({ hostTeam: 1, duration: 60, difficulty: 'easy', tactics: ['attacking', 'defensive'] });
  assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(host.messages.find(m => m.type === 'joined').room.team, 1);
  assert.equal(guest.messages.find(m => m.type === 'joined').room.team, 0);
  const third = await peer(); third.send({ type: 'join', code });
  assert.equal((await third.wait(m => m.type === 'error')).code, 'room_full');
  const guestMark = guest.messages.length;
  guest.send({ type: 'settings', settings: { duration: 600 } });
  assert.match((await guest.wait(m => m.type === 'error', guestMark)).message, /host/);
  guest.send({ type: 'settings', settings: { hostTeam: 1, duration: 60, difficulty: 'easy', tactics: ['balanced', 'defensive'] } });
  await host.wait(m => m.type === 'room' && m.room.settings.tactics[0] === 'balanced');
  host.send({ type: 'ready', ready: true }); await delay(75);
  assert.equal(host.messages.filter(m => m.type === 'snapshot').length, 0, 'one ready cannot start');
  guest.send({ type: 'ready', ready: true });
  const a = await host.wait(m => m.type === 'snapshot'); const b = await guest.wait(m => m.type === 'snapshot');
  assert.deepEqual(a.state, b.state); assert.equal(a.state.players.length, 22); assert.deepEqual(a.state.score, [0, 0]);
  assert.equal(a.state.options.duration, 60);
});

test('settings invalidate readiness; inputs are sequenced, acknowledged and expire', async t => {
  const { pair, service } = await fixture(t, { staleInputMs: 100 });
  const { host, guest, code } = await pair();
  host.send({ type: 'ready', ready: true });
  host.send({ type: 'settings', settings: { hostTeam: 1 } });
  await host.wait(m => m.type === 'room' && m.room.settings.hostTeam === 1 && !m.room.players[0].ready);
  guest.send({ type: 'ready', ready: true }); await delay(40);
  assert.equal(service.rooms.get(code).state, null);
  host.send({ type: 'ready', ready: true }); await host.wait(m => m.type === 'snapshot');
  host.send({ type: 'input', seq: 7, actions: { mx: 1, mz: 0, pass: true } });
  await host.wait(m => m.type === 'snapshot' && m.ack === 7);
  const slot = service.rooms.get(code).slots[0];
  assert.equal(slot.input.pass, false, 'pulse consumed once');
  assert.equal(slot.seq, 7);
  host.send({ type: 'input', seq: 7, actions: { mx: -1, mz: 0 } });
  assert.equal((await host.wait(m => m.type === 'error' && m.code === 'stale_input')).code, 'stale_input');
  await delay(150); assert.ok(Date.now() - slot.lastInputAt > 100, 'stale movement is no longer eligible');
  assert.equal(service.rooms.get(code).state.previous[1].mx, 0, 'the team selected by the host receives neutral movement after expiry');
  assert.equal(slot.seq, 7, 'replay cannot change the acknowledged sequence');
});

test('malformed JSON and client-supplied goals never alter server-owned score', async t => {
  const { pair, service } = await fixture(t);
  const { host, guest, code } = await pair();
  host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true }); await host.wait(m => m.type === 'snapshot');
  const before = [...service.rooms.get(code).state.score];
  host.send('{broken'); await host.wait(m => m.type === 'error' && m.code === 'invalid_message');
  let mark = host.messages.length; host.send({ type: 'goal', team: 0, score: 999 });
  await host.wait(m => m.type === 'error' && m.code === 'invalid_request', mark);
  mark = host.messages.length; host.send({ type: 'input', seq: 10, actions: { mx: 0, mz: 0, score: [999, 0] } });
  await host.wait(m => m.type === 'error' && m.code === 'invalid_request', mark);
  assert.deepEqual(service.rooms.get(code).state.score, before);
  assert.equal(service.rooms.get(code).slots[0].seq, -1);
  mark = host.messages.length; host.send({ type: 'pause' });
  await host.wait(m => m.type === 'error' && m.code === 'invalid_request', mark);
  assert.notEqual(service.rooms.get(code).state.phase, 'paused');
});

test('token reconnect retains match, reserved slot, sequence and score', async t => {
  const { pair, peer, service } = await fixture(t);
  const { host, guest, code, token } = await pair();
  host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true }); await host.wait(m => m.type === 'snapshot');
  host.send({ type: 'input', seq: 23, actions: { mx: 0, mz: 0 } });
  const earlier = await host.wait(m => m.type === 'snapshot' && m.ack === 23);
  host.close(); await guest.wait(m => m.type === 'room' && m.room.players[0]?.connected === false);
  const intruder = await peer(); intruder.send({ type: 'rejoin', code, token: 'not-the-token' });
  await intruder.wait(m => m.type === 'error' && m.code === 'rejoin_failed');
  const returned = await peer(); returned.send({ type: 'rejoin', code, token });
  const joined = await returned.wait(m => m.type === 'joined'); const state = await returned.wait(m => m.type === 'snapshot');
  assert.equal(joined.ack, 23); assert.equal(joined.room.slot, 0);
  assert.equal(state.matchId, earlier.matchId); assert.ok(state.state.tick >= earlier.state.tick);
  assert.equal(service.rooms.get(code).slots.filter(Boolean).length, 2);
});

test('disconnect grace ends the match authoritatively without inventing a goal', async t => {
  const { pair, peer, service } = await fixture(t, { reconnectGraceMs: 100 });
  const { host, guest, code, token } = await pair({ hostTeam: 1 });
  host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true }); await guest.wait(m => m.type === 'snapshot');
  host.close();
  const end = await guest.wait(m => m.type === 'snapshot' && m.state.phase === 'fulltime');
  assert.deepEqual(end.state.score, [0, 0]); assert.equal(end.state.result.reason, 'disconnect'); assert.equal(end.state.result.winner, 0);
  const returned = await peer(); returned.send({ type: 'rejoin', code, token }); await returned.wait(m => m.type === 'error' && m.code === 'rejoin_failed');
  assert.equal(service.rooms.get(code).state.phase, 'fulltime');
});

test('mutual rematch alone creates a fresh authoritative match', async t => {
  const { pair, service } = await fixture(t);
  const { host, guest, code } = await pair({ duration: 60 });
  host.send({ type: 'ready', ready: true }); guest.send({ type: 'ready', ready: true }); await host.wait(m => m.type === 'snapshot');
  // Advance the authoritative fixture to regulation's last tick, preserving normal finish logic.
  const room = service.rooms.get(code);
  room.state.phase = 'playing'; room.state.half = 2; room.state.time = 60;
  await host.wait(m => m.type === 'snapshot' && m.state.phase === 'fulltime');
  host.send({ type: 'rematch' }); await guest.wait(m => m.type === 'room' && m.room.players[0].rematch);
  assert.equal(room.matchId, 1); assert.equal(room.state.phase, 'fulltime');
  guest.send({ type: 'rematch' });
  const next = await guest.wait(m => m.type === 'snapshot' && m.matchId === 2);
  assert.equal(next.state.phase, 'kickoff'); assert.equal(next.state.half, 1); assert.deepEqual(next.state.score, [0, 0]);
});

test('HTTP health serves only configured static root; room expiry clears a dead lobby', async t => {
  const { address, pair, service } = await fixture(t, { reconnectGraceMs: 75 });
  const health = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(health.status, 200); assert.equal((await health.json()).protocol, 1);
  const missing = await fetch(`http://127.0.0.1:${address.port}/server/index.js`); assert.equal(missing.status, 404);
  const method = await fetch(`http://127.0.0.1:${address.port}/health`, { method: 'POST' }); assert.equal(method.status, 405);
  const { host, guest, code } = await pair(); host.close();
  await guest.wait(m => m.type === 'closed'); assert.equal(service.rooms.has(code), false);
});

test('oversized messages and sustained floods close only the offending sockets', { timeout: 8000 }, async t => {
  const { peer } = await fixture(t);
  const huge = await peer();
  const oversizeClose = new Promise(resolve => huge.ws.once('close', resolve));
  huge.send('x'.repeat(4097)); assert.equal(await oversizeClose, 1009);
  const flood = await peer(); const floodClose = new Promise(resolve => flood.ws.once('close', resolve));
  for (let i = 0; i < 140; i++) flood.send({ type: 'ping', sentAt: i });
  assert.equal(await floodClose, 4008);
  const healthy = await peer(); healthy.send({ type: 'create' });
  assert.ok((await healthy.wait(m => m.type === 'joined')).room.code);
});

test('browser network helper coalesces actions, preserves authority and automatically rejoins', { timeout: 8000 }, async t => {
  const { address, peer, service } = await fixture(t);
  const savedLocation = globalThis.location, savedWebSocket = globalThis.WebSocket;
  globalThis.location = { href: `http://127.0.0.1:${address.port}` }; globalThis.WebSocket = WebSocket;
  const errors = [], statuses = [];
  const client = new NetworkClient({ onError: error => errors.push(error), onStatus: status => statuses.push(status) });
  t.after(() => { client.disconnect(); globalThis.location = savedLocation; globalThis.WebSocket = savedWebSocket; });
  const connection = client.connect(`ws://127.0.0.1:${address.port}/ws`);
  client.create({ hostTeam: 1 }); // Queues correctly before the socket opens.
  await connection; await eventually(() => client.room !== null);
  const guest = await peer(); guest.send({ type: 'join', code: client.room.code }); await guest.wait(m => m.type === 'joined');
  client.ready(); guest.send({ type: 'ready', ready: true }); await eventually(() => client.latestState !== null);
  client.input({ mx: 1, mz: 0, pass: true }); client.input({ mx: 0, mz: 1 });
  assert.equal(client.actions.pass, true, 'a render frame cannot discard a pending pulse');
  client.flushInput(); await eventually(() => client.ack >= 0);
  const sequence = client.ack, matchId = client.matchId, authority = JSON.stringify(client.latestState);
  const view = client.sampleState(); assert.equal(view.players.length, 22); assert.equal(JSON.stringify(client.latestState), authority, 'render prediction never mutates authority');
  assert.notEqual(view, client.latestState); assert.deepEqual(view.score, client.latestState.score);
  const code = client.room.code; client.socket.close();
  await eventually(() => statuses.includes('reconnecting'));
  await eventually(() => client.status === 'connected' && client.disconnectedAt === 0 && service.rooms.get(code).slots[0].ws !== null);
  assert.equal(client.matchId, matchId); assert.ok(client.ack >= sequence); assert.equal(client.team, 1); assert.deepEqual(errors, []);
});

test('ordered 35–120 ms one-way latency and jitter retain matching authority and input acknowledgements', { timeout: 8000 }, async t => {
  const { address, peer } = await fixture(t);
  const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(relay, 'listening');
  const bridges = new Set(), pendingTimers = new Set();
  const delayedForward = destination => {
    let index = 0, lastDue = 0;
    return data => {
      // Preserve TCP ordering while varying one-way delivery. This emulates latency,
      // not packet loss: reliable WebSocket transport must not reorder frames.
      const lag = [35, 120, 60, 90][index++ % 4];
      const due = lastDue = Math.max(Date.now() + lag, lastDue + 1);
      const timer = setTimeout(() => { pendingTimers.delete(timer); if (destination.readyState === WebSocket.OPEN) destination.send(data, { binary: false }); }, due - Date.now());
      pendingTimers.add(timer);
    };
  };
  relay.on('connection', downstream => {
    const upstream = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    bridges.add(downstream); bridges.add(upstream);
    downstream.on('message', delayedForward(upstream)); upstream.on('message', delayedForward(downstream));
    downstream.on('error', () => {}); upstream.on('error', () => {});
    downstream.on('close', () => upstream.terminate()); upstream.on('close', () => downstream.close());
  });
  t.after(async () => { pendingTimers.forEach(clearTimeout); bridges.forEach(socket => socket.terminate()); await new Promise(resolve => relay.close(resolve)); });
  const delayed = new Peer(`ws://127.0.0.1:${relay.address().port}`); t.after(() => delayed.close());
  await delayed.wait(m => m.type === 'hello');
  delayed.send({ type: 'create', settings: { duration: 60 } }); const joined = await delayed.wait(m => m.type === 'joined');
  const direct = await peer(); direct.send({ type: 'join', code: joined.room.code }); await direct.wait(m => m.type === 'joined');
  delayed.send({ type: 'ready', ready: true }); direct.send({ type: 'ready', ready: true });
  await delayed.wait(m => m.type === 'snapshot');
  for (let sequence = 0; sequence < 20; sequence++) { delayed.send({ type: 'input', seq: sequence, actions: { mx: .5, mz: sequence % 2 ? .5 : -.5 } }); await delay(34); }
  await delayed.wait(m => m.type === 'snapshot' && m.ack === 19);
  const directStates = new Map(direct.messages.filter(m => m.type === 'snapshot').map(m => [m.state.tick, m.state]));
  let shared = 0;
  for (const message of delayed.messages.filter(m => m.type === 'snapshot')) {
    const matching = directStates.get(message.state.tick);
    if (matching) { assert.deepEqual(message.state, matching); shared++; }
  }
  assert.ok(shared >= 5, `Expected multiple matching snapshots, saw ${shared}`);
  const sentAt = Date.now(); delayed.send({ type: 'ping', sentAt });
  await delayed.wait(m => m.type === 'pong' && m.sentAt === sentAt);
  const roundTrip = Date.now() - sentAt;
  assert.ok(roundTrip >= 70 && roundTrip < 1500, `Expected injected latency, saw ${roundTrip} ms`);
  t.diagnostic(`${shared} matching snapshots under ordered 35–120 ms one-way jitter; probe RTT ${roundTrip} ms.`);
});

test('silent match snapshots trigger same-room recovery while lobby and full-time remain stable', { timeout: 8000 }, async t => {
  const { address, peer, service } = await fixture(t);
  const savedLocation = globalThis.location, savedWebSocket = globalThis.WebSocket;
  globalThis.location = { href: `http://127.0.0.1:${address.port}` }; globalThis.WebSocket = WebSocket;
  const statuses = [];
  const client = new NetworkClient({ snapshotTimeoutMs: 120, connectTimeoutMs: 500, onStatus: status => statuses.push(status) });
  t.after(() => { client.disconnect(); globalThis.location = savedLocation; globalThis.WebSocket = savedWebSocket; });
  await client.connect(`ws://127.0.0.1:${address.port}/ws`); client.create({ duration: 60 }); await eventually(() => client.room !== null);
  const lobbySocket = client.socket; await delay(300);
  assert.equal(client.socket, lobbySocket, 'a quiet lobby does not require match snapshots');
  const guest = await peer(); guest.send({ type: 'join', code: client.room.code }); await guest.wait(m => m.type === 'joined');
  client.ready(); guest.send({ type: 'ready', ready: true }); await eventually(() => client.latestState !== null);
  const code = client.room.code, token = client.token, matchId = client.matchId, oldSocket = client.socket;
  const serverSocket = service.rooms.get(code).slots[0].ws, originalSend = serverSocket.send;
  serverSocket.send = function(data, ...args) { if (JSON.parse(data).type !== 'snapshot') return originalSend.call(this, data, ...args); };
  await eventually(() => statuses.includes('reconnecting'));
  assert.ok(client.stateAgeMs > 120, 'missing match updates have an observable age');
  await eventually(() => client.socket !== oldSocket && client.status === 'connected' && client.stateAgeMs < 100);
  assert.equal(client.room.code, code); assert.equal(client.token, token); assert.equal(client.matchId, matchId);
  const active = service.rooms.get(code).state; active.phase = 'playing'; active.half = 2; active.time = 60;
  await eventually(() => client.latestState.phase === 'fulltime' && client.room.phase === 'finished');
  const finalSocket = client.socket, recoveries = statuses.filter(status => status === 'reconnecting').length;
  await delay(300); assert.equal(client.socket, finalSocket); assert.equal(client.status, 'connected');
  assert.equal(statuses.filter(status => status === 'reconnecting').length, recoveries, 'full-time has no silent-state reconnect loop');
  client.rematch(); guest.send({ type: 'rematch' }); await eventually(() => client.matchId === matchId + 1);
  const secondServerSocket = service.rooms.get(code).slots[0].ws, secondSend = secondServerSocket.send;
  secondServerSocket.send = function(data, ...args) { if (JSON.parse(data).type !== 'snapshot') return secondSend.call(this, data, ...args); };
  await eventually(() => client.status === 'reconnecting');
  client.leave(); await delay(550);
  assert.equal(client.room, null); assert.equal(client.socket, null); assert.equal(client.status, 'disconnected');
  assert.equal(service.rooms.get(code).slots[0].ws, null, 'leaving cancels a scheduled stale-state reconnect');
});

test('connection deadlines reject silent handshakes; cancellation settles and prevents late reopen', { timeout: 4000 }, async t => {
  const savedLocation = globalThis.location, savedWebSocket = globalThis.WebSocket;
  class SilentSocket extends EventTarget {
    static OPEN = 1; static instances = [];
    constructor() { super(); this.readyState = 0; this.closeCalls = 0; SilentSocket.instances.push(this); }
    close() { this.closeCalls++; this.readyState = 3; }
    send() { throw new Error('Handshake is still pending'); }
  }
  globalThis.location = { href: 'http://localhost' }; globalThis.WebSocket = SilentSocket;
  const client = new NetworkClient({ connectTimeoutMs: 60 });
  t.after(() => { client.disconnect(); globalThis.location = savedLocation; globalThis.WebSocket = savedWebSocket; });
  const started = performance.now();
  await assert.rejects(client.connect('ws://localhost/ws'), /timed out/);
  assert.ok(performance.now() - started < 1000); assert.equal(client.status, 'disconnected'); assert.equal(client.connectPromise, null);
  const first = SilentSocket.instances[0]; assert.equal(first.closeCalls, 1);
  first.readyState = 1; first.dispatchEvent(new Event('open'));
  assert.equal(client.socket, null, 'a late open cannot revive an abandoned socket');
  const pending = client.connect('ws://localhost/ws'); const rejected = assert.rejects(pending, /cancelled/);
  client.disconnect(); await rejected;
  const attempts = SilentSocket.instances.length; await delay(150);
  assert.equal(client.connectPromise, null); assert.equal(client.socket, null); assert.equal(client.status, 'disconnected');
  assert.equal(SilentSocket.instances.length, attempts, 'disposal cancels every automatic retry');
});
