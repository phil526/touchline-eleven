import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {segmentCircleContact} from '../shared/rules.js';

const DT=1/60;
function fixture({x=1.5,z=0,facing=Math.PI,seed=1729}={}) {
  const s=createMatch({humans:[true,true],seed});s.phase='playing';
  for(const p of s.players){p.x=-30+p.slot*4;p.z=p.team?-25:25;p.vx=p.vz=0;p.cooldown=20;}
  const owner=s.players[9],defender=s.players[13];
  Object.assign(owner,{x:0,z:0,facing:0,cooldown:20});
  Object.assign(defender,{x,z,facing,cooldown:0});s.selected=[owner.id,defender.id];
  Object.assign(s.ball,{x:.7,z:0,y:.11,owner:owner.id,state:'controlled',vx:0,vy:0,vz:0,lastTouch:owner.id});
  return {s,owner,defender};
}
function tick(s,input=neutralInput(),n=1) {for(let i=0;i<n;i++)stepMatch(s,[neutralInput(),input],DT);}

test('standing front challenge clears the ball before reaching the opponent',()=>{
  const {s,defender}=fixture();tick(s,{...neutralInput(),tackle:true});
  assert.equal(s.phase,'playing');assert.equal(s.stats.tackles[1],1);assert.equal(s.stats.fouls[1],0);
  assert.equal(s.ball.owner,null);assert.equal(s.ball.lastTouch,defender.id);assert.ok(s.ball.vx<-4);
});

test('standing contact from behind awards a free kick with a physical explanation',()=>{
  const {s}=fixture({x:-.9,facing:0});tick(s,{...neutralInput(),tackle:true});
  assert.equal(s.phase,'restart');assert.equal(s.restart.type,'freeKick');assert.equal(s.restart.team,0);
  assert.equal(s.stats.fouls[1],1);assert.equal(s.stats.tackles[1],0);
  assert.equal(s.restart.reasonCode,'foul');assert.match(s.restart.reason,/standing tackle.*before the ball/);
  assert.match(s.restart.reason,/^Trip from behind:/);
  assert.deepEqual({...s.restart.foul,x:undefined,z:undefined},{offender:13,victim:9,kind:'trip',label:'Trip from behind',x:undefined,z:undefined});
  assert.ok(Math.abs(s.restart.foul.x)<.3&&Math.abs(s.restart.foul.z)<.3);
});

test('light edge contact from the front is play-on, not a foul',()=>{
  const {s,owner}=fixture({x:1.3,z:.33});tick(s,{...neutralInput(),tackle:true});
  assert.equal(s.phase,'playing');assert.equal(s.stats.fouls[1],0);assert.equal(s.stats.tackles[1],0);assert.equal(s.ball.owner,owner.id);
});

test('a side-on challenge reaching the ball just after the leg is a contested clean tackle',()=>{
  const {s,defender}=fixture({x:.25,z:1.5,facing:-Math.PI/2});s.ball.x=.45;
  tick(s,{...neutralInput(),tackle:true});
  assert.equal(s.phase,'playing');assert.equal(s.stats.fouls[1],0);assert.equal(s.stats.tackles[1],1);
  assert.equal(s.ball.lastTouch,defender.id);assert.match(s.event.text,/close challenge/);
});

test('the same side-on leg contact without reaching the ball is a late standing tackle',()=>{
  const {s}=fixture({x:.25,z:1.5,facing:-Math.PI/2});s.ball.x=1.4;
  tick(s,{...neutralInput(),tackle:true});
  assert.equal(s.phase,'restart');assert.equal(s.stats.fouls[1],1);assert.match(s.restart.reason,/^Late standing tackle:.*legs before the ball/);
  assert.equal(s.restart.foul.kind,'lateTackle');
});

test('AI defenders behind the ball carrier jockey instead of tripping',()=>{
  for(const seed of [1,2,17,1729]) {
    const {s,owner,defender}=fixture({x:-1.2,facing:0,seed});
    for(let i=0;i<45&&s.phase==='playing';i++)stepMatch(s,[neutralInput(),null],DT);
    assert.equal(s.stats.fouls[1],0,`seed ${seed}`);
    assert.ok(s.stats.tackles[1]===1||defender.x>owner.x-.3,`seed ${seed}: defender should work round to the ball side`);
  }
});

test('an offside attacker cannot bypass involvement by playing a pass with a standing or sliding boot',()=>{
  for(const sliding of [false,true]) {
    const {s,defender}=fixture({x:sliding?2.5:1.5});
    Object.assign(s.ball,{owner:null,state:'free',lastTouch:20});s.ballFlightTime=.5;
    s.offside={team:defender.team,candidates:[defender.id]};
    tick(s,{...neutralInput(),tackle:!sliding,slide:sliding,mx:-1});
    for(let i=0;i<30&&s.phase==='playing';i++)tick(s);
    assert.equal(s.phase,'restart');assert.equal(s.restart.type,'freeKick');assert.equal(s.restart.team,0);
    assert.equal(s.restart.reasonCode,'offside');assert.equal(s.stats.offsides[1],1);
    assert.equal(s.stats.tackles[1],0);assert.equal(s.stats.fouls[1],0);assert.equal(s.ball.state,'dead');
  }
});

test('wrong-facing and lateral missed challenges never award a proximity foul',()=>{
  for(const seed of [1,2,17,1729,912345])for(const position of [{x:.7,z:0,facing:0},{x:.2,z:1.1,facing:0},{x:3,z:0,facing:Math.PI}]) {
    const {s,owner}=fixture({...position,seed});tick(s,{...neutralInput(),tackle:true});
    assert.equal(s.phase,'playing');assert.equal(s.stats.fouls[1],0);assert.equal(s.stats.tackles[1],0);
    assert.equal(s.ball.owner,owner.id);
  }
});

test('swept contact detects a fast crossing but ignores an overlapping foot moving away',()=>{
  const hit=segmentCircleContact({x:-2,z:0},{x:2,z:0},{x:0,z:0},.5);
  assert.equal(hit,.375);
  assert.equal(segmentCircleContact({x:.2,z:0},{x:1,z:0},{x:0,z:0},.5),null);
  assert.equal(segmentCircleContact({x:-2,z:.6},{x:2,z:.6},{x:0,z:0},.5),null);
});

test('slide reaches a grounded ball first, clears it once and keeps its committed direction',()=>{
  const {s,defender}=fixture({x:2.5});
  tick(s,{...neutralInput(),slide:true,mx:-1});
  assert.equal(defender.anim,'slide');assert.equal(defender.actionDuration,.85);
  tick(s,{...neutralInput(),mx:1,mz:1},24);
  assert.equal(s.phase,'playing');assert.equal(s.stats.tackles[1],1);assert.equal(s.stats.fouls[1],0);
  assert.equal(s.ball.lastTouch,defender.id);assert.ok(s.ball.vx<0);
  assert.ok(defender.x<1);assert.ok(Math.abs(defender.z)<.01);assert.ok(Math.abs(Math.abs(defender.facing)-Math.PI)<1e-10);
  assert.equal(defender.slideHit,true);assert.equal(defender.anim,'slide');
});

test('slide into an opponent before the ball is a foul, including in the penalty area',()=>{
  for(const penalty of [false,true]) {
    const {s,owner,defender}=fixture({x:-2,facing:0});
    if(penalty){owner.x+=43;defender.x+=43;s.ball.x+=43;}
    tick(s,{...neutralInput(),slide:true,mx:1});
    for(let i=0;i<40&&s.phase==='playing';i++)tick(s);
    assert.equal(s.phase,'restart');assert.equal(s.restart.type,penalty?'penalty':'freeKick');
    assert.equal(s.stats.fouls[1],1);assert.equal(s.stats.tackles[1],0);assert.match(s.restart.reason,/slide.*before the ball/);
    assert.equal(defender.slideTime,0);
  }
});

test('missed slide has recovery and cooldown without fouls or steering during commitment',()=>{
  const {s,defender}=fixture({x:-3,z:3,facing:0});
  tick(s,{...neutralInput(),slide:true,mx:1});tick(s,{...neutralInput(),mx:-1,mz:-1},32);
  assert.equal(defender.slideTime,0);assert.equal(defender.anim,'slide');assert.ok(defender.actionTime>.2);
  assert.equal(defender.facing,0);assert.ok(Math.abs(defender.z-3)<1e-10);assert.ok(defender.vx>0);
  assert.equal(s.stats.fouls[1],0);assert.equal(s.stats.tackles[1],0);
  tick(s,neutralInput(),20);assert.equal(defender.actionTime,0);assert.notEqual(defender.anim,'slide');assert.ok(defender.cooldown>0);
  tick(s,{...neutralInput(),slide:true,mx:-1});assert.notEqual(defender.anim,'slide');
  tick(s,neutralInput(),45);tick(s,{...neutralInput(),slide:true,mx:-1});assert.equal(defender.anim,'slide');assert.ok(defender.slideDir.x<0);
});

test('switching control cannot cancel a slide and holding the button does not retrigger it',()=>{
  const {s,defender}=fixture({x:-10,z:6,facing:0});
  Object.assign(s.players[14],{x:4,z:3});
  tick(s,{...neutralInput(),slide:true,mx:1});
  const x=defender.x;tick(s,{...neutralInput(),switch:true,mx:-1});
  assert.notEqual(s.selected[1],defender.id);assert.equal(defender.anim,'slide');assert.ok(defender.x>x);
  const held=fixture({x:-10,z:6,facing:0});tick(held.s,{...neutralInput(),slide:true,mx:1},110);
  assert.equal(held.defender.actionTime,0);assert.notEqual(held.defender.anim,'slide');assert.equal(held.s.stats.fouls[1],0);
});

test('slide input is boolean-only and cannot interrupt possession or a committed kick',()=>{
  assert.equal(neutralInput().slide,false);
  const {s,defender}=fixture();tick(s,{...neutralInput(),slide:'yes'});assert.notEqual(defender.anim,'slide');
  Object.assign(s.ball,{owner:defender.id,x:defender.x-.6,z:defender.z});tick(s,{...neutralInput(),slide:true});assert.notEqual(defender.anim,'slide');
  s.ball.owner=null;defender.anim='pass';defender.actionTime=.2;defender.cooldown=0;
  tick(s);tick(s,{...neutralInput(),slide:true});assert.equal(defender.anim,'pass');
});
