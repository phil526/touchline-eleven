import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {keeperPosition,keeperContact,predictKeeperBall,KEEPER_TUNING} from '../shared/goalkeeping.js';
import {integrateBall} from '../shared/ball.js';
import {PITCH} from '../shared/config.js';

function fixture() {
  const s=createMatch({humans:[false,false]});s.phase='playing';
  for(const p of s.players)Object.assign(p,{x:p.team?20:-15,z:20+p.slot*.6,vx:0,vz:0,cooldown:0,actionTime:0});
  const p=s.players[0];Object.assign(p,{x:-50,z:0});
  Object.assign(s.ball,{owner:null,state:'free',x:-49.4,z:0,y:.11,vx:-8,vz:0,vy:0,lastTouch:20});
  return {s,p};
}
function segment(s,from,to) {Object.assign(s.ball,from);return [{...s.ball},{...s.ball,...to}];}
function freeze(v){if(v&&typeof v==='object'){Object.freeze(v);for(const value of Object.values(v))freeze(value);}return v;}

test('a central one-on-one closes the angle while cover and wide attackers keep the keeper nearer goal',()=>{
  const {s,p}=fixture(),attacker=s.players[20];Object.assign(attacker,{x:-40,z:4});Object.assign(s.ball,{owner:20,x:-40.6,z:4});
  const close=keeperPosition(s,p);assert.equal(close.mode,'oneOnOne');assert.ok(close.x>-49&&close.x<-43);assert.ok(close.z>0&&close.z<4);assert.equal(close.sprint,true);
  Object.assign(s.players[3],{x:-42,z:4});const covered=keeperPosition(s,p);assert.equal(covered.mode,'guard');assert.ok(covered.x<close.x-2);
  s.players[3].x=-15;attacker.z=s.ball.z=17;const wide=keeperPosition(s,p);assert.ok(wide.x<-49);assert.ok(wide.z>2&&wide.z<PITCH.goalWidth/2);
});

test('loose rebound forecasts follow the new ball path only when the keeper wins the race',()=>{
  const {s,p}=fixture();Object.assign(p,{x:-49.5});Object.assign(s.ball,{x:-48.5,z:1,y:.2,vx:4,vz:3,vy:.4,lastTouch:p.id});s.ballFlightTime=.3;
  const rebound=keeperPosition(s,p);assert.equal(rebound.mode,'rebound');assert.ok(rebound.x>s.ball.x);assert.ok(rebound.z>s.ball.z);
  Object.assign(s.players[20],{x:-47.8,z:1});const contested=keeperPosition(s,p);assert.equal(contested.mode,'recover');assert.ok(contested.x<rebound.x);
  Object.assign(s.ball,{vx:-14,vz:-7,lastTouch:20});const returned=keeperPosition(s,p);assert.equal(returned.incoming,true);assert.equal(returned.mode,'intercept');assert.ok(returned.z<s.ball.z);
});

test('collection forecasts include bounce and rolling drag and cannot lead the keeper outside the box',()=>{
  const {s,p}=fixture(),ball={...s.ball,y:1.4,vy:-5,vx:7,vz:2};
  const before=JSON.stringify(ball),forecast=predictKeeperBall(ball,.75),actual={...ball};
  for(let i=0;i<45;i++)integrateBall(actual,1/60);
  for(const key of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(forecast[key]-actual[key])<1e-9,key);
  assert.equal(JSON.stringify(ball),before);assert.ok(forecast.y>=PITCH.ballRadius);
  for(const [x,z,vx,vz] of [[-35,0,0,0],[-38,19,6,4],[-51,0,-8,0],[-48,-24,0,0]]) {
    Object.assign(s.ball,{x,z,vx,vz,y:.11,vy:0,lastTouch:p.id});
    const target=keeperPosition(s,p),depth=target.x+PITCH.halfLength;
    assert.ok(depth>=KEEPER_TUNING.minDepth&&depth<=PITCH.boxLength-KEEPER_TUNING.boxMargin);assert.ok(Math.abs(target.z)<=PITCH.boxWidth/2-KEEPER_TUNING.boxMargin);
    if(x===-35)assert.notEqual(target.mode,'collect');
  }
});

test('fast low shots contact only their swept path and are parried low away from goal',()=>{
  const {s,p}=fixture(),[from,to]=segment(s,{x:-47,y:.11,z:0,vx:-35,vz:0,vy:0},{x:-52});
  const save=keeperContact(s,p,from,to);assert.ok(save&&save.t>0&&save.t<1);assert.equal(save.outcome,'parry');assert.equal(save.isSave,true);
  assert.ok(Math.hypot(save.point.x-p.x,save.point.z-p.z)<=save.reach+1e-9);assert.ok(save.reach<1);
  assert.ok(save.velocity.x>0&&Math.abs(save.velocity.z)>=5);assert.ok(save.velocity.y>=.35&&save.velocity.y<=1.1);
  assert.equal(keeperContact(s,p,from,{...to,x:-48.5}),null,'a ball still outside reach cannot be saved early');
});

test('finite low reach, rear reach, height and penalty-area limits prevent magnetic saves',()=>{
  const {s,p}=fixture();
  for(const patch of [{x:-49.4,z:1.2,y:.11},{x:-50.5,z:0,y:.11},{x:-49.4,z:0,y:2.6}]) {
    const ball={...s.ball,...patch};assert.equal(keeperContact(s,p,ball,ball),null);
  }
  p.x=-36.2;const outside={...s.ball,x:-35.8,y:.11};assert.equal(keeperContact(s,p,outside,outside),null);
  p.x=-35.9;const inside={...s.ball,x:-36.3,y:.11};assert.equal(keeperContact(s,p,inside,inside),null);
});

test('a keeper cannot reach through a player or immediately catch their own parry',()=>{
  const {s,p}=fixture(),ball={...s.ball};Object.assign(s.players[2],{x:-49.7,z:0});
  assert.equal(keeperContact(s,p,ball,ball),null);s.players[2].z=20;
  p.cooldown=.3;assert.equal(keeperContact(s,p,ball,ball),null);p.cooldown=0;
  const contact=keeperContact(s,p,ball,ball);assert.equal(contact.outcome,'catch');
});

test('one-on-one smother requires a loose touch within a small grounded reach and a clear path',()=>{
  const {s,p}=fixture(),attacker=s.players[20];Object.assign(attacker,{x:-48.8,z:0});
  Object.assign(s.ball,{owner:20,x:-49.5,z:0,vx:-3});
  const save=keeperContact(s,p,s.ball,s.ball);assert.equal(save.outcome,'catch');assert.equal(save.smother,true);assert.ok(save.reach<.7);assert.equal(save.isSave,false);
  s.ball.x=-48.9;assert.equal(keeperContact(s,p,s.ball,s.ball),null,'cannot strip a dribbler from distance');
  s.ball.x=-49.4;attacker.x=-49.7;assert.equal(keeperContact(s,p,s.ball,s.ball),null,'cannot smother through the dribbler');
  s.ball.owner=2;assert.equal(keeperContact(s,p,s.ball,s.ball),null,'does not steal team-mate possession');
});

test('parries prefer open lateral space, and recovery allows a later second save',()=>{
  const {s,p}=fixture();Object.assign(s.ball,{vx:-30,x:-49.4});Object.assign(s.players[20],{x:-45,z:6});
  const first=keeperContact(s,p,s.ball,s.ball);assert.equal(first.outcome,'parry');assert.ok(first.velocity.z<0);assert.ok(first.cooldown>0&&first.cooldown<first.recovery);
  p.cooldown=first.cooldown;assert.equal(keeperContact(s,p,s.ball,s.ball),null);
  p.cooldown=0;Object.assign(s.ball,{vx:-10,vz:0,y:.11});const second=keeperContact(s,p,s.ball,s.ball);assert.equal(second.outcome,'catch');
});

test('keeper decisions and contacts mirror after the end change without consuming RNG or altering state',()=>{
  const {s,p}=fixture();Object.assign(s.ball,{x:-46,z:1.3,vx:-25,vz:-3,y:.5,vy:0});
  const mirrored=structuredClone(s);mirrored.half=2;
  for(const q of mirrored.players){q.x=-q.x;q.z=-q.z;q.vx=-q.vx;q.vz=-q.vz;}
  for(const key of ['x','z','vx','vz'])mirrored.ball[key]*=-1;
  const before=JSON.stringify(s);freeze(s);const a=keeperPosition(s,p),b=keeperPosition(mirrored,mirrored.players[0]);
  assert.ok(Math.abs(a.x+b.x)<1e-9&&Math.abs(a.z+b.z)<1e-9);assert.deepEqual(a,keeperPosition(s,p));
  const to={...s.ball,x:-51,z:0},mirrorTo={...mirrored.ball,x:51,z:0};
  const first=keeperContact(s,p,s.ball,to),second=keeperContact(mirrored,mirrored.players[0],mirrored.ball,mirrorTo);
  assert.equal(first.outcome,second.outcome);assert.ok(Math.abs(first.point.x+second.point.x)<1e-9);assert.ok(Math.abs(first.velocity.x+second.velocity.x)<1e-9);assert.ok(Math.abs(first.velocity.z+second.velocity.z)<1e-9);
  assert.equal(JSON.stringify(s),before);
});

function liveFixture() {
  const result=fixture(),{s,p}=result;s.options.humans=[true,true];s.selected[0]=p.id;
  for(const player of s.players)if(player.id!==p.id)player.cooldown=20;
  return result;
}
const idle=[neutralInput(),neutralInput()];

test('live integration stops a fast low shot at the keeper before its whole-ball goal crossing',()=>{
  const {s,p}=liveFixture();p.x=-51.9;Object.assign(s.ball,{x:-50.7,z:0,y:.11,vx:-45,vy:0,vz:0});
  stepMatch(s,idle,.05);
  assert.equal(s.phase,'playing');assert.deepEqual(s.score,[0,0]);assert.equal(s.stats.saves[0],1);
  assert.equal(s.ball.owner,null);assert.equal(s.ball.lastTouch,p.id);assert.ok(s.ball.vx>0);assert.equal(p.anim,'save');
  assert.ok(Math.hypot(s.ball.x-p.x,s.ball.z-p.z)<1);assert.ok(s.ball.x>-PITCH.halfLength);
});

test('live integration awards a completed goal before any later goalkeeper contact',()=>{
  const {s,p}=liveFixture();p.x=-54;Object.assign(s.ball,{x:-52.4,z:0,y:.11,vx:-30,vy:0,vz:0});
  stepMatch(s,idle,.05);
  assert.equal(s.phase,'goal');assert.deepEqual(s.score,[0,1]);assert.equal(s.stats.saves[0],0);
});

test('a live parry preserves offside eligibility and the keeper can save a later return after recovery',()=>{
  const {s,p}=liveFixture();Object.assign(s.ball,{x:-49.4,z:0,y:.11,vx:-28,vy:0,vz:0});
  const offside={team:1,candidates:[21]};s.offside=offside;
  stepMatch(s,idle);assert.equal(s.ball.owner,null);assert.equal(s.ball.lastTouch,p.id);assert.deepEqual(s.offside,offside);assert.equal(s.stats.saves[0],1);
  for(let i=0;i<25;i++)stepMatch(s,idle);
  assert.equal(p.cooldown,0);assert.equal(s.phase,'playing');
  // A returning rebound starts at the actual parry's new location.
  const dx=p.x-s.ball.x,dz=p.z-s.ball.z,d=Math.hypot(dx,dz);
  Object.assign(s.ball,{vx:dx/d*12,vz:dz/d*12,vy:0,y:.11});
  for(let i=0;i<100&&s.ball.owner!==p.id&&s.phase==='playing';i++)stepMatch(s,idle);
  assert.equal(s.ball.owner,p.id);assert.equal(s.ball.state,'held');assert.equal(s.stats.saves[0],2);
  assert.equal(s.offside,null);assert.deepEqual(s.score,[0,0]);
});

test('a live one-on-one smother transfers possession only after the exposed dribble reaches the keeper',()=>{
  const {s,p}=liveFixture(),attacker=s.players[20];Object.assign(attacker,{x:-48.8,z:0,facing:Math.PI});s.selected[1]=attacker.id;
  Object.assign(s.ball,{owner:attacker.id,state:'controlled',x:-49.5,z:0,y:.11,vx:-2,vy:0,vz:0});
  stepMatch(s,idle);assert.equal(s.ball.owner,p.id);assert.equal(s.ball.state,'held');assert.equal(s.stats.fouls[0],0);assert.equal(s.stats.saves[0],0);
});
