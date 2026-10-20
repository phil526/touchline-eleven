import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {MANUAL_RESTARTS,restartDirection,THROW_STANCE,aiThrowAim} from '../shared/restarts.js';
import {passPreview} from '../shared/passing.js';
import {shotAim,shotTrajectory} from '../shared/shooting.js';
import {shotPreview,passingPreview} from '../client/render.js';
import {createCameraController} from '../client/camera.js';
import {NetworkClient} from '../client/network.js';
import {validateInput} from '../server/index.js';

function fixture(type='freeKick',team=0,half=1){
 const s=createMatch({humans:[true,true],seed:8});s.phase='restart';s.half=half;s.phaseTime=0;
 const dir=(team===0?1:-1)*(half===1?1:-1),p=s.players[team*11+(type==='goalKick'?0:8)];
 const x=type==='corner'?dir*52.5:type==='goalKick'?-dir*47:type==='penalty'?dir*41.5:dir*20,z=['corner','throwIn'].includes(type)?34:0;
 s.restart={type,team,x,z,taker:p.id};Object.assign(s.ball,{x,z,y:.11,owner:null,vx:0,vy:0,vz:0});
 p.attrs.passing=p.attrs.shooting=100;return {s,p,team};
}
function tick(s,input={},count=1,team=s.restart?.team??0){for(let i=0;i<count;i++){const inputs=[neutralInput(),neutralInput()];inputs[team]=input===null?null:{...neutralInput(),...input};stepMatch(s,inputs);}}
function ready(f){tick(f.s,{},122);return f;}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

for(const type of MANUAL_RESTARTS.filter(type=>type!=='penalty'))test(`${type}: both teams and halves wait indefinitely with a stationary ball and clock`,()=>{
 for(const team of [0,1])for(const half of [1,2]){
  const {s,p}=fixture(type,team,half),{x,z}=s.restart;tick(s,{},600);
  assert.equal(s.phase,'restart');assert.equal(s.time,0);assert.equal(s.ball.x,x);assert.equal(s.ball.z,z);assert.equal(s.selected[team],p.id);
  assert.equal(s.stats.passes[team]+s.stats.shots[team],0);assert.equal(s.restart.armed,true);
  tick(s,{mx:0,mz:-1},10);close(p.facing,-Math.PI/2);close(p.x,x);close(p.z,z+(type==='throwIn'?THROW_STANCE:.65));close(s.ball.z,z);
  tick(s,{},10);assert.deepEqual(restartDirection(s),[0,-1]);
 }
});

for(const type of MANUAL_RESTARTS.filter(type=>type!=='penalty'))test(`${type}: pass holds at maximum and releases once along retained aim`,()=>{
 const {s,p}=ready(fixture(type));tick(s,{mx:0,mz:-1,passHold:true},100);
 assert.equal(s.phase,'restart');assert.equal(p.passCharge,1);const preview=passPreview(s,p,{},'pass',1);
 tick(s);assert.equal(s.phase,'playing');assert.equal(s.ball.owner,null);assert.equal(s.stats.passes[0],1);
 close(s.ball.vx,preview.velocity.x);close(s.ball.vz,preview.velocity.z);close(s.ball.vy,preview.velocity.y);
 if(type!=='freeKick')assert.equal(s.offside,null);else assert.equal(s.offside.team,0);
 if(type==='throwIn'){close(s.ball.y,1.8);assert.equal(p.anim,'throw');assert.equal(s.event.type,'throw');}
 tick(s,{},4);assert.equal(s.stats.passes[0],1);
});

test('short and long pass charges have different pace; lob and through remain available',()=>{
 const speeds=[];for(const frames of [8,55]){const {s}=ready(fixture());tick(s,{passHold:true,mx:-1},frames);tick(s);speeds.push(Math.abs(s.ball.vx));}
 assert.ok(speeds[1]>speeds[0]+8);
 for(const action of ['through','lob']){const {s}=ready(fixture('corner'));tick(s,{[action]:true,mx:-1});assert.equal(s.phase,'playing');assert.ok(s.ball.vx<0);assert.equal(s.stats.passes[0],1);assert.equal(s.offside,null);if(action==='lob')assert.ok(s.ball.vy>6);}
});

test('free kick, corner and goal kick can shoot in any direction with all shot styles',()=>{
 for(const type of ['freeKick','corner','goalKick'])for(const mode of ['normal','finesse','chip']){
  const {s,p}=ready(fixture(type));tick(s,{shoot:true,[mode]:true,mx:0,mz:-1},100);
  assert.equal(s.phase,'restart');assert.equal(p.charge,1);const preview=shotAim(s,p,{[mode]:true},1);
  assert.ok(shotTrajectory(preview).every(p=>Object.values(p).every(Number.isFinite)));
  tick(s);assert.equal(s.phase,'playing');assert.equal(s.stats.shots[0],1);assert.equal(s.ball.shotKind,mode);
  close(s.ball.vx,preview.velocity.x);close(s.ball.vz,preview.velocity.z);close(s.ball.vy,preview.velocity.y);
 }
});

test('shoot on a throw-in produces an elevated long throw instead of a shot',()=>{
 const {s,p}=ready(fixture('throwIn'));tick(s,{shoot:true,mz:-1},70);assert.equal(s.phase,'restart');
 assert.equal(shotPreview(s,{team:0,input:{shoot:true}}),null);
 assert.equal(passingPreview(s,{team:0,input:{shoot:true}}).kind,'lob');
 tick(s);assert.equal(s.stats.shots[0],0);assert.equal(s.stats.passes[0],1);close(s.ball.y,1.8);assert.ok(s.ball.vy>10);assert.ok(s.ball.vz<0);
});

test('held action at the whistle or during setup must release before a fresh attempt',()=>{
 for(const action of ['shoot','passHold','throughHold','lob']){
  const {s}=fixture();tick(s,{[action]:true},180);assert.equal(s.phase,'restart');tick(s);assert.equal(s.phase,'restart');
  tick(s,{[action]:true},20);if(action!=='lob')tick(s);assert.equal(s.phase,'playing');
 }
 const {s}=fixture();tick(s,{},3);tick(s,{shoot:true},30);tick(s,{},120);assert.equal(s.phase,'restart');
});

test('missing input, menu cancellation and stale network input cancel instead of releasing',()=>{
 for(const action of ['shoot','passHold','throughHold'])for(const cancellation of [null,{cancelCharge:true}]){
  const {s,p}=ready(fixture());tick(s,{[action]:true},25);tick(s,cancellation);tick(s,{},180);
  assert.equal(s.phase,'restart');assert.equal(p.charge,0);assert.equal(p.passCharge,0);assert.equal(s.stats.shots[0]+s.stats.passes[0],0);
  tick(s,{[action]:true},5);tick(s);assert.equal(s.phase,'playing');
 }
});

test('preview is pure, a waiting guide exists and shot/pass guides do not overlap',()=>{
 const {s,p}=ready(fixture());const before=JSON.stringify(s);assert.ok(passingPreview(s,{team:0}));assert.equal(JSON.stringify(s),before);
 tick(s,{shoot:true,mx:-1},10);assert.equal(passingPreview(s,{team:0,input:{shoot:true}}),null);assert.ok(shotPreview(s,{team:0,input:{shoot:true}}));
 assert.equal(shotPreview(s,{team:0,input:{shoot:true},menu:true}),null);
});

test('AI restarts including penalties continue automatically',()=>{
 for(const type of MANUAL_RESTARTS){
  const {s}=fixture(type);s.options.humans[0]=false;tick(s,{},121);
  assert.equal(s.phase,'playing');assert.equal(s.restart,null);assert.equal(s.stats.passes[0]+s.stats.shots[0],1);
 }
});

test('AI touchline exits produce overhead throws into the field for either team, side and half',()=>{
 for(const team of [0,1])for(const half of [1,2])for(const side of [-1,1]){
  const s=createMatch({humans:[false,false],seed:8});s.phase='playing';s.half=half;s.time=(half-1)*s.halfDuration;
  for(const p of s.players){p.x=p.team?40:-40;p.z=0;p.cooldown=100;}
  Object.assign(s.ball,{x:0,z:side*34.05,y:.2,vx:0,vz:side*15,vy:0,owner:null,lastTouch:(1-team)*11+9});
  tick(s);assert.equal(s.restart.type,'throwIn');assert.equal(s.restart.team,team);
  const p=s.players[s.restart.taker];tick(s,{},60);const waitTime=s.time;
  close(s.ball.y,1.8);assert.equal(s.ball.owner,p.id);assert.equal(s.ball.state,'dead');assert.ok(Math.sin(p.facing)*side<0);
  while(s.phase==='restart')tick(s);
  assert.equal(s.time,waitTime);assert.equal(p.anim,'throw');assert.equal(s.event.type,'throw');assert.equal(s.ball.owner,null);
  close(s.ball.y,1.8);assert.ok(s.ball.vy>1);assert.ok(s.ball.vz*side<0);assert.equal(s.offside,null);
  assert.equal(s.stats.passes[team],1);assert.equal(s.stats.shots[team],0);
  tick(s,{},10,team);assert.ok(Math.abs(s.ball.z)<34);assert.ok(s.ball.y>1.8);assert.equal(s.stats.passes[team],1);
 }
});

test('AI throw selects an infield teammate and its arc reaches that target',()=>{
 const {s,p}=fixture('throwIn');s.options.humans=[false,false];
 for(const q of s.players){q.x=-40;q.z=0;}
 const receiver=s.players[7];Object.assign(receiver,{x:22,z:22});tick(s,{},1);
 const before=JSON.stringify(s),aim=aiThrowAim(s,p);assert.equal(JSON.stringify(s),before);assert.equal(aim.receiverId,receiver.id);
 const t=aim.flightTime;close(aim.origin.x+aim.velocity.x*t,receiver.x);close(aim.origin.z+aim.velocity.z*t,receiver.z);
 close(aim.origin.y+aim.velocity.y*t-4.905*t*t,.11);
 while(s.phase==='restart')tick(s);
 assert.equal(s.receiver[0],receiver.id);assert.equal(s.passFrom,p.id);assert.equal(s.passTeam,0);
 assert.equal(p.anim,'throw');assert.equal(s.offside,null);
});

test('AI corners and goal kicks retain foot deliveries',()=>{
 for(const type of ['corner','goalKick']){
  const {s,p}=fixture(type);s.options.humans[0]=false;while(s.phase==='restart')tick(s);
  assert.equal(p.anim,'pass');close(s.ball.y,.11);assert.ok(s.ball.vy>1);assert.equal(s.offside,null);
 }
});

test('human penalties wait indefinitely, retain goal aim and release only on button-up in both halves',()=>{
 for(const team of [0,1])for(const half of [1,2])for(const aim of [-1,1]){
  const {s,p}=ready(fixture('penalty',team,half)),dir=(team===0?1:-1)*(half===1?1:-1);tick(s,{},600);
  assert.equal(s.phase,'restart');assert.equal(s.time,0);assert.equal(s.ball.x,dir*41.5);
  assert.ok(shotPreview(s,{team,input:{}}));assert.equal(passingPreview(s,{team,input:{}}),null);
  tick(s,{mx:aim},60);tick(s,{shoot:true},100);assert.equal(s.phase,'restart');assert.equal(p.charge,1);
  const preview=shotAim(s,p,{},1);close(preview.target.z,aim*dir*3.2);assert.ok(preview.velocity.x*dir>0);
  const keeper=s.players[(1-team)*11];close(keeper.x,dir*(52.5-.3));
  tick(s,{},1,team);assert.equal(s.phase,'playing');assert.equal(s.stats.shots[team],1);close(s.ball.vz,preview.velocity.z);assert.equal(s.ball.owner,null);
 }
});

test('a held action at the penalty whistle and cancelled penalty charges never fire',()=>{
 const {s,p}=fixture('penalty');tick(s,{shoot:true},240);assert.equal(s.phase,'restart');assert.equal(s.stats.shots[0],0);tick(s);
 tick(s,{shoot:true,mz:-1},25);tick(s,{cancelCharge:true});tick(s,{},180);assert.equal(p.charge,0);assert.equal(s.phase,'restart');
 tick(s,{shoot:true},25);tick(s,null);tick(s,{},180);assert.equal(s.stats.shots[0],0);assert.equal(s.phase,'restart');
 tick(s,{shoot:true,mz:1},25);tick(s);assert.equal(s.stats.shots[0],1);
});

test('cancellation survives camera mapping and network coalescing exactly once',t=>{
 const {s}=ready(fixture()),camera=createCameraController();const input=camera.prepareInput({cancelCharge:true},s,{cameraMode:'third-person'});
 assert.equal(validateInput(input).cancelCharge,true);assert.throws(()=>validateInput({mx:0,mz:0,cancelCharge:'yes'}));
 const c=new NetworkClient();t.after(()=>c.disconnect());const sent=[];c.room={phase:'playing'};c.send=m=>{sent.push(m);return true;};
 c.input(input);c.input(neutralInput());c.flushInput();assert.equal(sent[0].actions.cancelCharge,true);assert.equal(c.actions.cancelCharge,false);
});
