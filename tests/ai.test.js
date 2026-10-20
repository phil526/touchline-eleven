import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,neutralInput} from '../shared/simulation.js';
import {chooseReceiver,selectPressers,formationTarget,keeperTarget} from '../shared/ai.js';
import {attackDirection} from '../shared/rules.js';
import {PITCH} from '../shared/config.js';

function scenario(team=0,half=1) {
  const s=createMatch({humans:[false,false],tactics:['balanced','balanced']});s.phase='playing';s.half=half;
  const dir=attackDirection(s,team);
  for(const p of s.players){p.x=(p.team===team?-25:32)*dir;p.z=(p.slot-5)*5*dir;p.vx=p.vz=0;p.cooldown=p.actionTime=0;p.facing=p.team===team?(dir>0?0:Math.PI):(dir>0?Math.PI:0);}
  s.receiver=[null,null];return s;
}
function own(s,id,x=0,z=0) {
  const p=s.players[id];Object.assign(p,{x,z,vx:0,vz:0});
  Object.assign(s.ball,{x,z,y:.11,vx:0,vz:0,vy:0,owner:id,state:'controlled'});return p;
}
function target(s,p){return formationTarget(s,p,selectPressers(s));}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('possession offers nearby passing angles while forwards maintain distinct width',()=>{
  const s=scenario(),owner=own(s,5,0,0),left=target(s,s.players[6]),right=target(s,s.players[7]);
  assert.ok(left.z<-7&&right.z>7);assert.ok(Math.hypot(left.x-owner.x,left.z-owner.z)<15);assert.ok(Math.hypot(right.x-owner.x,right.z-owner.z)<15);
  assert.ok(Math.abs(left.x-right.x)>5,'support players stagger instead of standing on one line');
  const wideLeft=target(s,s.players[8]),wideRight=target(s,s.players[10]);
  assert.ok(wideLeft.z<-23&&wideRight.z>23);assert.ok(wideRight.z-wideLeft.z>46);
  assert.deepEqual(selectPressers(s)[0],[],'a team in possession does not chase its carrier');
});

test('forward runs wait for release opportunities and stay onside before a pass',()=>{
  const s=scenario(),owner=own(s,6,2,0),striker=s.players[9];
  for(const p of s.players.filter(p=>p.team===1))p.x=22;s.players[11].x=49;
  const forward=target(s,striker);owner.facing=Math.PI;const backTurned=target(s,striker);
  assert.ok(forward.x>backTurned.x+3);assert.ok(forward.x<21.2,'run target leaves a margin to the second-last defender');
  owner.facing=0;Object.assign(s.players[17],{x:3,z:1});assert.ok(target(s,striker).x<forward.x-3,'pressure encourages shorter support');
  Object.assign(s.ball,{owner:null,state:'flight',x:25,vx:14});s.receiver[0]=striker.id;
  assert.ok(target(s,striker).x>25,'a released receiver can run beyond the old offside line');
});

test('one chaser and one separated goal-side screen preserve the centre backs',()=>{
  const s=scenario();own(s,17,0,12);
  Object.assign(s.players[6],{x:-2,z:12});Object.assign(s.players[5],{x:-8,z:6});
  Object.assign(s.players[2],{x:-28,z:-8});Object.assign(s.players[3],{x:-28,z:8});
  const pressers=selectPressers(s);assert.equal(pressers[0].length,2);assert.equal(pressers[0][0],6);
  const decisions=s.players.filter(p=>p.team===0&&p.role!=='GK').map(p=>({id:p.id,...formationTarget(s,p,pressers)}));
  assert.equal(decisions.filter(p=>p.isPresser).length,1);
  const chaser=decisions.find(p=>p.id===pressers[0][0]),cover=decisions.find(p=>p.id===pressers[0][1]);
  assert.ok(Math.hypot(chaser.x-s.ball.x,chaser.z-s.ball.z)<1);
  assert.ok(cover.x<s.ball.x-4&&Math.hypot(cover.x-chaser.x,cover.z-chaser.z)>5);
  assert.ok(decisions.find(p=>p.id===2).x<-20&&decisions.find(p=>p.id===3).x<-20);
});

test('defenders assign distinct dangerous runners and mark from the goal side',()=>{
  const s=scenario();own(s,17,-10,0);
  Object.assign(s.players[6],{x:-11,z:0});Object.assign(s.players[7],{x:-17,z:0});
  Object.assign(s.players[1],{x:-30,z:-23});Object.assign(s.players[2],{x:-32,z:-7});Object.assign(s.players[3],{x:-32,z:7});Object.assign(s.players[4],{x:-30,z:23});Object.assign(s.players[5],{x:-22,z:0});
  const runners=[s.players[18],s.players[19],s.players[20],s.players[21]];
  runners.forEach((p,i)=>Object.assign(p,{x:-35,z:[-23,-8,8,23][i]}));
  const pressers=selectPressers(s),decisions=s.players.filter(p=>p.team===0&&p.slot<=5&&p.slot>0&&!pressers[0].includes(p.id)).map(p=>formationTarget(s,p,pressers));
  const marked=decisions.filter(point=>runners.some(p=>Math.hypot(p.x-point.x,p.z-point.z)<4));
  assert.equal(marked.length,4,'four dangerous runners get four markers');
  const covered=new Set();
  for(const decision of marked) {
    const nearest=runners.map((p,i)=>({i,p,gap:Math.hypot(p.x-decision.x,p.z-decision.z)})).sort((a,b)=>a.gap-b.gap)[0];
    assert.ok(decision.x<nearest.p.x);assert.ok(nearest.gap<4);covered.add(nearest.i);
  }
  assert.equal(covered.size,marked.length,'different defenders cover different runners');
  assert.ok(decisions.some(point=>point.x>-30&&point.x<-15),'the unassigned midfielder keeps cover');
});

test('an intended pass receiver is the sole ball chaser while nearby team-mates screen',()=>{
  const s=scenario();Object.assign(s.ball,{owner:null,x:0,z:0,vx:15,vz:2,state:'flight'});
  Object.assign(s.players[6],{x:1,z:0});Object.assign(s.players[9],{x:15,z:4});s.receiver[0]=9;
  const pressers=selectPressers(s);assert.equal(pressers[0][0],9);
  const decisions=s.players.filter(p=>p.team===0&&p.role!=='GK').map(p=>formationTarget(s,p,pressers));
  assert.equal(decisions.filter(p=>p.isPresser).length,1);assert.ok(formationTarget(s,s.players[9],pressers).x>0);
  assert.ok(formationTarget(s,s.players[pressers[0][1]],pressers).x<0);
});

test('strong manual aim preserves deliberate offside passes and rejects targets behind the aim',()=>{
  const s=scenario(),passer=own(s,6,0,0);
  for(const p of s.players.filter(p=>p.team===0&&p.id!==6)){p.x=-15;p.z=20;}
  for(const p of s.players.filter(p=>p.team===1)){p.x=10;p.z=20;}
  s.players[11].x=49;Object.assign(s.players[9],{x:25,z:0});
  assert.equal(chooseReceiver(s,passer,{...neutralInput(),mx:1}).id,9);
  s.players[9].x=-25;assert.equal(chooseReceiver(s,passer,{...neutralInput(),mx:1}),null);
});

test('receiver scoring prefers open space over an equally aimed blocked lane',()=>{
  const s=scenario(),passer=own(s,6,0,0);
  for(const p of s.players.filter(p=>p.team===0&&p.id!==6)){p.x=-20;p.z=25;}
  Object.assign(s.players[7],{x:16,z:-5});Object.assign(s.players[8],{x:16,z:5});Object.assign(s.players[17],{x:8,z:-2.5});
  assert.equal(chooseReceiver(s,passer,{...neutralInput(),mx:1}).id,8);
});

test('keepers predict shot crossing rather than following current lateral ball position',()=>{
  const s=scenario(),keeper=s.players[0];Object.assign(keeper,{x:-50,z:0});
  Object.assign(s.ball,{owner:null,x:-30,z:8,vx:-24,vz:-10,y:.5,vy:2,state:'flight'});
  const result=keeperTarget(s,keeper),time=(result.x-s.ball.x)/s.ball.vx;
  assert.equal(result.incoming,true);assert.ok(result.z<1);assert.ok(Math.abs(result.z-(s.ball.z+s.ball.vz*time))<.01);
  assert.ok(result.x>=-51.75&&result.x<=-36.8);assert.ok(Math.abs(result.z)<PITCH.boxWidth/2);
});

test('keepers collect safe balls but stay home for attacker-favoured races and outside-box balls',()=>{
  const s=scenario(),keeper=s.players[0];Object.assign(keeper,{x:-49,z:0});
  Object.assign(s.ball,{owner:null,x:-44,z:3,vx:0,vz:0,y:.11,state:'free'});
  const safe=keeperTarget(s,keeper);assert.equal(safe.x,-44);assert.equal(safe.z,3);
  Object.assign(s.players[20],{x:-44,z:3.5});assert.ok(keeperTarget(s,keeper).x<-48);
  s.ball.x=-34;const outside=keeperTarget(s,keeper);assert.ok(outside.x<-48);assert.ok(Math.abs(outside.z)<3.6);
});

test('AI target geometry mirrors correctly when either team changes ends',()=>{
  for(const team of [0,1]) {
    const first=scenario(team,1),second=scenario(team,2),dir=attackDirection(first,team);
    own(first,team*11+6,4*dir,-6*dir);own(second,team*11+6,-4*dir,6*dir);
    for(const slot of [1,5,7,8,9,10]) {
      const a=target(first,first.players[team*11+slot]),b=target(second,second.players[team*11+slot]);
      assert.ok(Math.abs(a.x+b.x)<1e-9&&Math.abs(a.z+b.z)<1e-9);
    }
    const a=keeperTarget(first,first.players[(1-team)*11]),b=keeperTarget(second,second.players[(1-team)*11]);
    assert.ok(Math.abs(a.x+b.x)<1e-9&&Math.abs(a.z+b.z)<1e-9);
  }
});

test('pure decisions are repeatable and leave frozen match state untouched',()=>{
  const s=scenario();own(s,17,-12,9);const serialised=JSON.stringify(s);freeze(s);
  const pressers=selectPressers(s),decisions=()=>s.players.map(p=>p.role==='GK'?keeperTarget(s,p):formationTarget(s,p,pressers));
  assert.deepEqual(decisions(),decisions());chooseReceiver(s,s.players[17],neutralInput());assert.equal(JSON.stringify(s),serialised);
  for(const point of decisions()){assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.z));assert.ok(Math.abs(point.x)<=PITCH.halfLength&&Math.abs(point.z)<PITCH.halfWidth);}
});
