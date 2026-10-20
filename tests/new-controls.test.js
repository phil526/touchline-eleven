import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {createPracticeSession} from '../client/practice.js';
import {updatePenaltyKeeper,manualKeeper} from '../shared/keeper-control.js';
import {keeperContact} from '../shared/goalkeeping.js';
import {createCameraController} from '../client/camera.js';
import {mapShotPosition} from '../client/shot-map.js';
import {recordShot,finishShot,shotFeedback} from '../shared/shot-log.js';
import {validateInput} from '../server/index.js';
const idle=()=>[neutralInput(),neutralInput()];
function carrier(team=0){const s=createMatch({humans:[true,true],duration:600});s.phase='playing';for(const p of s.players)Object.assign(p,{x:-40+p.slot,z:28,cooldown:20});const p=s.players[team*11+9];Object.assign(p,{x:20,z:0,cooldown:0,facing:team?Math.PI:0});s.selected[team]=p.id;Object.assign(s.ball,{owner:p.id,x:p.x+.4*Math.cos(p.facing),z:0,y:.11,state:'controlled',lastTouch:p.id});return {s,p};}
test('each skill moves both teams and keeps nearby possession without manufacturing a pass or shot',()=>{
 for(const team of [0,1])for(const skill of ['ballRoll','bodyFeint','fakeShot']){
  const {s,p}=carrier(team),inputs=idle();inputs[team][skill]=true;stepMatch(s,inputs);assert.equal(p.skill?.kind,skill);
  for(let i=0;i<28;i++)stepMatch(s,idle());
  assert.equal(s.ball.owner,p.id);assert.ok(Math.hypot(p.x-20,p.z)>.35);assert.ok(Math.hypot(s.ball.x-p.x,s.ball.z-p.z)<1.1);
  assert.equal(s.stats.shots[team],0);assert.equal(s.stats.passes[team],0);
 }
});
test('fake shot cancels charge and does not release on button-up; cooldown and ownership prevent skill spam',()=>{
 const {s,p}=carrier();for(let i=0;i<20;i++)stepMatch(s,[{...neutralInput(),shoot:true},neutralInput()]);
 assert.ok(p.charge>0);stepMatch(s,[{...neutralInput(),shoot:true,fakeShot:true},neutralInput()]);assert.equal(p.charge,0);
 for(let i=0;i<35;i++)stepMatch(s,idle());assert.equal(s.stats.shots[0],0);
 stepMatch(s,[{...neutralInput(),ballRoll:true},neutralInput()]);assert.equal(p.skill,null);
 s.ball.owner=20;p.skillCooldown=0;stepMatch(s,[{...neutralInput(),ballRoll:true},neutralInput()]);assert.equal(p.skill,null);
});
test('skills cannot run at a restart and lose their lock immediately when tackled',()=>{
 const {s,p}=carrier();s.phase='restart';s.restart={type:'freeKick',team:0,taker:p.id,x:20,z:0};stepMatch(s,[{...neutralInput(),ballRoll:true},neutralInput()]);assert.equal(p.skill,null);
 s.phase='playing';s.restart=null;p.actionTime=0;stepMatch(s,idle());stepMatch(s,[{...neutralInput(),bodyFeint:true},neutralInput()]);assert.ok(p.skill);s.ball.owner=20;stepMatch(s,idle());assert.equal(p.skill,null);
});
function penalty(team=0,half=1){
 const s=createMatch({humans:[true,true],duration:600});s.half=half;const attack=1-team,dir=(attack===0?1:-1)*(half===2?-1:1);
 s.phase='restart';s.phaseTime=2.1;s.restart={type:'penalty',team:attack,taker:attack*11+9,x:dir*41.5,z:0};s.selected=[9,20];
 for(const p of s.players)Object.assign(p,{x:0,z:28,cooldown:0});
 Object.assign(s.ball,{x:dir*41.5,z:0,y:.11,owner:null,lastTouch:attack*11+9,state:'dead'});
 return {s,p:s.players[team*11],team,dir};
}
test('manual keeper chooses screen directions at both ends, commits once and restores outfield selection',()=>{
 for(const team of [0,1])for(const half of [1,2])for(const side of [-1,0,1]){
  const {s,p,dir}=penalty(team,half),a={...neutralInput(),keeperAssist:false,mx:side,keeperDive:true};
  const ins=idle();ins[team]=a;updatePenaltyKeeper(s,ins,1/60);assert.equal(s.selected[team],p.id);assert.equal(s.penaltyKeeper.choice,side);
  for(let i=0;i<20;i++)updatePenaltyKeeper(s,ins,1/60);assert.ok(Math.abs(p.z-dir*side*2.55)<.4);assert.equal(manualKeeper(s,p),true);
  a.mx=-side;updatePenaltyKeeper(s,ins,1/60);assert.equal(s.penaltyKeeper.choice,side);
  s.phase='playing';s.restart=null;s.ball.lastShot=null;updatePenaltyKeeper(s,ins,1/60);assert.equal(p.penaltyDive,null);assert.equal(s.selected[team],team*11+9);
 }
});
test('penalty save contact requires the right side and timing, not a predicted target',()=>{
 const {s,p}=penalty(0),inputs=[{...neutralInput(),keeperAssist:false,keeperRight:true,keeperDive:true},neutralInput()];
 updatePenaltyKeeper(s,inputs,1/60);for(let i=0;i<20;i++)updatePenaltyKeeper(s,inputs,1/60);
 Object.assign(s.ball,{owner:null,lastTouch:20,lastShot:{team:1,penalty:{},tick:s.tick}});
 const from={x:-51.1,z:p.z,y:1,vx:-28,vy:0,vz:0},to={...from,x:-52.4};
 assert.ok(keeperContact(s,p,from,to));
 assert.equal(keeperContact(s,p,{...from,z:-p.z},{...to,z:-p.z}),null);
 for(let i=0;i<65;i++)updatePenaltyKeeper(s,inputs,1/60);
 assert.equal(keeperContact(s,p,from,to),null);
});
test('a correctly timed manual dive saves a real penalty; the opposite dive concedes',()=>{
 for(const side of [-1,1]){
  const {s}=penalty(0);s.restart.armed=true;s.restart.aimGoalZ=-2.45;s.restart.aimGoalY=.9;
  const keeper={...neutralInput(),keeperAssist:false,mx:side},shoot={...neutralInput(),shoot:true};
  for(let i=0;i<25;i++)stepMatch(s,[keeper,shoot]);
  stepMatch(s,[{...keeper,keeperDive:true},neutralInput()]);
  for(let i=0;i<80&&s.phase==='playing'&&s.stats.saves[0]===0;i++)stepMatch(s,[keeper,neutralInput()]);
  if(side===1){assert.equal(s.stats.saves[0],1);assert.equal(s.shotLog[0].outcome,'saved');}
  else{assert.equal(s.stats.saves[0],0);assert.equal(s.score[1],1);assert.equal(s.shotLog[0].outcome,'goal');}
 }
});
test('successive goalkeeper practice kicks vary their placement',()=>{
 const session=createPracticeSession({drill:'keeperPenalties'}),targets=new Set(),a={...neutralInput(),keeperAssist:false};
 for(let round=0;round<6;round++){
  session.step(a);session.step({...a,keeperReady:true});
  for(let i=0;i<300&&session.status.phase!=='feedback';i++)session.step(a);
  targets.add(Math.round(session.shots.at(-1).target.z));const old=session.status.round;
  while(session.status.round===old)session.step(a);
 }
 assert.ok(targets.size>=2);
});
test('assisted keeper leaves the AI in charge and penalty screen axes stay consistent through flight',()=>{
 const {s,p}=penalty();const ins=[{...neutralInput(),keeperAssist:false},neutralInput()];updatePenaltyKeeper(s,ins,1/60);
 ins[0].keeperAssist=true;updatePenaltyKeeper(s,ins,1/60);assert.equal(manualKeeper(s,p),false);assert.equal(s.selected[0],9);
 const camera=createCameraController();s.phase='playing';s.ball.lastShot={tick:s.tick,team:1,penalty:{x:-41.5,z:0,taker:20,half:1}};
 const a=camera.prepareInput({mx:1,mz:0,keeperDive:true,keeperAssist:false},s,{team:0,cameraMode:'third-person'});
 assert.equal(a.mx,1);assert.equal(a.mz,0);assert.equal(a.keeperDive,true);assert.equal(a.keeperAssist,false);assert.doesNotThrow(()=>validateInput(a));
});
test('goalkeeper practice waits for Ready, records one real kick, resets and retains shot history',()=>{
 const p=createPracticeSession({drill:'keeperPenalties'}),a={...neutralInput(),keeperAssist:false};
 for(let i=0;i<400;i++)p.step(a);assert.equal(p.status.attempts,0);assert.equal(p.state.phaseTime,0);
 p.step({...a,keeperReady:true});for(let i=0;i<200&&p.status.phase!=='feedback';i++)p.step(a);
 assert.equal(p.status.attempts,1);assert.equal(p.status.phase,'feedback');assert.equal(p.shots.length,1);
 for(let i=0;i<110;i++)p.step(a);assert.equal(p.status.round,2);assert.equal(p.status.attempts,1);assert.equal(p.shots.length,1);
 p.restart();assert.equal(p.status.attempts,0);assert.equal(p.shots.length,0);
});
test('real shots produce goal and save records, fake shots and passing produce no records',()=>{
 const practice=createPracticeSession({drill:'penalties'});practice.step(neutralInput());for(let i=0;i<25;i++)practice.step({...neutralInput(),shoot:true});assert.equal(practice.shots.length,0);practice.step(neutralInput());
 for(let i=0;i<150&&practice.status.phase!=='feedback';i++)practice.step(neutralInput());assert.equal(practice.shots.length,1);assert.equal(practice.shots[0].outcome,'saved');assert.match(practice.status.result,/keeper/i);
 const goal=createPracticeSession();Object.assign(goal.state.players[11],{x:-35,z:25});for(let i=0;i<25;i++)goal.step({...neutralInput(),shoot:true});goal.step(neutralInput());for(let i=0;i<150&&goal.status.phase!=='feedback';i++)goal.step(neutralInput());assert.equal(goal.shots[0].outcome,'goal');
});
test('shot outcomes are stable after saves or posts but a rebound goal wins; maps normalize both halves',()=>{
 const {s,p}=carrier();s.ball.lastShot={team:0,tick:0};recordShot(s,p,{power:.9});finishShot(s,'saved',{x:52,y:1,z:0});finishShot(s,'missed');assert.equal(s.shotLog[0].outcome,'saved');finishShot(s,'goal');assert.equal(s.shotLog[0].outcome,'goal');
 assert.deepEqual(mapShotPosition({x:30,z:5,dir:1}),mapShotPosition({x:-30,z:-5,dir:-1}));
 assert.match(shotFeedback({outcome:'missed',power:.95,end:{y:3,z:0}}),/less power/);
 assert.match(shotFeedback({outcome:'missed',power:.95,end:{y:1,z:5}}),/Wide/);
});
test('a defender clearing an incoming shot closes the old attempt instead of leaving it in flight',()=>{
 const {s,p}=carrier(1);s.ball.owner=null;s.ball.lastShot={team:0,tick:s.tick};s.ball.lastTouch=9;s.ballFlightTime=.4;
 recordShot(s,s.players[9],{power:.6});s.selected[1]=p.id;
 stepMatch(s,[neutralInput(),{...neutralInput(),clear:true}]);
 assert.equal(s.stats.clearances[1],1);assert.equal(s.shotLog[0].outcome,'blocked');assert.equal(s.ball.lastShot,null);
});
test('new intentions remain strict booleans through the authoritative protocol',()=>{
 for(const name of ['ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','keeperAssist']){
  assert.equal(validateInput({...neutralInput(),[name]:true})[name],true);
  assert.throws(()=>validateInput({...neutralInput(),[name]:'yes'}));
 }
});

