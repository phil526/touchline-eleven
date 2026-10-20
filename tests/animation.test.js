import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFootballer, animateFootballer} from '../client/animation.js';
import {createPlayerGeometries} from '../client/player-model.js';

const player = (overrides = {}) => ({id: 1, team: 0, x: 0, z: 0, vx: 0, vz: 0, facing: Math.PI / 2, anim: 'idle', actionTime: 0, charge: 0, ...overrides});
const match = (p, ball = {}) => ({phase: 'playing', ball: {x: p.x, y: 0.225, z: p.z + 0.6, owner: null, ...ball}});
const position = node => node.getWorldPosition(new THREE.Vector3());
const assertFinite = rig => {for (const part of rig.parts) assert.ok(part.node.matrixWorld.elements.every(Number.isFinite), 'Every batched body-part transform must remain finite');};

test('throw-in preparation holds both hands by the ball and keeps both boots grounded through release',()=>{
 const rig=createFootballer(1,0),p=player({charge:1}),s=match(p,{y:1.8,z:.32,owner:p.id});
 s.phase='restart';s.restart={type:'throwIn',taker:p.id};
 const before=JSON.stringify(s);animateFootballer(rig,p,1/60,0,s);assertFinite(rig);assert.equal(JSON.stringify(s),before);
 for(const arm of rig.arms){const hand=arm.lower.localToWorld(new THREE.Vector3(0,-.252,0));assert.ok(hand.y>1.7);assert.ok(hand.distanceTo(new THREE.Vector3(0,1.8,.32))<.23,'Hands must meet the overhead ball');}
 for(const leg of rig.legs)assert.ok(position(leg.foot).y<.07,'Charging a long throw must not lift a kicking foot');
 s.phase='playing';s.restart=null;s.ball.owner=null;p.anim='throw';p.charge=0;p.actionDuration=.65;
 let earlyArm;
 for(let frame=0;frame<42;frame++){
  p.actionTime=Math.max(0,.65-frame/60);animateFootballer(rig,p,1/60,frame/60,s);assertFinite(rig);
  if(frame===0)earlyArm=rig.arms[0].upper.rotation.x;
  if(frame===18)assert.ok(rig.arms[0].upper.rotation.x>earlyArm+.5,'Both arms sweep forwards');
  for(const leg of rig.legs)assert.ok(position(leg.foot).y<.07,'Throw must never become a kick');
 }
 assert.ok(Math.abs(rig.arms[0].upper.rotation.x)<.1,'Arms return to idle');
});

test('shielding opens the arms and lowers the body without changing authority or accumulating pose',()=>{
 const rig=createFootballer(1,0),p=player({shielding:true,controlMode:'close'}),s=match(p,{owner:p.id});const before=JSON.stringify(p);
 for(let i=0;i<120;i++)animateFootballer(rig,p,1/60,i/60,s);
 assertFinite(rig);assert.equal(JSON.stringify(p),before);assert.ok(rig.arms[0].upper.rotation.z<-.35);assert.ok(rig.arms[1].upper.rotation.z>.35);
 const lower=rig.pelvis.position.y;p.shielding=false;animateFootballer(rig,p,1/60,2.1,s);assert.ok(rig.pelvis.position.y>lower+.025);
});

test('headers jump, nod and land; volleys raise a kicking foot without changing authority',()=>{
 for(const kind of ['header','volley']){
  const rig=createFootballer(1,0),p=player({anim:kind,actionDuration:.64}),s=match(p);let highestRoot=0,highestFoot=0;
  for(let frame=0;frame<=48;frame++){
   const age=frame/60;p.actionTime=Math.max(0,.64-age);p.aerial={kind,age};const before=JSON.stringify(p);
   animateFootballer(rig,p,1/60,age,s);assertFinite(rig);assert.equal(JSON.stringify(p),before);
   highestRoot=Math.max(highestRoot,rig.root.position.y);highestFoot=Math.max(highestFoot,...rig.legs.map(l=>position(l.foot).y));
  }
  if(kind==='header')assert.ok(highestRoot>.6);else assert.ok(highestFoot>.65);
  assert.ok(rig.root.position.y<.03,'lands after the action');
 }
});

test('resting soles remain close to turf and gait does not drift with clock time', () => {
  const rig = createFootballer(1, 0), p = player();
  const initialPhase = rig.cycle;
  for (let frame = 0; frame < 300; frame++) animateFootballer(rig, p, 1 / 60, frame / 60, match(p));
  assert.equal(rig.cycle, initialPhase); assert.equal(rig.gaitDistance, 0);
  for (const leg of rig.legs) {
    const foot = position(leg.foot), boot = position(leg.boot);
    assert.ok(foot.y >= 0.04 && foot.y <= 0.065, `ankle ${foot.y}`);
    assert.ok(boot.y - 0.075 / 2 >= -0.005, 'Resting boot must not penetrate turf');
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(leg.foot.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(up.y > 0.999, 'Resting sole stays level');
  }
  assertFinite(rig);
});

test('measured travel advances gait while frozen positions and restart teleports do not', () => {
  const rig = createFootballer(2, 0), p = player({vx: 6, anim: 'run'});
  animateFootballer(rig, p, 1 / 60, 0, match(p));
  const start = rig.cycle;
  for (let i = 0; i < 120; i++) animateFootballer(rig, p, 1 / 60, i / 60, match(p));
  assert.equal(rig.cycle, start, 'Velocity metadata alone must not make stationary feet run');
  for (let i = 0; i < 90; i++) {p.z += 0.1; animateFootballer(rig, p, 1 / 60, 2 + i / 60, match(p));}
  assert.ok(Math.abs(rig.gaitDistance - 9) < 1e-8); assert.notEqual(rig.cycle, start);
  const phase = rig.cycle, travelled = rig.gaitDistance; p.z = -30;
  animateFootballer(rig, p, 1 / 60, 4, match(p));
  assert.equal(rig.cycle, phase); assert.equal(rig.gaitDistance, travelled); assertFinite(rig);
});

test('running stance anchors reduce foot sliding and swing feet clear the turf', () => {
  const rig = createFootballer(0, 0), p = player({vz: 5, anim: 'run'});
  let contactChecks = 0, raised = 0;
  const previous = [null, null];
  for (let frame = 0; frame < 240; frame++) {
    p.z = frame / 60 * 5; animateFootballer(rig, p, 1 / 60, frame / 60, match(p));
    rig.legs.forEach((leg, index) => {
      const foot = position(leg.foot);
      assert.ok(foot.y >= 0.015 && foot.y < 0.5, `Run ankle height is plausible: ${foot.y}`);
      if (foot.y > 0.12) raised++;
      if (frame > 50 && leg.stance && previous[index]?.stance && previous[index].anchor === leg.anchor) {
        assert.ok(Math.hypot(foot.x - previous[index].foot.x, foot.z - previous[index].foot.z) < 0.055, 'Contact foot should not travel with the torso'); contactChecks++;
      }
      previous[index] = {foot, stance: leg.stance, anchor: leg.anchor};
    });
    assertFinite(rig);
  }
  assert.ok(contactChecks > 25); assert.ok(raised > 25);
});

test('turning introduces bounded smooth lean instead of snapping the torso', () => {
  const rig = createFootballer(0, 0), p = player({vz: 5, anim: 'run'});
  for (let i = 0; i < 60; i++) {p.z += 5 / 60; animateFootballer(rig, p, 1 / 60, i / 60, match(p));}
  p.facing = 0; p.x += 5 / 60;
  animateFootballer(rig, p, 1 / 60, 1, match(p));
  assert.ok(rig.yaw > 0 && rig.yaw < Math.PI / 2, 'Yaw blends towards the new facing');
  assert.ok(Math.abs(rig.turnLean) > 0.005 && Math.abs(rig.turnLean) < 0.18); assertFinite(rig);
});

test('free-running bodies and knee bends face measured travel in every pitch direction', () => {
  for (let direction = 0; direction < 8; direction++) {
    const angle = direction * Math.PI / 4, forward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const rig = createFootballer(0, 0), p = player({vx: forward.x * 6, vz: forward.z * 6, facing: angle + Math.PI, anim: 'run'});
    let bends = 0;
    for (let frame = 0; frame < 180; frame++) {
      p.x += p.vx / 60; p.z += p.vz / 60;
      const s = match(p), before = JSON.stringify({p, s});
      animateFootballer(rig, p, 1 / 60, frame / 60, s);
      assert.equal(JSON.stringify({p, s}), before, 'Visual alignment cannot turn or move the authoritative player');
      if (frame < 60) continue;
      const modelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.root.quaternion);
      assert.ok(modelForward.dot(forward) > 0.995, 'The runner must not face backwards when facing metadata is stale');
      for (const leg of rig.legs) {
        const hip = position(leg.upper), knee = position(leg.lower), ankle = position(leg.foot);
        const line = ankle.clone().sub(hip), offset = knee.clone().sub(hip);
        const bend = offset.addScaledVector(line, -offset.dot(line) / line.lengthSq());
        assert.ok(bend.dot(forward) > 0, 'Knees bend towards the front, never backwards'); bends++;
      }
    }
    assert.ok(bends > 100); assertFinite(rig);
  }
});

test('running swing recovers each heel behind the hip before extending forwards to plant', () => {
  for (const speed of [3, 5, 7.5]) {
    const rig = createFootballer(0, 0), p = player({vz: speed, anim: 'run'});
    const heelLift = [0, 0], frontPlant = [0, 0];
    for (let frame = 0; frame < 300; frame++) {
      p.z += speed / 60; animateFootballer(rig, p, 1 / 60, frame / 60, match(p));
      if (frame < 60) continue;
      rig.legs.forEach((leg, index) => {
        const foot = position(leg.foot), forward = foot.z - p.z;
        if (!leg.stance && forward < -0.24) heelLift[index] = Math.max(heelLift[index], foot.y);
        if (leg.stance && forward > 0.2 && foot.y < 0.08) frontPlant[index]++;
      });
    }
    assert.ok(heelLift.every(y => y > (speed >= 5 ? 0.3 : 0.23)), `Both heels should recover clearly behind the runner: ${heelLift}`);
    assert.ok(frontPlant.every(n => n > 4), 'Both legs extend ahead before planting'); assertFinite(rig);
  }
});

test('kicks, charging and close control retain their intentional facing instead of following travel', () => {
  for (const intent of [{anim: 'pass', actionTime: 0.2}, {charge: 0.5}, {controlMode: 'jockey'}, {controlMode: 'close'}]) {
    const rig = createFootballer(0, 0), p = player({vx: 5, facing: Math.PI / 2, ...intent});
    for (let frame = 0; frame < 90; frame++) {p.x += 5 / 60; animateFootballer(rig, p, 1 / 60, frame / 60, match(p));}
    const modelForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.root.quaternion);
    assert.ok(modelForward.z > 0.999, 'Intentional facing remains authoritative during a football action'); assertFinite(rig);
  }
});

test('small stationary snapshot corrections do not turn a player towards the correction', () => {
  const rig = createFootballer(0, 0), p = player();
  for (let frame = 0; frame < 120; frame++) {
    p.x = frame % 2 ? 0.025 : -0.025;
    animateFootballer(rig, p, 1 / 60, frame / 60, match(p));
    assert.ok(Math.abs(rig.yaw) < 0.001, 'A stationary player keeps its facing through reconciliation jitter');
  }
});

test('running boots and receiving contacts keep their whole sole above the turf', () => {
  const shapes = createPlayerGeometries(), vertices=shapes.boot.attributes.position;
  const solePoints=Array.from({length:vertices.count},(_,i)=>new THREE.Vector3().fromBufferAttribute(vertices,i)).filter(p=>p.y<-.02);
  for (const receiving of [false, true]) {
    const rig = createFootballer(0, 0), p = player({vz: 7, anim: 'run', receiveTime: receiving ? 0.2 : 0});
    for (let frame = 0; frame < 180; frame++) {
      p.z += 7 / 60; p.touchFoot = Math.floor(frame / 12) % 2;
      animateFootballer(rig, p, 1 / 60, frame / 60, match(p, {owner: receiving ? p.id : null}));
      for (const leg of rig.legs) for (const point of solePoints) {
        const sole = point.clone().applyMatrix4(leg.boot.matrixWorld);
        assert.ok(sole.y >= -0.005, `The running/receiving boot must not sink into the pitch: ${sole.y}`);
      }
    }
  }
  Object.values(shapes).forEach(g=>g.dispose());
});

test('passing and shooting have contact, follow-through and recovery stages', () => {
  function footAt(anim, progress) {
    const rig = createFootballer(0, 0), p = player({anim, actionTime: 0.32 * (1 - progress), actionDuration: 0.32, touchFoot: 1});
    for (let i = 0; i < 8; i++) animateFootballer(rig, p, 1 / 60, i / 60, match(p));
    assertFinite(rig); return position(rig.legs[1].foot);
  }
  const contact = footAt('shoot', 0), follow = footAt('shoot', 0.35), recovery = footAt('shoot', 0.98), pass = footAt('pass', 0.35);
  assert.ok(follow.y > contact.y + 0.12); assert.ok(follow.z > contact.z + 0.1);
  assert.ok(recovery.y < follow.y - 0.1); assert.ok(follow.y > pass.y + 0.08);
});

test('receive contacts use alternating feet without changing the authoritative ball or player', () => {
  const positions = [];
  for (const touchFoot of [0, 1]) {
    const rig = createFootballer(0, 0), p = player({anim: 'control', receiveTime: 0.3, touchTick: 150, touchFoot});
    const s = match(p, {owner: p.id}), original = JSON.stringify({p, s});
    animateFootballer(rig, p, 1 / 60, 2.5, s);
    assert.equal(JSON.stringify({p, s}), original, 'Animation must not modify match state');
    positions.push(rig.legs.map(leg => position(leg.foot).z)); assertFinite(rig);
  }
  assert.ok(positions[0][0] > positions[0][1] + 0.1);
  assert.ok(positions[1][1] > positions[1][0] + 0.1);
});

test('saves retain their captured direction after ball catch or parry', () => {
  const rolls = [];
  for (const direction of [-1, 1]) {
    const rig = createFootballer(0, 0, true), p = player({anim: 'save', actionTime: 0.7, actionDuration: 0.7, saveTarget: {x: direction * 1.2, y: 1.8, z: 0.4}});
    const s = match(p, {x: 0, z: 0, y: 1.1, owner: p.id});
    for (let i = 0; i < 12; i++) {p.actionTime -= 1 / 60; animateFootballer(rig, p, 1 / 60, i / 60, s);}
    rolls.push(rig.root.rotation.z); assertFinite(rig);
    assert.equal(Math.sign(rig.saveDirection.x), direction);
  }
  assert.ok(rolls[0] > 0.4 && rolls[1] < -0.4);
});

test('older snapshots without new animation metadata remain finite for all action types', () => {
  for (const anim of ['idle', 'run', 'sprint', 'pass', 'shoot', 'tackle', 'slide', 'save', 'celebrate', 'control']) {
    const rig = createFootballer(3, 1, anim === 'save'), p = player({anim, actionTime: 0.2, team: 1});
    for (let i = 0; i < 20; i++) {p.x += 0.01; animateFootballer(rig, p, 1 / 60, i / 60, match(p));}
    assertFinite(rig);
  }
});

test('expired slide, save and celebration metadata release the pose back to locomotion', () => {
  for (const anim of ['slide', 'save', 'celebrate']) {
    const rig = createFootballer(0, 0, anim === 'save'), p = player({anim, actionTime: 0.2, saveTarget: {x: 1, y: 1.8, z: 0.3}});
    const s = match(p);
    for (let i = 0; i < 10; i++) animateFootballer(rig, p, 1 / 60, i / 60, s);
    p.actionTime = 0;
    for (let i = 0; i < 120; i++) animateFootballer(rig, p, 1 / 60, 1 + i / 60, s);
    assert.ok(Math.abs(rig.root.rotation.z) < 0.001);
    assert.ok(Math.abs(rig.arms[0].upper.rotation.z) < 0.2);
    assert.ok(Math.abs(rig.arms[1].upper.rotation.z) < 0.2); assertFinite(rig);
  }
});

test('slide drops to one hip, extends a low boot and recovers without changing root motion', () => {
  const sample = progress => {
    const rig = createFootballer(0, 0), p = player({anim: 'slide', actionDuration: 0.85, actionTime: 0.85 * (1 - progress), slideTime: Math.max(0, 0.48 - 0.85 * progress), touchFoot: 1});
    const s = match(p), before = JSON.stringify({p, s});
    for (let frame = 0; frame < 12; frame++) animateFootballer(rig, p, 1 / 60, frame / 60, s);
    assert.equal(JSON.stringify({p, s}), before); assertFinite(rig);
    assert.equal(rig.root.position.x, p.x); assert.equal(rig.root.position.z, p.z);
    for (const leg of rig.legs) assert.ok(position(leg.foot).y > 0.025, 'Sliding boot remains above the ground');
    return {hip: position(rig.pelvis), front: position(rig.legs[1].foot), back: position(rig.legs[0].foot), head: position(rig.head)};
  };
  const entry = sample(0), extended = sample(0.3), recovery = sample(0.94);
  assert.ok(extended.hip.y < entry.hip.y - 0.5, 'Body drops into a recognisable slide');
  assert.ok(extended.front.z > extended.back.z + 0.35, 'One leg reaches forward while the other folds');
  assert.ok(extended.front.y < 0.15 && extended.back.y < 0.15, 'Slide stays low');
  assert.ok(extended.head.y > 0.5, 'Upper body remains clear of the turf');
  assert.ok(recovery.hip.y > extended.hip.y + 0.45, 'Recovery brings the player back upright');
});
