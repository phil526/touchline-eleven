import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {shotAim,shotTrajectory} from '../shared/shooting.js';
import {goalLineOutcome} from '../shared/ball.js';

function fixture(team=0,half=1){
  const s=createMatch({humans:[true,true],duration:600});s.phase='playing';s.half=half;s.time=half===2?300:0;
  for(const p of s.players)Object.assign(p,{x:p.team?-44:44,z:p.team?-28:28,vx:0,vz:0,cooldown:100,actionTime:0,aiTime:100});
  const dir=(team===0?1:-1)*(half===1?1:-1),p=s.players[team*11+9];
  Object.assign(p,{x:dir*39,z:0,facing:dir===1?0:Math.PI,cooldown:0});s.selected[team]=p.id;
  Object.assign(s.ball,{x:p.x-dir*3,z:0,y:.11,vx:dir*12,vy:0,vz:0,owner:null,lastTouch:team*11+7,state:'free'});
  s.passTeam=team;s.passFrom=team*11+7;s.ballFlightTime=.5;
  return {s,p,dir,team};
}
function step(f,input={}){const a=[neutralInput(),neutralInput()];a[f.team]={...neutralInput(),...input};stepMatch(f.s,a);}

test('a tap before an incoming ground pass becomes exactly one first-time shot in both halves and teams',()=>{
  for(const team of [0,1])for(const half of [1,2]){
    const f=fixture(team,half);step(f,{shoot:true,strike:true,mz:-.7});assert.ok(f.p.firstTime);assert.equal(f.s.stats.shots[team],0);
    for(let i=0;i<24&&f.s.stats.shots[team]===0;i++)step(f);
    assert.equal(f.s.stats.shots[team],1);assert.equal(f.s.stats.completedPasses[team],1);assert.equal(f.s.ball.owner,null);assert.equal(f.p.receiveTime,0);assert.equal(Math.sign(f.s.ball.vx),f.dir);assert.match(f.s.event.text,/first-time/);assert.equal(f.p.anim,'shoot');
    for(let i=0;i<10;i++)step(f);assert.equal(f.s.stats.shots[team],1);
  }
});
test('first-time contact preserves the chosen finesse or chip after the button is released',()=>{
  for(const kind of ['finesse','chip']){const f=fixture();step(f,{shoot:true,[kind]:true});for(let i=0;i<24&&f.s.stats.shots[0]===0;i++)step(f);assert.equal(f.s.ball.shotKind,kind);}
});
test('a queued shot expires or cancels without firing on pause, switching, another action or a turnover',()=>{
  for(const reason of ['timeout','cancel','switch','pass','opponent','phase','disconnect']){
    const f=fixture();step(f,{shoot:true});assert.ok(f.p.firstTime);
    if(reason==='timeout')f.s.ball.vx=0;
    if(reason==='opponent')f.s.passTeam=1;
    if(reason==='phase')f.s.phase='goal';
    if(reason==='disconnect')stepMatch(f.s,[null,neutralInput()]);
    else step(f,{cancelCharge:reason==='cancel',switch:reason==='switch',pass:reason==='pass'});
    if(reason==='timeout')for(let i=0;i<30;i++)step(f);
    assert.equal(f.p.firstTime,null,reason);assert.equal(f.s.stats.shots[0],0,reason);
  }
});
test('distant, departing, high and opposition balls do not arm a ground first-time shot',()=>{
  for(const reason of ['far','away','high','opponent']){const f=fixture();if(reason==='far')f.s.ball.x-=12;if(reason==='away')f.s.ball.vx*=-1;if(reason==='high')f.s.ball.y=4;if(reason==='opponent')f.s.passTeam=1;step(f,{shoot:true});assert.equal(f.p.firstTime,null,reason);}
});
test('buffered first-time shots respect offside at the original pass release',()=>{
  const f=fixture();f.s.offside={team:0,candidates:[f.p.id]};step(f,{shoot:true});for(let i=0;i<24&&f.s.phase==='playing';i++)step(f);assert.equal(f.s.phase,'restart');assert.equal(f.s.stats.offsides[0],1);assert.equal(f.s.stats.shots[0],0);
});
test('holding Shoot through contact cannot fire twice',()=>{
  const f=fixture();for(let i=0;i<40;i++)step(f,{shoot:true});assert.equal(f.s.stats.shots[0],1);
});
test('first-time input reaches the intended receiver during the original passer follow-through',()=>{
  const f=fixture();f.s.selected[0]=7;f.s.players[7].actionTime=.3;f.s.pendingSwitch[0]={id:9,expires:f.s.tick+90};f.s.receiver[0]=9;
  step(f,{strike:true});assert.equal(f.s.selected[0],9);assert.ok(f.p.firstTime);
  for(let i=0;i<24&&f.s.stats.shots[0]===0;i++)step(f);assert.equal(f.s.stats.shots[0],1);
});
test('a short return transfers control on receipt before AI can shoot for the human',()=>{
  const f=fixture();f.s.selected[0]=7;f.s.players[7].actionTime=.3;f.s.pendingSwitch[0]={id:9,expires:90};f.s.receiver[0]=9;f.s.ball.x=f.p.x-.75;f.p.aiTime=0;
  step(f);assert.equal(f.s.ball.owner,9);assert.equal(f.s.selected[0],9);assert.equal(f.s.pendingSwitch[0],null);
  for(let i=0;i<12;i++)step(f);assert.equal(f.s.stats.shots[0],0);assert.equal(f.s.ball.owner,9);
});
test('the authority releases the exact assisted or unassisted preview when dispersion is zero',()=>{
  for(const shotAssist of [true,false]){
    const f=fixture();Object.assign(f.s.ball,{x:39.5,owner:9,vx:0});f.p.attrs.shooting=100;f.p.charge=.55;f.s.previous[0].shoot=true;
    const aim=shotAim(f.s,f.p,{mz:.5,shotAssist},.55);step(f,{mz:.5,shotAssist});
    assert.equal(f.s.stats.shots[0],1);assert.ok(Math.abs(f.s.ball.vx-aim.velocity.x*Math.exp(-.035/60))<1e-9);assert.ok(Math.abs(f.s.ball.vz-aim.velocity.z*Math.exp(-.035/60))<1e-9);
  }
});
test('clean close finishing reduces dispersion, while pressure, sprinting and poor balance still matter',()=>{
  const {s,p}=fixture();const clean=shotAim(s,p,{shotAssist:false},.5);assert.equal(clean.cleanFinish,true);
  p.facing=Math.PI;const turned=shotAim(s,p,{},.5);assert.equal(turned.cleanFinish,false);assert.ok(turned.spread>clean.spread*1.6);
  p.facing=0;p.vx=8;assert.equal(shotAim(s,p,{},.5).cleanFinish,false);p.vx=0;
  Object.assign(s.players[13],{x:p.x+2,z:p.z});assert.equal(shotAim(s,p,{},.5).cleanFinish,false);
});
test('optional corner assistance preserves the selected side, full aim, style and power in both directions',()=>{
  for(const team of [0,1])for(const half of [1,2])for(const kind of ['normal','finesse','chip']){
    const {s,p,dir}=fixture(team,half);Object.assign(s.ball,{x:p.x+dir*.5});
    for(const mz of [-.5,.5]){const a=shotAim(s,p,{mz,[kind]:true},.55),off=shotAim(s,p,{mz,[kind]:true,shotAssist:false},.55);assert.equal(a.assisted,true);assert.equal(off.assisted,false);assert.equal(Math.sign(a.target.z),Math.sign(mz));assert.ok(Math.abs(a.target.z)>Math.abs(off.target.z));assert.equal(a.kind,kind);assert.equal(a.power,.55);assert.equal(a.speed,off.speed);}
    for(const mz of [-1,1])assert.equal(shotAim(s,p,{mz},.5).target.z,mz*3.2);
    const a=shotAim(s,p,{mz:.8},.5);assert.equal(goalLineOutcome({axis:'x',...shotTrajectory(a).at(-1)}),'goal');
  }
});
test('neutral assisted aim favours space away from the keeper without affecting long shots or penalties',()=>{
  const {s,p}=fixture();Object.assign(s.players[11],{x:51,z:2.5});assert.ok(shotAim(s,p,{},.5).target.z<0);
  assert.equal(shotAim(s,p,{shotAssist:false},.5).target.z,0);
  p.x=20;assert.equal(shotAim(s,p,{},.5).assisted,false);
  s.phase='restart';s.restart={type:'penalty',team:0,taker:p.id,x:41.5,z:0,aimGoalZ:3.2};p.x=41.5;assert.equal(shotAim(s,p,{},.5).assisted,false);assert.equal(shotAim(s,p,{},.5).target.z,3.2);
});
