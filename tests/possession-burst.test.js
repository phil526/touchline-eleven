import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
const idle=[neutralInput(),neutralInput()];
function receipt(id=6){
 const s=createMatch({humans:[true,true],duration:600});s.phase='playing';s.ballFlightTime=1;
 for(const p of s.players)Object.assign(p,{x:p.team?40:-40,z:p.team?26:-26,vx:0,vz:0,cooldown:10});
 const p=s.players[id];Object.assign(p,{x:-15,z:0,facing:0,cooldown:0});s.selected[p.team]=id;
 Object.assign(s.ball,{owner:null,state:'free',lastTouch:id===9?8:9,x:-15.6,z:0,y:.11,vx:8,vz:0,vy:0});stepMatch(s,idle);
 assert.equal(s.ball.owner,id);return {s,p};
}
test('midfielders and forwards on either team receive one 1.5-second burst on possession gain',()=>{
 for(const id of [5,6,7,8,9,10,16,17,20]){
  const {s,p}=receipt(id);assert.equal(p.possessionBurst,1.5);
  for(let i=0;i<45;i++)stepMatch(s,idle);assert.ok(Math.abs(p.possessionBurst-.75)<1e-8);
  for(let i=0;i<46;i++)stepMatch(s,idle);assert.equal(p.possessionBurst,0);assert.equal(s.ball.owner,id);
 }
 for(const id of [1,2,3,4,12,13])assert.equal(receipt(id).p.possessionBurst,0);
});
test('burst raises movement speed exactly 30 percent, retains the ball, then returns to normal',()=>{
 for(const mode of ['normal','sprint','close']){
  const boosted=receipt(9),normal=structuredClone(boosted.s);normal.players[9].possessionBurst=0;
  const input={...neutralInput(),mx:1,sprint:mode==='sprint',jockey:mode==='close'};
  for(let i=0;i<65;i++){stepMatch(boosted.s,[input,neutralInput()]);stepMatch(normal,[input,neutralInput()]);assert.equal(boosted.s.ball.owner,9);}
  assert.ok(Math.abs(boosted.p.vx/normal.players[9].vx-1.3)<1e-7,mode);
  for(let i=0;i<65;i++)stepMatch(boosted.s,[input,neutralInput()]);assert.equal(boosted.p.possessionBurst,0);
  assert.ok(Math.abs(boosted.p.vx-normal.players[9].vx)<1e-7);
 }
});
test('passing or a stoppage cancels the burst; another genuine receipt grants a fresh non-stacking burst',()=>{
 const {s,p}=receipt(6);stepMatch(s,[{...neutralInput(),pass:true,mx:1},neutralInput()]);assert.notEqual(s.ball.owner,p.id);assert.equal(p.possessionBurst,0);
 Object.assign(s.ball,{x:p.x-.6,z:p.z,y:.11,vx:8,vy:0,vz:0,owner:null,lastTouch:9});p.cooldown=0;s.ballFlightTime=1;stepMatch(s,idle);assert.equal(p.possessionBurst,1.5);
 s.phase='restart';s.phaseTime=0;s.restart={type:'freeKick',team:0,taker:6,x:p.x,z:p.z};stepMatch(s,idle);assert.equal(p.possessionBurst,0);
});
