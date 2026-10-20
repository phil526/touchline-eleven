import {isManualRestart,restartPassAim} from './restarts.js';
import {PITCH} from './config.js';
import {clamp, length, distance, normal, angleDiff} from './math.js';
import {attackDirection} from './rules.js';
import {chooseReceiver} from './ai.js';
import {GROUND_DRAG, groundPassSpeed} from './ball.js';

export const PASS_CHARGE_SECONDS = 0.75;

// One pure intended pass for the receiver guide and authoritative release.
// Power zero preserves the existing quick pass; extra charge buys pace and range.
export function passPreview(s, p, input = {}, kind = 'pass', power = 0) {
  if(isManualRestart(s,p.team))return restartPassAim(s,p,input,kind,power);
  kind = ['pass', 'through', 'lob'].includes(kind) ? kind : 'pass';
  power = clamp(Number.isFinite(power) ? power : 0, 0, 1);
  input = {...input, mx: Number.isFinite(input.mx) ? input.mx : 0, mz: Number.isFinite(input.mz) ? input.mz : 0};
  const receiver = chooseReceiver(s, p, input, kind, power), dir = attackDirection(s, p.team);
  const origin = {x: s.ball.x, y: s.ball.y, z: s.ball.z};
  let tx = receiver?.x ?? p.x + dir * (16 + power * 24), tz = receiver?.z ?? p.z;
  if (receiver) {
    const initialDistance = length(tx - origin.x, tz - origin.z);
    const arrival = (kind === 'through' ? 6.8 : 4.6) + power * (kind === 'through' ? 7 : 5);
    const travel = Math.log(1 + initialDistance * GROUND_DRAG / arrival) / GROUND_DRAG;
    const lead = kind === 'lob' ? 0.55 : Math.min(clamp(travel * 0.65, 0.25, 1.2), s.options.humans[p.team] && kind === 'pass' ? 0.3 : 1.2);
    tx += clamp(receiver.vx * lead, -8, 8) + (kind === 'through' ? dir * (5 + power * 8) : 0);
    tz += clamp(receiver.vz * lead, -8, 8);
  } else if (length(input.mx || 0, input.mz || 0) > 0.25) {
    tx = p.x + input.mx * (18 + power * 22); tz = p.z + input.mz * (18 + power * 22);
  }
  tx = clamp(tx, -PITCH.halfLength + 1, PITCH.halfLength - 1);
  tz = clamp(tz, -PITCH.halfWidth + 1, PITCH.halfWidth - 1);
  const passDistance = length(tx - origin.x, tz - origin.z);
  const facingError = Math.abs(angleDiff(Math.atan2(tz - origin.z, tx - origin.x), p.facing)) / Math.PI;
  const pressure = s.players.filter(q => q.team !== p.team && distance(q, p) < 3).length;
  const baseSpeed = 4.7 + p.attrs.pace * 0.026;
  const sprinting = input.sprint || length(p.vx, p.vz) > baseSpeed * 1.08;
  const spread = (100 - p.attrs.passing) / 100 * (kind === 'lob' ? 1.4 : 0.65) * (1 + facingError * 2.5 + pressure * 0.65 + (sprinting ? 1.2 : 0));
  const [nx, nz] = normal(tx - origin.x, tz - origin.z);
  const speed = groundPassSpeed(passDistance, kind) + power * (kind === 'through' ? 7 : 5);
  const flightTime = kind === 'lob' ? clamp(passDistance / 14, 0.9, 2.6) : null;
  const velocity = flightTime ? {x: (tx - origin.x) / flightTime, y: 4.905 * flightTime, z: (tz - origin.z) / flightTime}
    : {x: nx * speed, y: kind === 'through' ? 0.5 : 0.15, z: nz * speed};
  return {kind, power, receiverId: receiver?.id ?? null, origin, target: {x: tx, y: PITCH.ballRadius, z: tz}, velocity,
    speed: flightTime ? length(velocity.x, velocity.z) : speed, spread, distance: passDistance, flightTime};
}

// The authority alone supplies random offsets. Preview never consumes match RNG.
export function withPassSpread(preview, offsetX, offsetZ) {
  const target = {...preview.target, x: preview.target.x + offsetX, z: preview.target.z + offsetZ};
  const dx = target.x - preview.origin.x, dz = target.z - preview.origin.z;
  const [nx, nz] = normal(dx, dz);
  const velocity = preview.flightTime ? {x: dx / preview.flightTime, y: preview.velocity.y, z: dz / preview.flightTime}
    : {x: nx * preview.speed, y: preview.velocity.y, z: nz * preview.speed};
  return {...preview, target, velocity};
}
