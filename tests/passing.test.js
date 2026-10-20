import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch, stepMatch, neutralInput} from '../shared/simulation.js';
import {passPreview, withPassSpread, PASS_CHARGE_SECONDS} from '../shared/passing.js';
import {groundPassSpeed, integrateBall} from '../shared/ball.js';

const DT = 1 / 60;
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} should equal ${b}`);
function fixture(half = 1) {
  const s = createMatch({humans: [true, true], seed: 8}); s.phase = 'playing'; s.half = half;
  const dir = half === 1 ? 1 : -1;
  for (const q of s.players) Object.assign(q, {x: -35 + q.slot * 2, z: q.team === 0 ? -27 : 27, cooldown: 100, vx: 0, vz: 0});
  const p = s.players[1]; Object.assign(p, {x: 0, z: 0, facing: dir > 0 ? 0 : Math.PI, cooldown: 0}); p.attrs.passing = 100;
  const receiver = s.players[8]; Object.assign(receiver, {x: dir * 15, z: 0, vx: 0, vz: 0});
  s.selected[0] = p.id;
  Object.assign(s.ball, {x: dir * 0.6, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0, owner: p.id, lastTouch: p.id, state: 'controlled'});
  return {s, p, receiver, dir};
}
function tick(s, input = {}, count = 1) {for (let i = 0; i < count; i++) stepMatch(s, [{...neutralInput(), ...input}, neutralInput()], DT);}
function takeBall(s, p) {
  s.selected[0] = p.id; s.pendingSwitch[0] = null; s.offside = null;
  Object.assign(p, {cooldown: 0, actionTime: 0, vx: 0, vz: 0});
  Object.assign(s.ball, {owner: p.id, lastTouch: p.id, state: 'controlled', x: p.x + Math.cos(p.facing) * 0.6, z: p.z, y: 0.11, vx: 0, vy: 0, vz: 0});
}

test('shared pass preview is pure and preserves useful quick-pass arrival weighting', () => {
  for (const half of [1, 2]) for (const kind of ['pass', 'through']) {
    const {s, p, receiver, dir} = fixture(half), before = JSON.stringify(s);
    const preview = passPreview(s, p, {mx: dir, mz: 0}, kind, 0);
    assert.equal(JSON.stringify(s), before); assert.equal(preview.receiverId, receiver.id);
    close(preview.speed, groundPassSpeed(preview.distance, kind));
    close(preview.target.x, receiver.x + (kind === 'through' ? dir * 5 : 0));
    assert.ok(Object.values(preview.velocity).every(Number.isFinite));
    const rolling = {...preview.origin, vx: preview.velocity.x, vy: 0, vz: preview.velocity.z};
    for (let i = 0; i < 300 && (preview.target.x - rolling.x) * dir > 0; i++) integrateBall(rolling, DT);
    assert.ok((rolling.x - preview.target.x) * dir >= 0, 'A quick pass still reaches its intended point');
    assert.ok(Math.hypot(rolling.vx, rolling.vz) > 3.5, 'Useful arrival pace remains');
  }
});

test('power adds pace, extends through-ball lead and chooses a farther aligned receiver', () => {
  const {s, p, receiver} = fixture(); receiver.x = 14;
  Object.assign(s.players[9], {x: 38, z: 0, vx: 0, vz: 0});
  const short = passPreview(s, p, {mx: 1}, 'pass', 0), long = passPreview(s, p, {mx: 1}, 'pass', 1);
  assert.equal(short.receiverId, 8); assert.equal(long.receiverId, 9);
  assert.ok(long.distance > short.distance + 20); assert.ok(long.speed > short.speed + 15);
  s.players[9].x = -35;
  const through = passPreview(s, p, {mx: 1}, 'through', 0), driven = passPreview(s, p, {mx: 1}, 'through', 1);
  assert.equal(through.receiverId, driven.receiverId); close(driven.target.x - through.target.x, 8);
  assert.ok(driven.speed > through.speed + 10);
});

test('unassisted pass range responds to power and remains finite for partial axes', () => {
  const {s, p} = fixture();
  for (const q of s.players) if (q.team === 0 && q.id !== p.id) {q.x = -30; q.z = -20;}
  const short = passPreview(s, p, {mx: 1}, 'pass', 0), long = passPreview(s, p, {mx: 1}, 'pass', 1);
  assert.equal(short.receiverId, null); assert.equal(long.receiverId, null);
  close(short.target.x, 18); close(long.target.x, 40);
  const lateral = passPreview(s, p, {mz: 1}, 'through', 0.5);
  assert.ok(Object.values(lateral.target).every(Number.isFinite)); assert.ok(lateral.target.z > 20);
});

test('holding charges pass and through ball; release plus fallback pulse produces exactly one matching kick', () => {
  for (const kind of ['pass', 'through']) for (const half of [1, 2]) {
    const {s, p, dir} = fixture(half), button = kind === 'pass' ? 'passHold' : 'throughHold';
    tick(s, {[button]: true}, 18);
    close(p.passCharge, 18 * DT / PASS_CHARGE_SECONDS); assert.equal(p.passType, kind); assert.equal(s.stats.passes[0], 0);
    const release = {...neutralInput(), [kind]: true, mx: dir};
    const preview = passPreview(s, p, release, kind, p.passCharge);
    const expected = {...preview.origin, vx: preview.velocity.x, vy: preview.velocity.y, vz: preview.velocity.z}; integrateBall(expected, DT);
    tick(s, release);
    assert.equal(s.stats.passes[0], 1); assert.equal(s.event.type, kind); assert.equal(s.receiver[0], preview.receiverId);
    close(s.ball.vx, expected.vx); close(s.ball.vz, expected.vz); close(s.ball.vy, expected.vy);
    assert.equal(p.passCharge, 0); assert.equal(p.passType, null);
    tick(s); assert.equal(s.stats.passes[0], 1);
  }
});

test('short taps retain immediate pulse passing and held input takes priority over a press pulse', () => {
  for (const kind of ['pass', 'through']) {
    const {s, p} = fixture(); tick(s, {[kind]: true});
    assert.equal(s.stats.passes[0], 1); assert.equal(p.passCharge, 0);
    const other = fixture(); tick(other.s, {[kind]: true, [kind === 'pass' ? 'passHold' : 'throughHold']: true});
    assert.equal(other.s.stats.passes[0], 0); assert.ok(other.p.passCharge > 0);
  }
});

test('charge cap releases once and team latch survives receiver switching until button-up', () => {
  for (const kind of ['pass', 'through']) {
    const {s, p, receiver} = fixture(), button = kind === 'pass' ? 'passHold' : 'throughHold';
    tick(s, {[button]: true}, 45);
    assert.equal(s.stats.passes[0], 1); assert.equal(p.passCharge, 0); assert.equal(s.passHoldLatch[0], true);
    takeBall(s, receiver); tick(s, {[button]: true}, 12);
    assert.equal(s.stats.passes[0], 1); assert.equal(receiver.passCharge, 0); assert.equal(receiver.passLatch, true);
    tick(s, {[kind]: true});
    assert.equal(s.stats.passes[0], 1, 'Cap-release fallback pulse must not cause another pass'); assert.equal(s.passHoldLatch[0], false);
    tick(s, {[button]: true}, 3); assert.ok(receiver.passCharge > 0);
    tick(s, {[kind]: true}); assert.equal(s.stats.passes[0], 2);
  }
});

test('loss of possession or manual selection cancels charge and cannot queue a stale release', () => {
  for (const reason of ['possession', 'selection']) {
    const {s, p, receiver} = fixture(); tick(s, {passHold: true}, 10); p.aiTime = 100;
    if (reason === 'possession') s.ball.owner = null;
    else s.selected[0] = receiver.id;
    tick(s, {passHold: true});
    assert.equal(p.passCharge, 0); assert.equal(p.passType, null); assert.equal(s.passHoldLatch[0], true);
    takeBall(s, receiver); tick(s, {pass: true});
    assert.equal(s.stats.passes[0], 0); assert.equal(s.passHoldLatch[0], false);
  }
});

test('changing held pass type starts a fresh charge, and both holds keep the active type', () => {
  const {s, p} = fixture(); tick(s, {passHold: true}, 12);
  tick(s, {throughHold: true}); assert.equal(p.passType, 'through'); close(p.passCharge, DT / PASS_CHARGE_SECONDS);
  tick(s, {passHold: true, throughHold: true}); assert.equal(p.passType, 'through'); close(p.passCharge, 2 * DT / PASS_CHARGE_SECONDS);
  assert.equal(s.stats.passes[0], 0);
});

test('dead phases clear charged intent and spread changes no preview state or power', () => {
  const {s, p} = fixture(); tick(s, {passHold: true}, 6);
  const preview = passPreview(s, p, {mx: 1}, 'pass', p.passCharge), before = JSON.stringify(preview);
  const spread = withPassSpread(preview, 0.1, -0.2);
  assert.equal(JSON.stringify(preview), before); close(spread.target.x, preview.target.x + 0.1); close(spread.speed, preview.speed);
  s.phase = 'halftime'; tick(s, {pass: true}); assert.equal(p.passCharge, 0); assert.equal(p.passType, null); assert.equal(s.stats.passes[0], 0);
  assert.equal(neutralInput().passHold, false); assert.equal(neutralInput().throughHold, false);
});
