import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../shared/simulation.js';
import { createGoalReplay } from '../client/replay.js';

const base = createMatch({ seed: 7 });
function frame(tick, { goal = false, team = 0, score = goal ? [team === 0 ? 1 : 0, team === 1 ? 1 : 0] : [0, 0], phase = goal ? 'goal' : 'playing' } = {}) {
  const state = structuredClone(base);
  Object.assign(state, { tick, phase, time: tick / 60, score: [...score], event: { id: goal ? 20 : 19, type: goal ? 'goal' : 'kickoff', team, text: goal ? 'Goal' : 'Play' } });
  Object.assign(state.ball, { x: tick / 60, y: .5, z: 0, vx: 1, vy: 0, vz: 0, owner: null, state: 'free' });
  Object.assign(state.players[0], { x: tick / 60, z: 1, vx: 1, vz: 0 });
  return state;
}
function history(replay, to = 240) { for (let tick = 0; tick <= to; tick += 3) replay.record(frame(tick)); }
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('replay captures detached immutable history and returns isolated complete render states', () => {
  const replay = createGoalReplay(), first = frame(0), last = frame(3, { goal: true });
  const unchanged = JSON.stringify(last);
  replay.record(first); assert.equal(replay.record(freeze(last)), true);
  first.ball.x = 999; first.players[0].attrs.control = 0; first.options.tactics[0] = 'attacking';
  const sample = replay.sample();
  assert.equal(sample.players.length, 22); assert.equal(sample.ball.x, 0);
  assert.deepEqual(sample.players[0].attrs, base.players[0].attrs);
  assert.equal(sample.options.tactics[0], base.options.tactics[0]);
  sample.ball.x = -999; sample.players[0].attrs.control = -1; sample.options.tactics[0] = 'changed';
  assert.equal(replay.sample().ball.x, 0);
  assert.deepEqual(replay.sample().players[0].attrs, base.players[0].attrs);
  assert.equal(JSON.stringify(last), unchanged, 'recording and sampling cannot alter authority or its RNG');
});

test('render-frame recording is sampled at 20 Hz with a four-second bounded history', () => {
  const replay = createGoalReplay(), live = frame(0);
  for (let tick = 0; tick <= 3600; tick++) {
    live.tick = tick; live.ball.x = tick / 60;
    replay.record(live); replay.record(live);
    assert.ok(replay.frameCount <= 82);
    assert.ok(replay.historyDuration <= 4 + 1e-8);
  }
  assert.equal(replay.frameCount, 81); assert.equal(replay.historyDuration, 4);
  assert.equal(replay.active, false); assert.equal(replay.sample(), null);
});

test('an observed goal starts once, rewinds the last three seconds and completes within 2.6 seconds', () => {
  const replay = createGoalReplay(); history(replay, 297);
  const goal = frame(300, { goal: true, team: 1 });
  assert.equal(replay.record(goal), true); assert.equal(replay.active, true); assert.equal(replay.scoringTeam, 1);
  assert.equal(replay.progress, 0); assert.equal(replay.sample().ball.x, 2);
  replay.update(1.24); assert.ok(Math.abs(replay.sample().ball.x - 3.5) < 1e-8);
  assert.equal(replay.record(goal), false); assert.ok(replay.progress > .4, 'duplicate events cannot restart playback');
  replay.update(1.31); const finish = replay.sample();
  assert.equal(finish.phase, 'goal'); assert.deepEqual(finish.score, [0, 1]); assert.equal(finish.ball.x, 5);
  replay.update(.05); assert.equal(replay.active, false); assert.equal(replay.progress, 1); assert.equal(replay.sample(), null);
  assert.equal(replay.record(goal), false, 'completed goals cannot automatically repeat');
});

test('shot interpolation crosses ownership and goal-phase changes without jumping the ball', () => {
  const replay = createGoalReplay();
  const before = frame(0), goal = frame(3, { goal: true });
  before.ball.x = 51; before.ball.owner = 9; before.ball.state = 'owned';
  goal.ball.x = 53; goal.ball.y = 1.5;
  before.players[0].facing = Math.PI - .1; goal.players[0].facing = -Math.PI + .1;
  replay.record(before); replay.record(goal); replay.update(.0225);
  const sample = replay.sample();
  assert.ok(Math.abs(sample.ball.x - 52) < 1e-8); assert.ok(Math.abs(sample.ball.y - 1) < 1e-8);
  assert.ok(Math.abs(sample.players[0].facing - Math.PI) < 1e-8, 'facing blends through the shortest turn');
  assert.equal(sample.ball.owner, 9, 'ownership remains discrete while positions interpolate');
});

test('skip and live phase exit end playback without rewinding or pausing authority', () => {
  const replay = createGoalReplay(); history(replay, 60);
  const goal = frame(63, { goal: true }); replay.record(goal); replay.skip();
  assert.equal(replay.active, false); assert.equal(replay.sample(), null); assert.equal(replay.record(goal), false);
  replay.record(frame(66, { score: [1, 0] }));
  replay.record(frame(69, { goal: true, score: [2, 0] })); assert.equal(replay.active, true);
  const live = frame(72, { phase: 'kickoff', score: [2, 0] }), prior = JSON.stringify(live);
  replay.record(live); assert.equal(replay.active, false); assert.equal(replay.sample(), null); assert.equal(JSON.stringify(live), prior);
  assert.equal(replay.record(frame(75, { phase: 'playing', score: [3, 0] })), false, 'a goal first observed after the break never hides playable time');
});

test('initial goals, duplicate ticks and goal text alone do not manufacture replay history', () => {
  const replay = createGoalReplay();
  assert.equal(replay.record(frame(100, { goal: true })), false, 'joining a scored match establishes a baseline');
  replay.reset(); replay.record(frame(0));
  assert.equal(replay.record(frame(0, { goal: true })), false); assert.equal(replay.frameCount, 1);
  const eventOnly = frame(3, { goal: true }); eventOnly.event.id++;
  assert.equal(replay.record(eventOnly), false); assert.equal(replay.active, false);
  eventOnly.tick = 6; eventOnly.event.id++; assert.equal(replay.record(eventOnly), false);
});

test('rematch tick reset, score reset and explicit reset discard clips and previous goal dedupe state', () => {
  const replay = createGoalReplay(); history(replay, 60); replay.record(frame(63, { goal: true }));
  assert.equal(replay.active, true); replay.record(frame(0));
  assert.equal(replay.active, false); assert.equal(replay.scoringTeam, null); assert.equal(replay.frameCount, 1);
  assert.equal(replay.record(frame(3, { goal: true })), true);
  replay.record(frame(6)); assert.equal(replay.active, false); assert.equal(replay.frameCount, 1, 'a decreased score also identifies a new baseline');
  replay.reset(); assert.equal(replay.frameCount, 0); assert.equal(replay.historyDuration, 0); assert.equal(replay.progress, 0);
  assert.equal(replay.sample(), null); assert.equal(replay.scoringTeam, null);
  replay.record(frame(0)); assert.equal(replay.record(frame(3, { goal: true })), true);
});

test('invalid time updates and malformed records cannot corrupt replay state or extend playback', () => {
  const replay = createGoalReplay({ historySeconds: Infinity, replaySeconds: 99, playbackSeconds: 99, sampleRate: 999 });
  history(replay); replay.record(frame(243, { goal: true }));
  for (const dt of [NaN, Infinity, -1, 0]) replay.update(dt);
  assert.equal(replay.progress, 0); assert.equal(replay.active, true);
  for (const state of [null, {}, { tick: NaN }, { ...frame(246), score: [NaN, 0] }]) assert.equal(replay.record(state), false);
  replay.update(2.6); assert.equal(replay.active, false); assert.equal(replay.progress, 1);
});
