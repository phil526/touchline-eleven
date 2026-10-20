import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {aerialKind,aerialContact,aerialVelocity,aerialLift} from '../shared/aerial.js';
import {validateInput} from '../server/index.js';
import {NetworkClient} from '../client/network.js';
function fixture(kind='header',half=1){
 const s=createMatch({humans:[true,true],duration:360}),dir=half===1?1:-1;s.phase='playing';s.half=half;s.time=half===1?0:180;
 for(const p of s.players)Object.assign(p,{x:-dir*40,z:p.team?28:-28,cooldown:20,vx:0,vz:0});
 const p=s.players[9];Object.assign(p,{x:dir*33,z:0,facing:dir===1?0:Math.PI,cooldown:0});s.selected=[9,20];
 Object.assign(s.ball,{owner:null,lastTouch:8,state:'flight',x:p.x-dir*2,z:0,y:kind==='header'?2.55:1.2,vx:dir*8,vy:-.4,vz:0});s.ballFlightTime=1;
 return {s,p,dir};
}
function run(s,n,input=neutralInput()){for(let i=0;i<n;i++)stepMatch(s,[input,neutralInput()]);}
test('a timed tap strikes one real header or volley, with finite flight in both halves',()=>{
 for(const kind of ['header','volley'])for(const half of [1,2]){
  const {s,p,dir}=fixture(kind,half);assert.equal(aerialKind(s,p),kind);
  stepMatch(s,[{...neutralInput(),strike:true},neutralInput()]);assert.equal(p.anim,kind);assert.equal(s.stats.shots[0],0);
  run(s,25);assert.equal(s.stats.shots[0],1);assert.equal(s.stats[kind==='header'?'headers':'volleys'][0],1);assert.equal(s.ball.shotKind,kind);assert.ok(s.ball.vx*dir>0);
  assert.ok(['x','y','z','vx','vy','vz'].every(k=>Number.isFinite(s.ball[k])));
 }
});
test('an early or late attempt misses without attracting the ball or inventing a shot',()=>{
 for(const late of [false,true]){const {s,p}=fixture();s.ball.x=p.x+(late?2:-4);s.ball.vx=late?8:2;
  stepMatch(s,[{...neutralInput(),strike:true},neutralInput()]);run(s,45);assert.equal(s.stats.shots[0],0);assert.equal(p.aerial,null);
 }
});
test('holding shoot never repeats the aerial attempt',()=>{const {s,p}=fixture();run(s,60,{...neutralInput(),shoot:true});assert.equal(s.stats.shots[0],1);assert.equal(p.aerial,null);});
test('headers and volley clearances go upfield and are not recorded as shots',()=>{
 for(const kind of ['header','volley'])for(const half of [1,2]){const {s,dir}=fixture(kind,half);stepMatch(s,[{...neutralInput(),clear:true,mx:-dir},neutralInput()]);run(s,20);assert.equal(s.stats.clearances[0],1);assert.equal(s.stats.shots[0],0);assert.ok(s.ball.vx*dir>0);assert.equal(s.ball.curl,0);}
});
test('ground clearances work from possession or a reachable loose ball',()=>{
 for(const owned of [false,true]){const {s,p}=fixture();Object.assign(s.ball,{owner:owned?p.id:null,x:p.x+.4,y:.11,vx:0,vy:0});stepMatch(s,[{...neutralInput(),clear:true},neutralInput()]);assert.equal(s.stats.clearances[0],1);assert.ok(s.ball.vy>6);}
});
test('aerial contact applies offside before kicking and stopped play cancels the attempt',()=>{
 const {s,p}=fixture();s.offside={team:0,candidates:[p.id]};stepMatch(s,[{...neutralInput(),strike:true},neutralInput()]);run(s,25);assert.equal(s.stats.offsides[0],1);assert.equal(s.stats.shots[0],0);assert.equal(s.phase,'restart');assert.equal(p.aerial,null);
 const a=fixture();stepMatch(a.s,[{...neutralInput(),strike:true},neutralInput()]);a.s.phase='halftime';run(a.s,1);assert.equal(a.p.aerial,null);
});
test('swept contacts respect horizontal reach, jump height, timing and one-hit recovery',()=>{
 const {s,p}=fixture();p.aerial={kind:'header',age:.24,hit:false};const y=1.65+aerialLift(.24);
 assert.ok(aerialContact(s,p,{x:p.x-2,y,z:0},{x:p.x+2,y,z:0}));
 assert.equal(aerialContact(s,p,{x:p.x-2,y:4,z:0},{x:p.x+2,y:4,z:0}),null);
 assert.equal(aerialContact(s,p,{x:p.x-2,y,z:2},{x:p.x+2,y,z:2}),null);
 p.aerial.hit=true;assert.equal(aerialContact(s,p,{x:p.x-2,y,z:0},{x:p.x+2,y,z:0}),null);
});
test('better contact timing adds useful pace without mutating the match',()=>{
 const {s,p}=fixture(),before=JSON.stringify(s),point={x:33,y:2.1,z:0};
 const early=aerialVelocity(s,p,point,'header','shot',{},.2),perfect=aerialVelocity(s,p,point,'header','shot',{},1);
 assert.ok(Math.hypot(perfect.x,perfect.z)>Math.hypot(early.x,early.z));assert.equal(JSON.stringify(s),before);
});
test('AI attacks an arriving cross and contests it with the same contact rules',()=>{
 const {s}=fixture();s.options.humans[0]=false;run(s,30);assert.equal(s.stats.headers[0],1);assert.equal(s.stats.shots[0],1);
});
test('short strike and clearance taps survive network coalescing once',t=>{
 const c=new NetworkClient();t.after(()=>c.disconnect());const sent=[];c.room={phase:'playing'};c.send=m=>{sent.push(m);return true;};
 for(const key of ['strike','clear']){assert.throws(()=>validateInput({mx:0,mz:0,[key]:'yes'}));c.input({mx:0,mz:0,[key]:true});c.input({mx:0,mz:0});c.flushInput();assert.equal(validateInput(sent.at(-1).actions)[key],true);assert.equal(c.actions[key],false);}
});

test('an AI corner delivers an offside-exempt aerial ball to an attacker in the box',()=>{
 const {s}=fixture();s.options.humans[0]=false;s.phase='restart';s.phaseTime=1.99;s.restart={type:'corner',team:0,x:52.5,z:34,taker:8};Object.assign(s.ball,{x:52.5,z:34,y:.11,owner:null,vx:0,vy:0,vz:0});
 stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.phase,'playing');assert.equal(s.offside,null);assert.ok(s.ball.vy>9);assert.equal(s.stats.passes[0],1);
 const receiver=s.players[s.receiver[0]];assert.ok(receiver.x>35&&receiver.x<48&&Math.abs(receiver.z)<10);assert.notEqual(receiver.id,8);
});
test('a first-time aerial finish also completes the incoming pass',()=>{
 const {s}=fixture();s.passFrom=8;s.passTeam=0;stepMatch(s,[{...neutralInput(),strike:true},neutralInput()]);run(s,25);assert.equal(s.stats.completedPasses[0],1);assert.equal(s.stats.shots[0],1);
});
