import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {passPreview} from '../shared/passing.js';
import {oneTwoTarget} from '../shared/one-two.js';
import {NetworkClient} from '../client/network.js';
import {validateInput} from '../server/index.js';
import {createCameraController} from '../client/camera.js';

function fixture(team=0,half=1){
 const s=createMatch({duration:600,humans:[true,true]});s.phase='playing';s.half=half;s.time=half===2?300:0;
 for(const p of s.players)Object.assign(p,{x:p.team?46:-46,z:p.team?-30:30,vx:0,vz:0,cooldown:100,actionTime:0,aiTime:100});
 const dir=(team===0?1:-1)*(half===1?1:-1),p=s.players[team*11+9],q=s.players[team*11+7];
 Object.assign(p,{x:dir*20,z:0,facing:dir>0?0:Math.PI,cooldown:0});Object.assign(q,{x:dir*25,z:8,cooldown:0});
 for(const d of s.players.filter(v=>v.team!==team))d.x=dir*46;
 s.selected[team]=p.id;Object.assign(s.ball,{x:p.x+dir*.5,z:0,y:.11,owner:p.id,lastTouch:p.id,state:'controlled',vx:0,vy:0,vz:0});
 return {s,p,q,dir,team};
}
function step(f,input={}){const a=[neutralInput(),neutralInput()];a[f.team]={...neutralInput(),...input};stepMatch(f.s,a);}

test('one-two plays a real pass, switches to its receiver and runs the passer forward in both halves and teams',()=>{
 for(const team of [0,1])for(const half of [1,2]){
  const f=fixture(team,half);step(f,{oneTwo:true,mx:f.dir*.5,mz:.8});
  assert.equal(f.s.stats.passes[team],1);assert.equal(f.s.ball.owner,null);assert.equal(f.s.runs[team].runner,f.p.id);assert.equal(f.s.runs[team].receiver,f.q.id);assert.equal(f.s.selected[team],f.q.id);
  const start=f.p.x*f.dir;for(let i=0;i<45;i++)step(f);
  assert.ok(f.p.x*f.dir>start+1);assert.ok(f.p.stamina<1);assert.equal(f.s.stats.passes[team],1);
 }
});
test('the receiver can play a return through ball into the run without an automatic return pass',()=>{
 const f=fixture();step(f,{oneTwo:true,mx:.5,mz:.8});
 for(let i=0;i<100&&f.s.ball.owner!==f.q.id;i++)step(f);
 assert.equal(f.s.ball.owner,f.q.id);assert.equal(f.s.stats.passes[0],1);assert.ok(f.s.runs[0]);
 const dx=f.p.x-f.q.x,dz=f.p.z-f.q.z,d=Math.hypot(dx,dz),input={mx:dx/d,mz:dz/d,through:true};
 const preview=passPreview(f.s,f.q,input,'through');assert.equal(preview.receiverId,f.p.id);
 step(f,input);assert.equal(f.s.stats.passes[0],2);assert.equal(f.s.receiver[0],f.p.id);assert.equal(f.s.runs[0].returned,true);assert.ok(f.s.offside);
});
test('the forward run holds an onside target until the return pass is released',()=>{
 for(const team of [0,1])for(const half of [1,2]){
  const f=fixture(team,half);step(f,{oneTwo:true,mx:f.dir*.5,mz:.8});
  for(const p of f.s.players.filter(p=>p.team!==team))p.x=f.dir*28;
  assert.ok(oneTwoTarget(f.s,f.p).x*f.dir<=27.1+1e-9);
  f.s.runs[team].returned=true;assert.ok(oneTwoTarget(f.s,f.p).x*f.dir>28);
 }
});
test('a one-two run ends on expiry, turnover, dead ball, a different pass or a shot',()=>{
 for(const reason of ['expiry','turnover','dead','different','shot','clear']){
  const f=fixture();step(f,{oneTwo:true,mx:.5,mz:.8});assert.ok(f.s.runs[0]);
  if(reason==='expiry')f.s.tick=f.s.runs[0].expires;
  if(reason==='turnover')f.s.ball.lastTouch=13;
  if(reason==='dead')f.s.phase='goal';
  if(reason==='different'||reason==='shot'||reason==='clear'){Object.assign(f.s.ball,{owner:f.q.id,lastTouch:f.q.id,x:f.q.x+.5,z:f.q.z});f.q.charge=.5;f.s.previous[0].shoot=reason==='shot';}
  if(reason==='different')Object.assign(f.s.players[6],{x:26,z:20});
  step(f,reason==='different'?{pass:true,mz:1}:reason==='clear'?{clear:true}:{});assert.equal(f.s.runs[0],null,reason);
 }
});
test('deliberately aiming away from the runner can still choose another teammate',()=>{
 const f=fixture();step(f,{oneTwo:true,mx:.5,mz:.8});Object.assign(f.s.ball,{owner:f.q.id,x:f.q.x+.5,z:f.q.z});Object.assign(f.s.players[6],{x:26,z:20});
 assert.equal(passPreview(f.s,f.q,{mx:0,mz:1},'pass').receiverId,6);
});
test('one-two is ignored without possession and does not bypass manual restarts',()=>{
 const f=fixture();f.s.ball.owner=null;step(f,{oneTwo:true});assert.equal(f.s.stats.passes[0],0);assert.equal(f.s.runs[0],null);
 f.s.phase='restart';f.s.restart={type:'freeKick',team:0,taker:9,x:20,z:0,armed:true};f.s.phaseTime=3;Object.assign(f.s.ball,{owner:9,state:'controlled'});step(f,{oneTwo:true});assert.equal(f.s.phase,'restart');assert.equal(f.s.stats.passes[0],0);
});
test('network and third-person mapping preserve one-two pulses and an opted-out shot assist',t=>{
 const f=fixture(),camera=createCameraController(),input=camera.prepareInput({oneTwo:true,shotAssist:false,mx:0,mz:-1},f.s,{cameraMode:'third-person'});
 assert.equal(input.oneTwo,true);assert.equal(input.shotAssist,false);assert.equal(validateInput(input).oneTwo,true);assert.throws(()=>validateInput({...input,oneTwo:'true'}));assert.throws(()=>validateInput({...input,shotAssist:1}));
 const client=new NetworkClient();t.after(()=>client.disconnect());const sent=[];client.send=m=>{sent.push(structuredClone(m));return true;};client.room={phase:'playing'};
 client.input(input);client.input({mx:0,mz:0,shotAssist:false});client.flushInput();assert.equal(sent[0].actions.oneTwo,true);assert.equal(validateInput(sent[0].actions).shotAssist,false);
 client.input({mx:0,mz:0});client.flushInput();assert.equal(sent[1].actions.oneTwo,false);assert.equal(validateInput(sent[1].actions).shotAssist,true);
});
