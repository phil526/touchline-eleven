import {aerialLift} from '../shared/aerial.js';
import {keeperDiveCue} from './keeper-animation.js';
import * as THREE from 'three';

// Articulated procedural figures, in metres. The renderer batches these transforms.
// The model faces local +z; the simulation facing angle is atan2(vz, vx).
const skinTones = [0x986348, 0xd5a17e, 0x734b36, 0xb47e59, 0xe0b496, 0x553a2b];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (a, b, dt, rate = 13) => a + (b - a) * (1 - Math.exp(-rate * dt));
const smooth = (a, b, value) => {const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t);};
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const TAU = Math.PI * 2, THIGH = 0.4, SHIN = 0.405, FOOT_Y = 0.05;
const downAxis = new THREE.Vector3(0, -1, 0);

export function createFootballer(index, team, goalkeeper = false) {
  const root = new THREE.Group();
  const parts = [];
  const jersey = goalkeeper ? (team === 0 ? 0x52d1b7 : 0xbe9be4) : (team === 0 ? 0x25446e : 0xf2aa31);
  const shorts = goalkeeper ? (team === 0 ? 0x244f50 : 0x493c63) : (team === 0 ? 0xe5e8de : 0x263039);
  const socks = goalkeeper ? jersey : (team === 0 ? 0x25446e : 0xf0ac3a);
  const skin = skinTones[(index * 7 + team * 2) % skinTones.length];
  const trim = team === 0 ? 0xf3ead6 : 0x263039;

  function joint(parent, x, y, z) {
    const node = new THREE.Group(); node.position.set(x, y, z); parent.add(node); return node;
  }
  function part(parent, shape, colour, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, detail = false) {
    const node = joint(parent, x, y, z); node.scale.set(sx, sy, sz);
    parts.push({node, shape, colour, detail}); return node;
  }
  const pelvis = joint(root, 0, 0.94, 0);
  part(pelvis, 'shorts', shorts);
  const torso = joint(pelvis, 0, 0.08, 0);
  // A broad chest narrows into the waist; the shoulder and collar have their
  // own contours instead of a cylinder topped with a floating sphere.
  part(torso, 'jersey', jersey);
  part(torso, 'round', skin, 0, .476, 0, .052, .083, .052);
  part(torso, 'collar', trim);
  const head = joint(torso, 0, 0.625, 0.005);
  head.scale.set(.96,.94,.96);
  const faceWidth = .97 + (index % 4) * .025;
  part(head, 'head', skin, 0, 0, 0, faceWidth, 1, 1);
  const hair = [0x211b18, 0x463026, 0x171717, 0x796348, 0x30211b][index % 5];
  part(head, ['crop','sweep','curls'][index % 3], hair, 0, 0, 0, faceWidth, 1, 1);
  // Small features are omitted at broadcast distance, while the facial map
  // and sculpted jaw remain. Nothing here affects collisions or ball contact.
  part(head, 'round', skin, 0, -.013, .096, .012, .023, .017, true);
  for (const side of [-1,1]) part(head, 'round', skin, side*.095*faceWidth, -.013, -.001, .018, .032, .019, true);
  for(const side of [-1,1]){
    part(head,'round',0xbbb4a7,side*.039,.023,.09,.014,.0045,.004,true);
    part(head,'round',0x302920,side*.039,.023,.094,.0035,.004,.002,true);
    part(head,'round',hair,side*.039,.043,.092,.015,.0025,.003,true).rotation.z=side*.08;
  }
  part(head,'round',0x725044,0,-.068,.083,.018,.0018,.002,true);
  if (!goalkeeper) part(torso, team === 0 ? 'shirtStripe' : 'shirtBand', trim);
  part(torso, 'round', trim, -.106, .346, .108, .016, .022, .003, true);
  const arms = [], legs = [];
  for (const side of [-1, 1]) {
    const arm = joint(torso, side * 0.2, 0.365, 0);
    arm.rotation.z = side * 0.12;
    part(arm, 'sleeve', jersey);
    part(arm, 'upperArm', skin);
    const elbow = joint(arm, 0, -0.285, 0);
    part(elbow, 'round', skin, 0, 0, 0, .04, .04, .041);
    part(elbow, 'forearm', skin);
    const handColour = goalkeeper ? 0xe6ece5 : skin;
    const hand = part(elbow, 'hand', handColour, 0, -.252, .004, goalkeeper?1.32:1, goalkeeper?1.14:1, goalkeeper?1.4:1);
    part(hand, 'round', handColour, -side*.034, .004, .014, .012, .028, .016, true).rotation.z = -side*.45;
    if (goalkeeper) part(elbow, 'round', shorts, 0, -.219, .005, .035, .022, .029);
    arms.push({upper: arm, lower: elbow, hand});
    const leg = joint(pelvis, side * 0.104, -0.09, 0);
    part(leg, 'thigh', skin);
    const knee = joint(leg, 0, -0.4, 0);
    part(knee, 'round', skin, 0, -.016, .001, .053, .062, .056);
    part(knee, 'sock', socks);
    part(knee, 'sockBand', trim);
    const ankle = joint(knee, 0, -SHIN, 0);
    const boot = part(ankle, 'boot', [0xd5d9c6,0x22343d,0x713d32][index%3]);
    for (const z of [.045,.064,.083]) part(ankle, 'round', 0xbfc6bf, 0, .047-(z-.045)*.25, z, .03, .0025, .003, true);
    legs.push({upper: leg, lower: knee, foot: ankle, boot, anchor: null, stance: false, target: new THREE.Vector3(), footPitch: 0});
  }
  const numberFront = joint(torso, 0.035, 0.19, 0.125); numberFront.scale.setScalar(.67);
  const numberBack = joint(torso, 0, 0.255, -0.133); numberBack.rotation.y = Math.PI;
  return {root, parts, pelvis, torso, head, arms, legs, goalkeeper, heldBallAnchor:new THREE.Vector3(), diveBlend:0, gloveTargets:null, numbers: [numberFront, numberBack], cycle: (index * 1.72) % TAU,
    gaitDistance: 0, speed: 0, yaw: 0, started: false, actionBlend: 0, turnLean: 0, forwardLean: 0,
    lastPosition: null, lastTouchTick: null, touchAge: 1, lastActionTime: 0, lastAnim: '', saveDirection: {x: 0, height: 1},
    ik: {inverse: new THREE.Matrix4(), target: new THREE.Vector3(), direction: new THREE.Vector3(), pole: new THREE.Vector3(),
      knee: new THREE.Vector3(), shin: new THREE.Vector3(), upperQ: new THREE.Quaternion(), shinQ: new THREE.Quaternion(), footQ: new THREE.Quaternion()}};
}

function reachGlove(rig,arm,target) {
  const ik=rig.ik;ik.inverse.copy(rig.torso.matrixWorld).invert();
  ik.target.copy(target).applyMatrix4(ik.inverse).sub(arm.upper.position);
  const distance=clamp(ik.target.length(),.06,.285+.252-.001);
  ik.direction.copy(ik.target).normalize();ik.target.copy(ik.direction).multiplyScalar(distance);
  ik.pole.set(0,0,-1).addScaledVector(ik.direction,ik.direction.z).normalize();
  if(ik.pole.lengthSq()<.5)ik.pole.set(1,0,0);
  const along=(.285**2-.252**2+distance**2)/(2*distance),bend=Math.sqrt(Math.max(0,.285**2-along**2));
  ik.knee.copy(ik.direction).multiplyScalar(along).addScaledVector(ik.pole,bend);
  ik.shin.copy(ik.target).sub(ik.knee).normalize();
  ik.upperQ.setFromUnitVectors(downAxis,ik.knee.normalize());ik.shinQ.setFromUnitVectors(downAxis,ik.shin);
  arm.upper.quaternion.copy(ik.upperQ);arm.lower.quaternion.copy(ik.upperQ).invert().multiply(ik.shinQ);
}

// Two-bone pose solve to a cosmetic ankle target. Stance anchors are in world space.
// This is a cheap visual correction, not a physical contact or terrain-IK system.
function solveLeg(rig, leg) {
  const ik = rig.ik;
  ik.target.copy(leg.target).applyMatrix4(ik.inverse).sub(leg.upper.position);
  const distance = clamp(ik.target.length(), 0.08, THIGH + SHIN - 0.001);
  ik.direction.copy(ik.target).normalize();
  if (ik.direction.lengthSq() < 0.5) ik.direction.copy(downAxis);
  ik.target.copy(ik.direction).multiplyScalar(distance);
  ik.pole.set(0, 0, 1).addScaledVector(ik.direction, -ik.direction.z).normalize();
  if (ik.pole.lengthSq() < 0.5) ik.pole.set(1, 0, 0);
  const along = (THIGH * THIGH - SHIN * SHIN + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
  ik.knee.copy(ik.direction).multiplyScalar(along).addScaledVector(ik.pole, bend);
  ik.shin.copy(ik.target).sub(ik.knee).normalize();
  ik.upperQ.setFromUnitVectors(downAxis, ik.knee.normalize());
  ik.shinQ.setFromUnitVectors(downAxis, ik.shin);
  leg.upper.quaternion.copy(ik.upperQ);
  leg.lower.quaternion.copy(ik.upperQ).invert().multiply(ik.shinQ);
  // Counter-rotate the boot, keeping planted soles approximately parallel to turf.
  ik.footQ.copy(rig.pelvis.quaternion).invert();
  leg.foot.quaternion.copy(ik.shinQ).invert().multiply(ik.footQ);
  if (leg.footPitch) leg.foot.rotateX(leg.footPitch);
}

export function animateFootballer(rig, player, dt, now, state) {
  dt = clamp(finite(dt, 1 / 60) || 1 / 60, 0.001, 0.08); now = finite(now);
  const x = finite(player.x), z = finite(player.z);
  const dx = rig.lastPosition ? x - rig.lastPosition.x : 0, dz = rig.lastPosition ? z - rig.lastPosition.z : 0;
  let distance = Math.hypot(dx, dz);
  const velocitySpeed = Math.hypot(finite(player.vx), finite(player.vz));
  // Restarts, reconciliation and player teleports must not trigger a rapid gait burst.
  const teleport = distance > Math.max(2, velocitySpeed * dt * 4 + 0.4);
  if (teleport) {distance = 0; for (const leg of rig.legs) {leg.anchor = null; leg.stance = false;}}
  rig.lastPosition = {x, z}; rig.gaitDistance += distance;
  const oldSpeed = rig.speed;
  rig.speed = damp(rig.speed, clamp(distance / dt, 0, 10), dt, 14);
  const move = clamp(rig.speed / 6.5, 0, 1), moving = clamp(rig.speed / 1.2, 0, 1);
  const strideLength = 1.25 + clamp(rig.speed, 0, 8) * 0.38;
  // No elapsed-time term: idle figures never walk in place or accumulate leg phase.
  rig.cycle = (rig.cycle + distance / strideLength * TAU) % TAU;
  const contactRatio = clamp((0.62 + move * 0.2) / strideLength, 0.18, 0.6);
  const reach = strideLength * contactRatio / 2;
  let facing = Number.isFinite(player.facing) ? player.facing : player.team === 0 ? 0 : Math.PI;
  const cue=rig.goalkeeper?keeperDiveCue(state,player):null;
  const saving=/save|dive|catch/.test(player.anim||'')&&finite(player.actionTime)>0;
  const holding=rig.goalkeeper&&state?.ball?.owner===player.id&&state.ball.state==='held';
  rig.gloveTargets=null;rig.diveLegs=0;
  if(!saving&&!cue)rig.diveBlend=damp(rig.diveBlend,0,dt,14);
  // Facing metadata can lead or lag real travel during steering/reconciliation.
  // Free-running bodies follow their measured motion; kicks, aim and jockeying
  // retain the authoritative facing. This changes only the cosmetic rig.
  if (distance > 0.0001 && velocitySpeed > 0.65 && rig.speed > 0.65 && finite(player.actionTime) <= 0 && finite(player.charge) <= 0 && !['jockey', 'close'].includes(player.controlMode)) facing = Math.atan2(dz, dx);
  if(cue)facing=cue.facing;
  else if((saving||holding)&&Number.isFinite(player.saveFacing))facing=player.saveFacing;
  const desired = Math.PI / 2 - facing;
  if (!rig.started) {rig.yaw = desired; rig.started = true;}
  const difference = Math.atan2(Math.sin(desired - rig.yaw), Math.cos(desired - rig.yaw));
  const turn = difference * (1 - Math.exp(-dt * 14)); rig.yaw += turn;
  rig.turnLean = damp(rig.turnLean, clamp(-turn / dt * move * 0.035, -0.18, 0.18), dt, 8);
  rig.forwardLean = damp(rig.forwardLean, move * 0.12 + clamp((rig.speed - oldSpeed) / dt * 0.006, -0.055, 0.065), dt, 9);
  rig.root.position.set(x, 0.015, z);
  rig.root.rotation.set(0, rig.yaw, 0);
  const runHeight = Math.sqrt(Math.max(0.3, 0.797 ** 2 - reach ** 2)) + 0.125;
  rig.pelvis.position.set(0, 0.928 + (runHeight - 0.928) * moving + Math.sin(rig.cycle) ** 2 * 0.012 * move, 0);
  rig.pelvis.rotation.set(rig.forwardLean * 0.18, 0, rig.turnLean * 0.25);
  rig.torso.rotation.set(rig.forwardLean, Math.sin(rig.cycle) * move * 0.045, rig.turnLean * 0.75);
  rig.head.rotation.set(-rig.forwardLean * 0.35, -rig.torso.rotation.y * 0.3, -rig.turnLean * 0.3);
  const breathing = Math.sin(now * 2.5 + finite(player.id)) * 0.018;
  const cos = Math.cos(rig.yaw), sin = Math.sin(rig.yaw);
  function localFoot(leg, lx, lz, height, weight = 1) {
    leg.target.x += (x + cos * lx + sin * lz - leg.target.x) * weight;
    leg.target.z += (z - sin * lx + cos * lz - leg.target.z) * weight;
    leg.target.y += (height - leg.target.y) * weight;
    // A ball-contact target also blends the running toe-down pose back to flat.
    leg.footPitch *= 1 - weight;
  }
  for (let i = 0; i < 2; i++) {
    const sign = i === 0 ? -1 : 1, leg = rig.legs[i], phase = (rig.cycle / TAU + i * 0.5) % 1;
    const stance = phase < contactRatio && moving > 0.08;
    let forward = reach * (1 - 2 * phase / contactRatio);
    leg.footPitch = 0;
    if (stance) {
      if (!leg.stance || !leg.anchor) {
        localFoot(leg, sign * 0.104, forward, FOOT_Y);
        leg.anchor = leg.target.clone();
      }
      leg.target.copy(leg.anchor);
    } else {
      const swing = clamp((phase - contactRatio) / (1 - contactRatio), 0, 1);
      const lift = 0.12 + move * 0.27;
      let height;
      // Recover the heel behind the hip before driving the knee forward, then
      // extend the lower leg to land. A single shallow sine arc looked like
      // shuffling because the boot never folded up behind the runner.
      if (swing < 0.28) {
        const recover = smooth(0, 0.28, swing);
        forward = -reach - Math.sin(recover * Math.PI) * 0.04 * move;
        height = lift * recover;
      } else if (swing < 0.68) {
        const drive = smooth(0.28, 0.68, swing);
        forward = -reach + reach * 1.65 * drive;
        height = lift * (1 - 0.4 * drive);
      } else {
        const extend = smooth(0.68, 1, swing);
        forward = reach * (0.65 + 0.35 * extend);
        height = lift * 0.6 * (1 - extend);
      }
      localFoot(leg, sign * 0.104, forward, FOOT_Y + height);
      leg.footPitch = 0.42 * move * smooth(0.07, 0.2, height) * (1 - smooth(0.55, 0.95, swing));
      leg.anchor = null;
    }
    leg.stance = stance;
    if (moving < 1) localFoot(leg, sign * 0.104, 0, FOOT_Y, 1 - moving);
    rig.arms[i].upper.rotation.set(clamp(forward / reach, -1, 1) * move * 0.63 + breathing, 0, sign * (0.11 + move * 0.035));
    rig.arms[i].lower.rotation.set(-0.16 - move * 0.68, 0, 0);
  }
  const anim = String(player.anim || '').toLowerCase();
  const actionTime = Math.max(0, finite(player.actionTime));
  const duration = Math.max(0.05, finite(player.actionDuration, /slide/.test(anim) ? 0.85 : /save|dive|catch/.test(anim) ? 0.7 : /tackle/.test(anim) ? 0.55 : 0.32));
  const progress = clamp(1 - actionTime / duration, 0, 1);
  const preparingThrow=state?.phase==='restart'&&state.restart?.type==='throwIn'&&state.restart.taker===player.id;
  const actionStarted = actionTime > 0 && (rig.lastAnim !== anim || actionTime > rig.lastActionTime + 0.02);
  rig.actionBlend = damp(rig.actionBlend, actionTime > 0 ? 1 - smooth(0.66, 1, progress) : 0, dt, 35);
  const a = rig.actionBlend;
  const footIndex = player.touchFoot === 0 ? 0 : 1, side = footIndex === 0 ? -1 : 1;
  const bx = finite(state?.ball?.x, x), bz = finite(state?.ball?.z, z);
  const ballSide = cos * (bx - x) - sin * (bz - z), ballForward = sin * (bx - x) + cos * (bz - z);
  if (Number.isFinite(player.touchTick) && player.touchTick !== rig.lastTouchTick) {rig.lastTouchTick = player.touchTick; rig.touchAge = 0;}
  else rig.touchAge += dt;
  if(player.skill){
    const m=player.skill,t=m.age/m.duration,w=Math.sin(t*Math.PI),foot=m.side>0?0:1;
    rig.torso.rotation.z+=m.side*(m.kind==='bodyFeint'?Math.sin(t*Math.PI*2)*.28:w*.13);
    rig.torso.rotation.y+=m.side*w*.18;rig.pelvis.position.y-=w*.04;
    localFoot(rig.legs[foot],m.side*(m.kind==='ballRoll'?.32:.14),m.kind==='fakeShot'?-.23+w*.4:.35,FOOT_Y+(m.kind==='fakeShot'?.22:.08)*w);
    rig.legs[foot].anchor=null;rig.arms[0].upper.rotation.z-=w*.3;rig.arms[1].upper.rotation.z+=w*.3;
  } else if(preparingThrow||(anim==='throw'&&actionTime>0)){
    // Two hands above the head, then a forward arm sweep. Both feet stay down.
    const follow=preparingThrow?0:smooth(0,.7,progress),recover=preparingThrow?0:smooth(.7,1,progress);
    rig.torso.rotation.x+=follow*.12*(1-recover);
    for(let i=0;i<2;i++){
      const sign=i===0?-1:1;
      rig.arms[i].upper.rotation.set((-2.35+follow*.95)*(1-recover),0,-sign*.2*(1-recover)+sign*.11*recover);
      rig.arms[i].lower.rotation.set(-.3+recover*.14,0,0);
      localFoot(rig.legs[i],sign*.14,i===0?.08:-.08,FOOT_Y);rig.legs[i].anchor=null;
    }
  } else if (anim==='header' && actionTime>0) {
    const age=player.aerial?.age??progress*.64,lift=aerialLift(age);
    rig.root.position.y+=lift;rig.torso.rotation.x+=Math.sin((progress-.2)*Math.PI)*.3;
    rig.head.rotation.x+=smooth(.15,.45,progress)*.35;
    for(let i=0;i<2;i++){localFoot(rig.legs[i],i===0?-.13:.13,-.1,FOOT_Y+lift+.1*Math.sin(progress*Math.PI));rig.legs[i].anchor=null;rig.arms[i].upper.rotation.z+=(i===0?-.65:.65)*Math.sin(progress*Math.PI);}
  } else if(anim==='volley' && actionTime>0) {
    const kick=Math.sin(clamp(progress/.7,0,1)*Math.PI);
    localFoot(rig.legs[footIndex],side*.12,.35+kick*.3,FOOT_Y+kick*.95);rig.legs[footIndex].anchor=null;
    localFoot(rig.legs[1-footIndex],-side*.13,-.1,FOOT_Y);rig.torso.rotation.x-=kick*.22;rig.torso.rotation.y+=side*kick*.22;
    rig.arms[0].upper.rotation.z-=kick*.65;rig.arms[1].upper.rotation.z+=kick*.65;
  } else if (/pass|through|lob|loft|shoot|shot|kick|clear/.test(anim) && a > 0.01) {
    // Contact is immediate, followed by a rising follow-through and recovery.
    // The authoritative release never waits for this cosmetic pose.
    const strong = /shoot|shot/.test(anim), follow = Math.sin(clamp(progress / 0.72, 0, 1) * Math.PI);
    localFoot(rig.legs[footIndex], side * 0.11 + clamp(ballSide, -0.12, 0.12), 0.38 + follow * (strong ? 0.21 : 0.12), FOOT_Y + 0.035 + follow * (strong ? 0.33 : 0.18), a);
    localFoot(rig.legs[1 - footIndex], -side * 0.14, -0.08, FOOT_Y, a * 0.8);
    rig.legs[footIndex].footPitch = -follow * 0.25 * a;
    rig.torso.rotation.x += (strong ? 0.1 : 0.04) * a;
    rig.torso.rotation.y += side * follow * 0.18 * a;
    rig.arms[0].upper.rotation.z -= 0.48 * a; rig.arms[1].upper.rotation.z += 0.48 * a;
  } else if (/slide/.test(anim) && a > 0.01) {
    // Drop onto one hip, extend the leading boot, then draw it in while rising.
    // Root motion remains entirely authoritative; these are cosmetic limb targets.
    const drop = smooth(0, 0.14, progress), recover = smooth(0.58, 1, progress);
    const slide = drop * (1 - recover) * a;
    rig.pelvis.position.y += (0.305 - rig.pelvis.position.y) * slide;
    rig.pelvis.position.x = side * 0.065 * slide;
    rig.pelvis.rotation.x -= 0.12 * slide; rig.pelvis.rotation.z += side * 0.23 * slide;
    rig.torso.rotation.x -= 0.76 * slide; rig.torso.rotation.z += side * 0.12 * slide;
    rig.head.rotation.x += 0.42 * slide;
    localFoot(rig.legs[footIndex], side * 0.12, 0.73 - recover * 0.3, FOOT_Y + 0.035, slide);
    localFoot(rig.legs[1 - footIndex], -side * 0.25, 0.21, FOOT_Y + 0.025, slide);
    rig.legs[footIndex].footPitch = -0.15 * slide;
    for (let i = 0; i < 2; i++) {
      rig.arms[i].upper.rotation.x += (0.82 - rig.arms[i].upper.rotation.x) * slide;
      rig.arms[i].upper.rotation.z += ((i === 0 ? -1 : 1) * 0.48 - rig.arms[i].upper.rotation.z) * slide;
      rig.arms[i].lower.rotation.x += (-0.38 - rig.arms[i].lower.rotation.x) * slide;
      rig.legs[i].anchor = null; rig.legs[i].stance = false;
    }
  } else if (/tackle|contact|stumble/.test(anim) && a > 0.01) {
    const extension = 1 - smooth(0.3, 0.9, progress);
    rig.pelvis.position.y -= 0.09 * a; rig.torso.rotation.x += 0.26 * a;
    localFoot(rig.legs[footIndex], side * 0.15, 0.3 + extension * 0.3, FOOT_Y + 0.025, a);
    localFoot(rig.legs[1 - footIndex], -side * 0.17, -0.18, FOOT_Y, a);
    rig.arms[0].upper.rotation.z -= 0.3 * a; rig.arms[1].upper.rotation.z += 0.3 * a;
  } else if (saving||cue||rig.diveBlend>.01) {
    if (actionStarted) {
      const save = player.saveTarget || state?.ball;
      const dx = finite(save?.x, bx) - x, dz = finite(save?.z, bz) - z;
      const sideAtContact = cos * dx - sin * dz, forwardAtContact = sin * dx + cos * dz;
      rig.saveDirection = {x: clamp(sideAtContact / Math.max(0.6, Math.hypot(sideAtContact, forwardAtContact) * 0.5), -1, 1), height: clamp(finite(save?.y, 1), 0.2, 2.5)};
    }
    if(cue&&!saving){const dx=cue.point.x-x,dz=cue.point.z-z;rig.saveDirection={x:clamp((cos*dx-sin*dz)/.65,-1,1),height:cue.point.y};rig.divePoint={...cue.point};}
    if(saving)rig.divePoint={...(player.saveTarget||state.ball)};
    const recover=saving?smooth(.58,1,progress):0;
    rig.diveBlend=damp(rig.diveBlend,saving?1-recover:cue?.weight||0,dt,saving?32:14);
    const dive=rig.diveBlend,direction=rig.saveDirection,side=direction.x,high=clamp((direction.height-.5)/1.8,0,1);
    rig.root.rotation.z=-side*(1.25-high*.32)*dive;
    // Rotate around the hip and let the legs leave the ground, rather than
    // leaving two planted feet under a tilted upright goalkeeper.
    rig.root.position.x-=cos*side*.48*dive;rig.root.position.z+=sin*side*.48*dive;
    rig.root.position.y+=Math.abs(side)*(.1+high*.37)*dive;
    rig.pelvis.position.y-= (1-Math.abs(side))*(1-high)*.3*dive;
    rig.torso.rotation.x+=(1-Math.abs(side))*.38*dive;
    rig.head.rotation.z+=side*.1*dive;
    rig.diveLegs=Math.abs(side)>.25?dive:0;
    if(rig.divePoint){
      const point=rig.divePoint,punch=player.saveOutcome==='punch',retract=saving?smooth(punch?.32:.12,punch?.8:.58,progress):0;
      rig.root.updateMatrixWorld(true);
      const chest=rig.torso.localToWorld(new THREE.Vector3(0,.12,.32));
      const target=new THREE.Vector3(point.x,point.y,point.z).lerp(chest,retract);
      const spread=punch&&!holding?.065:.18;
      rig.gloveTargets=[-1,1].map(sign=>target.clone().add(new THREE.Vector3(cos*sign*spread,0,-sin*sign*spread)));
    }
  } else {rig.diveLegs=0;}
  if(holding&&!rig.gloveTargets){
    rig.root.updateMatrixWorld(true);
    rig.gloveTargets=[-1,1].map(side=>rig.torso.localToWorld(new THREE.Vector3(side*.18,.12,.32)));
  } else if (!holding&&!saving&&!preparingThrow&&actionTime<=0&&(rig.touchAge < 0.18 && state?.ball?.owner === player.id || finite(player.receiveTime) > 0)) {
    const receive = clamp(finite(player.receiveTime) / 0.2, 0, 1);
    const touch = Math.sin(clamp(rig.touchAge / 0.18, 0, 1) * Math.PI) * 0.55;
    const weight = Math.max(receive * 0.75, touch);
    localFoot(rig.legs[footIndex], side * 0.08 + clamp(ballSide, -0.11, 0.11), clamp(ballForward, 0.25, 0.52), FOOT_Y + 0.035, weight);
    rig.pelvis.position.y -= receive * 0.025; rig.torso.rotation.x += weight * 0.06;
  }
  if ((state?.phase === 'goal' && state.event?.team === player.team) || (/celebrat/.test(anim) && actionTime > 0)) {
    rig.arms[0].upper.rotation.z = -2.4;
    rig.arms[1].upper.rotation.z = 2.4;
    rig.arms[0].lower.rotation.x = -0.25;
    rig.arms[1].lower.rotation.x = -0.25;
    rig.torso.rotation.y += Math.sin(now * 4 + finite(player.id)) * 0.1;
  }
  if (finite(player.charge) > 0 && actionTime <= 0 && !preparingThrow) {
    const charge = clamp(player.charge, 0, 1);
    localFoot(rig.legs[footIndex], side * 0.11, -0.22 - charge * 0.12, FOOT_Y + 0.035 + charge * 0.08, charge * 0.7);
    rig.torso.rotation.y -= side * charge * 0.09; rig.arms[0].upper.rotation.z -= charge * 0.2;
  }
  if(player.shielding&&state?.ball?.owner===player.id&&actionTime<=0){
    rig.pelvis.position.y-=0.035;rig.torso.rotation.x+=0.09;
    rig.arms[0].upper.rotation.z-=0.45;rig.arms[1].upper.rotation.z+=0.45;
    rig.arms[0].lower.rotation.x-=0.25;rig.arms[1].lower.rotation.x-=0.25;
  }
  rig.lastActionTime = actionTime; rig.lastAnim = anim;
  // Only the pelvis ancestry is needed before solving; update all batched parts once.
  rig.pelvis.updateWorldMatrix(true, false); rig.ik.inverse.copy(rig.pelvis.matrixWorld).invert();
  for (const leg of rig.legs) {leg.target.y = Math.max(FOOT_Y, leg.target.y); solveLeg(rig, leg);}
  if(rig.diveLegs>0)for(const [i,leg] of rig.legs.entries()){
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(i===0?-.12:.28,0,0));leg.upper.quaternion.slerp(q,rig.diveLegs);
    q.setFromEuler(new THREE.Euler(i===0?-.35:-.65,0,0));leg.lower.quaternion.slerp(q,rig.diveLegs);leg.foot.quaternion.slerp(new THREE.Quaternion(),rig.diveLegs);
    leg.anchor=null;leg.stance=false;
  }
  rig.root.updateMatrixWorld(true);
  if(rig.gloveTargets){for(let i=0;i<2;i++)reachGlove(rig,rig.arms[i],rig.gloveTargets[i]);}
  rig.root.updateMatrixWorld(true);
  rig.heldBallAnchor.copy(rig.arms[0].hand.getWorldPosition(new THREE.Vector3())).add(rig.arms[1].hand.getWorldPosition(new THREE.Vector3())).multiplyScalar(.5);
}
