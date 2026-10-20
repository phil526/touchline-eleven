import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFootballer,animateFootballer} from '../client/animation.js';
import {keeperDiveCue} from '../client/keeper-animation.js';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {penaltyScene} from '../shared/penalties.js';
import {createPracticeSession} from '../client/practice.js';
const idle=[neutralInput(),neutralInput()];
test('keeper anticipation follows a released incoming shot and ignores held aim and unreachable balls',()=>{
 const p={team:1,x:52,z:0},s={phase:'playing',tick:20,ball:{x:47,z:.6,y:1,vx:25,vy:1,vz:0,owner:null,lastShot:{tick:10,team:0}}};
 const before=JSON.stringify(s);assert.ok(keeperDiveCue(s,p)?.weight>0);assert.equal(JSON.stringify(s),before);
 s.ball.owner=9;assert.equal(keeperDiveCue(s,p),null);s.ball.owner=null;s.ball.z=8;assert.equal(keeperDiveCue(s,p),null);
});
test('dive leaves the turf in either direction, follows contact and recovers with a caught ball between gloves',()=>{
 for(const side of [-1,1])for(const outcome of ['catch','punch']){
  const rig=createFootballer(0,0,true),p={id:0,team:0,x:0,z:0,vx:0,vz:0,facing:Math.PI/2,anim:'save',actionTime:.95,actionDuration:.95,saveOutcome:outcome,saveTarget:{x:side*.85,y:.9,z:.25}};
  const s={phase:'playing',ball:{...p.saveTarget,owner:outcome==='catch'?0:null,state:outcome==='catch'?'held':'flight'}};let lift=0,lean=0;
  for(let frame=0;frame<90;frame++){p.actionTime=Math.max(0,.95-frame/60);const before=JSON.stringify(s);animateFootballer(rig,p,1/60,frame/60,s);assert.equal(JSON.stringify(s),before);
   lift=Math.max(lift,...rig.legs.map(l=>l.foot.getWorldPosition(new THREE.Vector3()).y));lean=Math.max(lean,Math.abs(rig.root.rotation.z));
   assert.ok(rig.parts.every(part=>part.node.matrixWorld.elements.every(Number.isFinite)));
  }
  assert.ok(lean>.85&&lift>.2,'A lateral dive lifts and turns the whole body');assert.ok(Math.abs(rig.root.rotation.z)<.02,'Returns upright');
  if(outcome==='catch'){const left=rig.arms[0].hand.getWorldPosition(new THREE.Vector3()),right=rig.arms[1].hand.getWorldPosition(new THREE.Vector3());assert.ok(rig.heldBallAnchor.distanceTo(left)<.25&&rig.heldBallAnchor.distanceTo(right)<.25);}
 }
});
test('actual slow and fast penalty contacts serialize catch/punch outcomes and preserve the camera during recovery',()=>{
 for(const speed of [9,30]){
  const s=createMatch({humans:[true,true]});s.phase='playing';s.selected=[0,20];
  for(const p of s.players)Object.assign(p,{x:0,z:25+p.slot,cooldown:10});const p=s.players[0];Object.assign(p,{x:-50,z:0,cooldown:0});
  Object.assign(s.ball,{x:-49.4,z:.2,y:1,vx:-speed,vy:0,vz:0,owner:null,lastTouch:20,state:'flight',lastShot:{tick:0,team:1,penalty:{x:-41.5,z:0,taker:20,half:1}}});
  stepMatch(s,idle);assert.equal(s.stats.saves[0],1);assert.equal(p.saveOutcome,speed===9?'catch':'punch');assert.ok(penaltyScene(s));
  if(speed===9){assert.equal(s.ball.owner,0);assert.equal(s.ball.state,'held');}
  else {assert.equal(s.ball.owner,null);assert.ok(s.ball.vx>0&&Math.abs(s.ball.vz)>=5);assert.equal(s.audioEvents.at(-1).technique,'punch');}
 }
});
test('penalty practice lets the save and ball keep moving during feedback without adding an attempt',()=>{
 const practice=createPracticeSession({drill:'penalties'});practice.step(neutralInput());for(let i=0;i<25;i++)practice.step({...neutralInput(),shoot:true});practice.step(neutralInput());
 for(let i=0;i<200&&practice.status.phase!=='feedback';i++)practice.step(neutralInput());assert.equal(practice.status.resultCode,'saved');
 const s=practice.state,tick=s.tick,time=s.players[11].actionTime;for(let i=0;i<20;i++)practice.step(neutralInput());
 assert.ok(s.tick>tick&&s.players[11].actionTime<time);assert.equal(practice.status.attempts,1);assert.equal(practice.status.successes,0);
});
