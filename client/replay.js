const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, t) => a + (b - a) * t;
const clone = value => structuredClone(value);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function blendNumbers(target, a, b, keys, t) {
  for (const key of keys) if (Number.isFinite(a[key]) && Number.isFinite(b[key])) target[key] = mix(a[key], b[key], t);
}

function interpolate(before, after, t) {
  // Every returned view is detached, including nested roster/options/event data.
  // Discrete ownership, poses and phase remain those of the preceding sample.
  const state = clone(t >= 1 ? after : before);
  if (t >= 1) return state;
  const players = new Map(after.players.map(player => [player.id, player]));
  for (const player of state.players) {
    const a = before.players.find(candidate => candidate.id === player.id), b = players.get(player.id);
    if (!a || !b || Math.hypot(a.x - b.x, a.z - b.z) > 8) continue;
    blendNumbers(player, a, b, ['x', 'z', 'vx', 'vz', 'actionTime', 'touchTime', 'receiveTime', 'charge'], t);
    if (Number.isFinite(a.facing) && Number.isFinite(b.facing)) {
      const turn = Math.atan2(Math.sin(b.facing - a.facing), Math.cos(b.facing - a.facing));
      player.facing = a.facing + turn * t;
    }
  }
  // Ownership/goal transitions do not stop interpolation of a shot crossing the line.
  // Large discontinuities (restart placement) are kept discrete.
  if (Math.hypot(before.ball.x - after.ball.x, before.ball.z - after.ball.z) <= 12) {
    blendNumbers(state.ball, before.ball, after.ball, ['x', 'y', 'z', 'vx', 'vy', 'vz', 'spin'], t);
  }
  blendNumbers(state, before, after, ['time', 'phaseTime'], t);
  return state;
}

/** A visual-only goal replay. Record the live state even while playback is active. */
export function createGoalReplay({ historySeconds = 4, replaySeconds = 3, playbackSeconds = 2.6, sampleRate = 20 } = {}) {
  // Public tuning remains bounded so accidental settings cannot retain a whole match.
  historySeconds = clamp(Number.isFinite(historySeconds) ? historySeconds : 4, 1, 4);
  replaySeconds = clamp(Number.isFinite(replaySeconds) ? replaySeconds : 3, .05, Math.min(3, historySeconds));
  playbackSeconds = clamp(Number.isFinite(playbackSeconds) ? playbackSeconds : 2.6, .05, 2.6);
  sampleRate = clamp(Number.isFinite(sampleRate) ? sampleRate : 20, 1, 20);
  const interval = 1 / sampleRate, maxFrames = Math.ceil(historySeconds * sampleRate) + 2;
  let frames = [], lastTick = null, lastScore = null, clip = null, elapsed = 0, duration = 0, active = false, scoringTeam = null;

  function reset() {
    frames = []; lastTick = null; lastScore = null; clip = null;
    elapsed = duration = 0; active = false; scoringTeam = null;
  }
  function skip() { active = false; clip = null; elapsed = duration; }

  function record(state) {
    if (!state || !Number.isFinite(state.tick) || state.tick < 0 || !Array.isArray(state.score) || state.score.length !== 2 || state.score.some(value => !Number.isFinite(value) || value < 0) || !Array.isArray(state.players) || !state.ball) return false;
    // A rematch/loaded match starts a new baseline, never a replay of an old score.
    if (lastTick !== null && (state.tick < lastTick || state.score.some((value, team) => value < lastScore[team]))) reset();
    if (active && state.phase !== 'goal') skip();
    const increased = lastScore === null ? [] : state.score.map((value, team) => value > lastScore[team] ? team : null).filter(team => team !== null);
    const goal = state.phase === 'goal' && increased.length > 0;
    const team = goal && increased.includes(state.event?.team) ? state.event.team : increased[0];
    lastTick = state.tick; lastScore = [...state.score];
    const at = state.tick / 60;
    const latest = frames.at(-1);
    if (!latest || goal || at - latest.at >= interval - 1e-8) {
      const frame = Object.freeze({ at, state: freeze(clone(state)) });
      if (latest?.at === at) frames[frames.length - 1] = frame;
      else frames.push(frame);
    }
    while (frames.length && (frames.length > maxFrames || at - frames[0].at > historySeconds + 1e-8)) frames.shift();
    if (!goal || frames.length < 2) return false;
    const end = frames.at(-1).at, start = Math.max(frames[0].at, end - replaySeconds);
    if (end <= start) return false;
    let first = frames.findIndex(frame => frame.at >= start);
    if (first > 0 && frames[first].at > start) first--;
    clip = Object.freeze({ start, end, frames: Object.freeze(frames.slice(Math.max(0, first))) });
    duration = Math.min(playbackSeconds, end - start); elapsed = 0;
    scoringTeam = team; active = true;
    return true;
  }

  function update(dt) {
    if (!active || !Number.isFinite(dt) || dt <= 0) return active;
    elapsed = Math.min(duration, elapsed + dt);
    if (elapsed >= duration - 1e-9) { elapsed = duration; active = false; clip = null; }
    return active;
  }

  function sample() {
    if (!active || !clip) return null;
    // Briefly retain the actual goal endpoint without extending the live goal break.
    const travelDuration = duration - Math.min(.12, duration * .1);
    const at = mix(clip.start, clip.end, travelDuration > 0 ? Math.min(1, elapsed / travelDuration) : 1);
    let before = clip.frames[0], after = clip.frames.at(-1);
    for (let i = 1; i < clip.frames.length; i++) {
      if (clip.frames[i].at >= at) { before = clip.frames[i - 1]; after = clip.frames[i]; break; }
    }
    const t = clamp((at - before.at) / Math.max(1e-8, after.at - before.at), 0, 1);
    return interpolate(before.state, after.state, t);
  }

  return { record, update, sample, skip, reset,
    get active() { return active; },
    get progress() { return duration > 0 ? clamp(elapsed / duration, 0, 1) : 0; },
    get scoringTeam() { return scoringTeam; },
    get frameCount() { return frames.length; },
    get historyDuration() { return frames.length > 1 ? frames.at(-1).at - frames[0].at : 0; }
  };
}
