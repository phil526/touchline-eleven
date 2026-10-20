import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {shotAim,withShotSpread,shotTrajectory,shotType} from '../shared/shooting.js';
import {integrateBall,firstBoundaryCrossing,goalLineOutcome} from '../shared/ball.js';
import {keeperContact,predictKeeperBall} from '../shared/goalkeeping.js';

function fixture(half=1) {
  const s=createMatch({humans:[true,true]});s.phase='playing';s.half=half;s.time=half===2?s.halfDuration:0;
  for(const p of s.players){p.x=p.team?-40:40;p.z=p.team?-28:28;p.cooldown=20;p.vx=p.vz=0;}
  const p=s.players[9],dir=half===1?1:-1;
  Object.assign(p,{x:dir*20,z:5,cooldown:0,facing:dir===1?0:Math.PI});s.selected[0]=p.id;
  Object.assign(s.ball,{x:p.x+dir*.6,z:p.z,y:.11,owner:p.id,state:'controlled',vx:0,vy:0,vz:0,lastTouch:p.id});
  return {s,p};
}

test('shared shot aim is pure, finite and responds to charge and lateral aim in both halves',()=>{
  for(const half of [1,2]) {
    const {s,p}=fixture(half),before=JSON.stringify(s);
    const left=shotAim(s,p,{mz:-1},.2),right=shotAim(s,p,{mz:1},.9);
    assert.equal(JSON.stringify(s),before);assert.equal(left.target.z,-3.2);assert.equal(right.target.z,3.2);
    assert.equal(Math.sign(left.velocity.x),half===1?1:-1);
    assert.ok(right.speed>left.speed);assert.ok(right.target.y>left.target.y);
    for(const v of Object.values(left.velocity))assert.ok(Number.isFinite(v));
    assert.equal(shotAim(s,p,{},-10).power,0);assert.equal(shotAim(s,p,{},10).power,1);
  }
});

test('authoritative release follows the preview direction and charge when dispersion is zero',()=>{
  for(const half of [1,2])for(const mz of [-1,0,1]) {
    const {s,p}=fixture(half);p.attrs.shooting=100;p.charge=.63;s.previous[0].shoot=true;
    const input={...neutralInput(),mz},aim=shotAim(s,p,input,p.charge),dt=1/60;
    stepMatch(s,[input,neutralInput()],dt);
    assert.equal(s.stats.shots[0],1);assert.equal(s.ball.owner,null);
    assert.ok(Math.abs(s.ball.vx-aim.velocity.x*Math.exp(-.035*dt))<1e-10);
    assert.ok(Math.abs(s.ball.vz-aim.velocity.z*Math.exp(-.035*dt))<1e-10);
    assert.ok(Math.abs(s.ball.vy-(aim.velocity.y-9.81*dt))<1e-10);
  }
});

test('dispersion adjusts horizontal target without changing charge or mutating the preview',()=>{
  const {s,p}=fixture(),base=shotAim(s,p,{mz:.5},.6),copy=structuredClone(base),spread=withShotSpread(base,.4);
  assert.deepEqual(base,copy);assert.equal(spread.target.z,base.target.z+.4);
  assert.equal(spread.velocity.y,base.velocity.y);assert.equal(spread.power,base.power);
  assert.ok(Math.abs(Math.hypot(spread.velocity.x,spread.velocity.z)-base.speed)<1e-10);
});

test('finesse trades pace for precision and a genuine curved flight in either half',()=>{
  for(const half of [1,2])for(const mz of [-1,1]){
    const {s,p}=fixture(half);p.z=0;s.ball.z=0;
    const standard=shotAim(s,p,{mz},.6),finesse=shotAim(s,p,{mz,finesse:true},.6),copy=structuredClone(finesse);
    assert.ok(finesse.speed<standard.speed);assert.ok(finesse.spread<standard.spread);assert.equal(Math.sign(finesse.curl),mz);
    const path=shotTrajectory(finesse),middle=path[Math.floor(path.length/2)],end=path.at(-1);
    const linearZ=finesse.origin.z+(end.z-finesse.origin.z)*(middle.x-finesse.origin.x)/(end.x-finesse.origin.x);
    assert.ok(Math.abs(middle.z-linearZ)>.5,'visible bend away from the straight line');
    assert.equal(goalLineOutcome({axis:'x',...end}),'goal');assert.deepEqual(finesse,copy);
  }
});

test('chip power raises the arc, clears a rushing keeper and drops under the crossbar',()=>{
  for(const half of [1,2]){
    const {s,p}=fixture(half),dir=half===1?1:-1;p.x=dir*33;p.z=0;
    Object.assign(s.ball,{x:dir*33.6,z:0});const keeper=s.players[11];Object.assign(keeper,{x:dir*44,z:0,cooldown:0});
    const low=shotTrajectory(shotAim(s,p,{chip:true},.2)),high=shotTrajectory(shotAim(s,p,{chip:true},.8));
    assert.ok(Math.max(...high.map(p=>p.y))>Math.max(...low.map(p=>p.y))+1);
    const aim=shotAim(s,p,{chip:true},.6),b={...aim.origin,vx:aim.velocity.x,vy:aim.velocity.y,vz:aim.velocity.z,curl:aim.curl};
    s.ball.owner=null;let hit=null;
    for(let i=0;i<180;i++){const old={...b};integrateBall(b,1/60);assert.equal(keeperContact(s,keeper,old,b),null);hit=firstBoundaryCrossing(old,b);if(hit)break;}
    assert.ok(hit);assert.equal(goalLineOutcome(hit),'goal');
  }
});

test('special-shot guide and keeper forecast use the actual serialized ball flight',()=>{
  for(const kind of ['finesse','chip']){
    const {s,p}=fixture(),aim=shotAim(s,p,{[kind]:true},.55),b={...aim.origin,vx:aim.velocity.x,vy:aim.velocity.y,vz:aim.velocity.z,curl:aim.curl};
    const predicted=predictKeeperBall(b,.5),copy=JSON.parse(JSON.stringify(b));
    for(let i=0;i<30;i++)integrateBall(copy,1/60);
    for(const key of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(copy[key]-predicted[key])<1e-9);
    const point=shotTrajectory(aim)[10];for(const key of ['x','y','z'])assert.ok(Math.abs(point[key]-copy[key])<1e-9);
  }
});

test('releasing both buttons together preserves the charged shot type and power',()=>{
  for(const kind of ['finesse','chip'])for(const half of [1,2]){
    const {s,p}=fixture(half);p.attrs.shooting=100;
    for(let i=0;i<20;i++)stepMatch(s,[{...neutralInput(),shoot:true,[kind]:true},neutralInput()]);
    assert.equal(p.shotType,kind);const aim=shotAim(s,p,{[kind]:true},p.charge),expected={...aim.origin,vx:aim.velocity.x,vy:aim.velocity.y,vz:aim.velocity.z,curl:aim.curl};integrateBall(expected,1/60);
    stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.stats.shots[0],1);assert.equal(s.ball.shotKind,kind);
    for(const key of ['x','y','z','vx','vy','vz','curl'])assert.ok(Math.abs(s.ball[key]-expected[key])<1e-9,key);
  }
});

test('changing modifier while charging updates style; cap releases a special shot once',()=>{
  const {s,p}=fixture();stepMatch(s,[{...neutralInput(),shoot:true,finesse:true},neutralInput()]);
  stepMatch(s,[{...neutralInput(),shoot:true,chip:true},neutralInput()]);assert.equal(p.shotType,'chip');
  for(let i=0;i<75;i++)stepMatch(s,[{...neutralInput(),shoot:true,chip:true},neutralInput()]);
  assert.equal(s.stats.shots[0],1);assert.equal(s.ball.shotKind,'chip');
});

test('losing possession, selection or active play cancels a special shot charge',()=>{
  for(const reason of ['possession','selection','phase']){
    const {s,p}=fixture();stepMatch(s,[{...neutralInput(),shoot:true,finesse:true},neutralInput()]);
    if(reason==='possession')s.ball.owner=8;if(reason==='selection')s.selected[0]=8;if(reason==='phase')s.phase='restart';
    stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(p.charge,0);assert.equal(p.shotType,null);assert.equal(s.stats.shots[0],0);
  }
});

test('curl is cleared by turf, possession and a new pass',()=>{
  const ball={x:0,y:.12,z:0,vx:10,vy:-2,vz:0,curl:4};integrateBall(ball,1/60);assert.equal(ball.curl,0);
  for(const pass of [false,true]){const {s}=fixture();s.ball.curl=4;stepMatch(s,[{...neutralInput(),pass},neutralInput()]);assert.equal(s.ball.curl,0);}
});

test('invalid modifiers are ignored and chip wins simultaneous modifiers',()=>{
  assert.equal(shotType({chip:'true',finesse:1}),'normal');assert.equal(shotType({chip:true,finesse:true}),'chip');
  const {s,p}=fixture();stepMatch(s,[{...neutralInput(),shoot:true,finesse:'true',chip:1},neutralInput()]);assert.equal(p.shotType,'normal');
});
