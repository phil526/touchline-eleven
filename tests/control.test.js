import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {groundPassSpeed,integrateBall} from '../shared/ball.js';
const dt=1/60;
function fixture(){
 const s=createMatch({humans:[true,true],duration:180});s.phase='playing';
 for(const p of s.players){p.x=p.team?45:-45;p.z=p.team?-29:29;p.cooldown=10;p.vx=p.vz=0;}
 const p=s.players[9];Object.assign(p,{x:-15,z:0,cooldown:0,facing:0});s.selected[0]=p.id;
 Object.assign(s.ball,{x:-14.4,y:.11,z:0,vx:0,vy:0,vz:0,owner:p.id,state:'controlled',lastTouch:p.id});return {s,p};
}
function run(s,n,input=neutralInput()){for(let i=0;i<n;i++)stepMatch(s,[input,neutralInput()],dt);}

test('ground passes reach short and long targets with useful arrival pace',()=>{
 for(const distance of [8,15,30,45])for(const kind of ['pass','through']){
  const b={x:0,z:0,y:.11,vx:groundPassSpeed(distance,kind),vz:0,vy:0};
  let ticks=0;while(b.x<distance&&ticks++<600)integrateBall(b,dt);
  assert.ok(b.x>=distance,`${kind} reaches ${distance} m`);assert.ok(b.vx>3&&b.vx<9,`${kind} arrives at a controllable pace`);
 }
});
test('ground friction applies on every resting contact, without alternating air ticks',()=>{
 const b={x:0,z:0,y:.11,vx:15,vz:0,vy:0};integrateBall(b,dt);const ratio=b.vx/15;const before=b.vx;integrateBall(b,dt);
 assert.ok(Math.abs(b.vx/before-ratio)<1e-12);assert.equal(b.y,.11);
});
test('close control is slower and keeps the ball tighter than sprint dribbling',()=>{
 const samples=[];
 for(const style of ['close','normal','sprint']){
  const {s,p}=fixture();const input={...neutralInput(),mx:1,jockey:style==='close',sprint:style==='sprint'};
  const gaps=[];for(let i=0;i<120;i++){stepMatch(s,[input,neutralInput()],dt);if(i>60)gaps.push(Math.hypot(s.ball.x-p.x,s.ball.z-p.z));assert.equal(s.ball.owner,p.id);}
  samples.push({x:p.x,gap:gaps.reduce((a,b)=>a+b)/gaps.length,mode:p.controlMode});
 }
 assert.ok(samples[0].x<samples[1].x&&samples[1].x<samples[2].x);
 assert.ok(samples[0].gap<samples[1].gap-.1&&samples[1].gap<samples[2].gap-.15);
 assert.deepEqual(samples.map(s=>s.mode),['close','normal','sprint']);
});
test('direction changes and braking keep controlled touches finite and close',()=>{
 const {s,p}=fixture();run(s,60,{...neutralInput(),mx:1});run(s,40,{...neutralInput(),mz:1,jockey:true});run(s,40,{...neutralInput(),mx:-1,jockey:true});run(s,50);
 assert.equal(s.ball.owner,p.id);assert.ok(Math.hypot(p.vx,p.vz)<.01);assert.ok(Math.hypot(s.ball.x-p.x,s.ball.z-p.z)<.8);
 assert.ok(p.touchTick>0);assert.ok([0,1].includes(p.touchFoot));
});
test('first touch cushions incoming momentum and height without teleporting to the turf',()=>{
 const {s,p}=fixture();Object.assign(p,{x:0,z:0});Object.assign(s.ball,{owner:null,state:'flight',lastTouch:8,x:-.6,z:0,y:.6,vx:8,vy:-.5,vz:0});s.ballFlightTime=1;
 stepMatch(s,[neutralInput(),neutralInput()],dt);
 assert.equal(s.ball.owner,p.id);assert.ok(s.ball.vx>0&&s.ball.vx<2);assert.ok(s.ball.y>.5);assert.ok(p.receiveTime>=.1&&p.receiveTime<.19);assert.equal(p.anim,'control');
 run(s,50);assert.equal(s.ball.owner,p.id);assert.equal(s.ball.y,.11);assert.ok(Math.hypot(s.ball.x-p.x,s.ball.z-p.z)<.9);
});
test('better control cushions a fast receipt more effectively',()=>{
 function receipt(control){const {s,p}=fixture();Object.assign(p,{x:0,z:0});p.attrs.control=control;Object.assign(s.ball,{owner:null,state:'free',lastTouch:8,x:-.6,z:0,y:.11,vx:18,vy:0,vz:0});s.ballFlightTime=1;stepMatch(s,[neutralInput(),neutralInput()],dt);assert.equal(s.ball.owner,p.id);return s.ball.vx;}
 assert.ok(receipt(90)<receipt(40));
});

test('starts reach useful speed in 200 ms and reverse braking takes less than 300 ms',()=>{
 const {s,p}=fixture();run(s,12,{...neutralInput(),mx:1});assert.ok(p.vx>2.6&&p.vx<2.8);
 run(s,60,{...neutralInput(),mx:1});assert.ok(p.vx<6.6,'Top speed stays bounded');
 let frames=0;while(p.vx>0&&frames++<60)run(s,1,{...neutralInput(),mx:-1});assert.ok(frames<=18);
 run(s,30,{...neutralInput(),mx:-1});assert.ok(p.vx<-6);assert.equal(s.ball.owner,p.id);
});

test('normal dribbling stays within 80 cm through repeated sharp turns and stops',()=>{
 const {s,p}=fixture();for(const input of [{mx:1},{mz:1},{mx:-1},{mz:-1},{}])for(let i=0;i<60;i++){
  run(s,1,{...neutralInput(),...input});assert.equal(s.ball.owner,p.id);assert.ok(Math.hypot(p.x-s.ball.x,p.z-s.ball.z)<.8);
 }
});

test('close control uses 80 percent speed; sprint cannot override it or drain stamina',()=>{
 const speeds=[];for(const input of [{mx:1},{mx:1,jockey:true},{mx:1,jockey:true,sprint:true}]){
  const {s,p}=fixture();run(s,80,{...neutralInput(),...input});speeds.push(p.vx);assert.equal(p.stamina,1);
 }
 assert.ok(Math.abs(speeds[1]/speeds[0]-.8)<1e-8);assert.equal(speeds[2],speeds[1]);
});

test('close control shields on the far side of pressure and remains vulnerable to an exposed-ball tackle',()=>{
 const {s,p}=fixture(),q=s.players[13];Object.assign(q,{x:p.x+1.5,z:0,facing:Math.PI,cooldown:0});s.selected[1]=q.id;
 run(s,60,{...neutralInput(),jockey:true});assert.equal(p.shielding,true);assert.ok(Math.cos(p.facing)<-.99);
 assert.ok(s.ball.x<p.x-.25);assert.ok(Math.hypot(s.ball.x-p.x,s.ball.z-p.z)<.65);
 // The defender moves around the body to the side where the ball is exposed.
 Object.assign(q,{x:p.x-1.3,z:s.ball.z,facing:0,cooldown:0});
 stepMatch(s,[{...neutralInput(),jockey:true},{...neutralInput(),tackle:true}]);
 assert.equal(s.stats.tackles[1],1);assert.equal(s.stats.fouls[1],0);assert.equal(s.ball.owner,null);
 run(s,1);assert.equal(p.shielding,false);
});

test('a tackle through a shielding body reaches the opponent before the protected ball',()=>{
 const {s,p}=fixture(),q=s.players[13];Object.assign(q,{x:p.x+1.5,z:0,facing:Math.PI,cooldown:0});s.selected[1]=q.id;
 run(s,60,{...neutralInput(),jockey:true});stepMatch(s,[{...neutralInput(),jockey:true},{...neutralInput(),tackle:true}]);
 assert.equal(s.stats.tackles[1],0);assert.equal(s.stats.fouls[1],1);assert.equal(s.phase,'restart');assert.equal(s.restart.team,0);
});

test('receiving cushions a fast pass and accepts movement on the next tick',()=>{
 const {s,p}=fixture();Object.assign(p,{x:0,z:0});Object.assign(s.ball,{owner:null,state:'free',lastTouch:8,x:-.6,z:0,y:.11,vx:18,vy:0,vz:0});s.ballFlightTime=1;
 run(s,1);assert.equal(s.ball.owner,p.id);assert.ok(s.ball.vx<2.1);assert.ok(p.receiveTime<.16);
 run(s,6,{...neutralInput(),mz:1});assert.ok(p.z>.05);assert.ok(p.vz>1.3);assert.equal(s.ball.owner,p.id);
});

test('the shared Close Control/chip modifier does not turn a charging shot away from goal',()=>{
 const {s,p}=fixture(),q=s.players[13];Object.assign(q,{x:p.x+1.5,z:0,cooldown:100});s.selected[1]=q.id;
 run(s,15,{...neutralInput(),jockey:true,chip:true,shoot:true,mx:1});assert.equal(p.shielding,false);assert.ok(Math.cos(p.facing)>.99);assert.ok(p.charge>.2);
 run(s,1,{...neutralInput(),mx:1});assert.equal(s.stats.shots[0],1);assert.equal(s.ball.shotKind,'chip');
});
