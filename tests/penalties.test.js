import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {penaltyScene} from '../shared/penalties.js';
import {shotAim,shotTrajectory} from '../shared/shooting.js';
import {createCameraController} from '../client/camera.js';
import {validateInput} from '../server/index.js';
import {createPracticeSession} from '../client/practice.js';

function fixture(team=0,half=1){
 const s=createMatch({humans:[true,true],seed:1}),dir=(team===0?1:-1)*(half===1?1:-1),p=s.players[team*11+9];
 s.half=half;s.phase='restart';s.phaseTime=2.1;s.time=(half-1)*s.halfDuration;s.restart={type:'penalty',team,taker:p.id,x:dir*41.5,z:0};
 Object.assign(s.ball,{x:dir*41.5,y:.11,z:0,owner:null,state:'dead'});p.attrs.shooting=100;stepMatch(s,[neutralInput(),neutralInput()]);return {s,p,dir,team};
}
function ticks(f,frames,input={}){for(let i=0;i<frames;i++){const inputs=[neutralInput(),neutralInput()];inputs[f.team]={...neutralInput(),...input};stepMatch(f.s,inputs);}}

test('penalty camera overrides every preference for either side and frames the complete goal, taker and ball',()=>{
 for(const team of [0,1])for(const half of [1,2])for(const cameraMode of ['broadcast','telebroadcast','third-person'])for(const aspect of [16/9,9/16]){
  const {s,p,dir}=fixture(team,half),options={cameraMode,team:1-team},copy=JSON.stringify(options),camera=createCameraController(),info=camera.update(s,options,aspect);
  assert.equal(info.mode,'penalty');assert.equal(JSON.stringify(options),copy);assert.ok((s.ball.x-info.position.x)*dir>7);
  const view=new THREE.PerspectiveCamera(info.fov,aspect,.1,700);view.position.set(info.position.x,info.position.y,info.position.z);view.lookAt(info.target.x,info.target.y,info.target.z);view.updateMatrixWorld();
  for(const point of [[dir*52.5,0,-3.66],[dir*52.5,2.44,3.66],[p.x,.05,p.z],[p.x,1.9,p.z],[s.ball.x,.11,0]]){
   const projected=new THREE.Vector3(...point).project(view);assert.ok(Math.abs(projected.x)<.95&&Math.abs(projected.y)<.95,JSON.stringify({aspect,point,projected}));
  }
  assert.equal(camera.update(s,{...options,replay:true},aspect).mode,cameraMode);
 }
});

test('penalty screen axes ignore orbit and choose stable horizontal and vertical targets in either half',()=>{
 for(const team of [0,1])for(const half of [1,2]){
  const f=fixture(team,half),camera=createCameraController(),options={team,cameraMode:'third-person'},input=camera.prepareInput({mx:1,mz:-1,lookYaw:2,lookPitch:1},f.s,options);
  assert.ok(input.mx>0&&input.mz<0);assert.equal(validateInput(input).mx,input.mx);ticks(f,90,input);
  assert.equal(f.s.restart.aimGoalZ,3.2*f.dir);assert.equal(f.s.restart.aimGoalY,2.18);const target=shotAim(f.s,f.p,{},.2).target;
  ticks(f,120,{shoot:true});assert.equal(f.s.phase,'restart');assert.deepEqual(shotAim(f.s,f.p,{},1).target,target);assert.equal(f.s.stats.shots[team],0);
  ticks(f,1);assert.equal(f.s.stats.shots[team],1);assert.equal(penaltyScene(f.s).taker,f.p.id);assert.equal(camera.update(f.s,options).mode,'penalty');
  f.s.ball.owner=(1-team)*11;assert.equal(camera.update(f.s,options).mode,'third-person');
 }
});

test('penalty trajectories reach the chosen goal height across power and shot styles',()=>{
 for(const half of [1,2])for(const y of [.25,1.1,2.18])for(const z of [-3.2,0,3.2])for(const power of [.18,.55,1])for(const kind of ['normal','finesse','chip']){
  const {s,p}=fixture(0,half);Object.assign(s.restart,{aimGoalZ:z,aimGoalY:y});const before=JSON.stringify(s),aim=shotAim(s,p,{[kind]:true},power),end=shotTrajectory(aim).at(-1);
  assert.equal(JSON.stringify(s),before);assert.equal(aim.target.y,y);assert.equal(aim.target.z,z);
  assert.ok(Math.abs(end.y-y)<.1,`${kind} ${power}: target ${y}, arrived ${end.y}`);assert.ok(Math.abs(end.z-z)<.1);
 }
});

test('AI penalties retain automatic shots and camera metadata without exposing the AI target guide',()=>{
 const f=fixture(1,2);f.s.options.humans[1]=false;ticks(f,1);
 assert.equal(f.s.phase,'playing');assert.equal(f.s.stats.shots[1],1);assert.equal(penaltyScene(f.s).team,1);
 const camera=createCameraController();assert.equal(camera.update(f.s,{cameraMode:'telebroadcast',team:0}).mode,'penalty');
 f.s.tick+=151;assert.equal(camera.update(f.s,{cameraMode:'telebroadcast',team:0}).mode,'telebroadcast');
 f.s.phase='kickoff';assert.equal(penaltyScene(f.s),null);
});

test('penalty practice waits indefinitely, counts real kicks and goals, then resets spot and target',()=>{
 const practice=createPracticeSession({drill:'penalties'});for(let i=0;i<1200;i++)practice.step(neutralInput());
 assert.equal(practice.status.round,1);assert.equal(practice.status.attempts,0);assert.equal(practice.state.phase,'restart');assert.equal(practice.state.time,0);
 for(let i=0;i<20;i++)practice.step({...neutralInput(),mx:1,mz:-1});
 for(let i=0;i<90;i++)practice.step({...neutralInput(),shoot:true});assert.equal(practice.status.attempts,0);practice.step(neutralInput());
 assert.equal(practice.status.attempts,1);assert.equal(practice.state.stats.shots[0],1);
 Object.assign(practice.state.players[11],{x:-35,z:20});
 for(let i=0;i<300&&practice.status.phase!=='feedback';i++)practice.step(neutralInput());
 assert.equal(practice.status.resultCode,'goal');assert.equal(practice.status.successes,1);assert.equal(practice.state.score[0],1);
 for(let i=0;i<90;i++)practice.step({...neutralInput(),shoot:true});
 assert.equal(practice.status.round,2);assert.equal(practice.status.attempts,1);assert.equal(practice.status.releaseRequired,true);assert.equal(practice.state.restart.aimGoalZ,0);assert.equal(practice.state.restart.aimGoalY,.95);
 assert.equal(practice.state.ball.x,41.5);assert.equal(practice.state.stats.shots[0],0);assert.equal(practice.state.score[0],0);
 practice.restart();assert.equal(practice.status.attempts,0);assert.equal(practice.status.successes,0);assert.equal(practice.drill,'penalties');
});

test('practice penalty saves and wrong-action feedback never award a goal or extra attempt',()=>{
 const practice=createPracticeSession({drill:'penalties'});practice.step(neutralInput());
 for(let i=0;i<10;i++)practice.step({...neutralInput(),shoot:true});practice.step(neutralInput());
 for(let i=0;i<300&&practice.status.phase!=='feedback';i++)practice.step(neutralInput());
 assert.equal(practice.status.attempts,1);assert.equal(practice.status.resultCode,'saved');assert.equal(practice.status.successes,0);assert.equal(practice.state.stats.saves[1],1);
 const wrong=createPracticeSession({drill:'penalties'});wrong.step(neutralInput());wrong.step({...neutralInput(),pass:true});
 assert.equal(wrong.status.resultCode,'instruction');assert.equal(wrong.status.attempts,0);assert.equal(wrong.status.successes,0);
});
