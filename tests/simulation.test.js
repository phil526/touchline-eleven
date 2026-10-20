import test from 'node:test';
import assert from 'node:assert/strict';
import {createMatch,stepMatch,neutralInput,attackDirection,getMatchClock} from '../shared/simulation.js';
import {PITCH,TEAMS} from '../shared/config.js';

const DT=1/60;
function ticks(s,n,inputs=[null,null]) {for(let i=0;i<n;i++)stepMatch(s,inputs,DT);return s;}
function live(options={}) {const s=createMatch({humans:[true,true],...options});s.phase='playing';s.phaseTime=0;return s;}
function clearPitch(s) {for(const p of s.players){p.x=-25+p.slot*4;p.z=p.team===0?-25:25;p.cooldown=10;p.vx=p.vz=0;}s.ball.owner=null;}
function own(s,id,x=0,z=0) {
  const p=s.players[id];Object.assign(p,{x,z,vx:0,vz:0,cooldown:0,facing:attackDirection(s,p.team)>0?0:Math.PI});s.selected[p.team]=id;
  Object.assign(s.ball,{x:x+attackDirection(s,p.team)*0.7,z,y:PITCH.ballRadius,owner:id,state:'controlled',lastTouch:id,vx:0,vz:0,vy:0});return p;
}
function invariants(s) {
  assert.equal(s.players.length,22);assert.equal(new Set(s.players.map(p=>p.id)).size,22);
  assert.equal(s.players.filter(p=>p.role==='GK').length,2);
  assert.ok(s.ball.owner===null||s.players[s.ball.owner]);
  assert.equal(s.players.filter(p=>p.id===s.ball.owner).length,s.ball.owner===null?0:1);
  for(const p of s.players){for(const k of ['x','z','vx','vz','facing','stamina'])assert.ok(Number.isFinite(p[k]),`${p.id}.${k}`);assert.ok(p.stamina>=0&&p.stamina<=1);assert.ok(Math.hypot(p.vx,p.vz)<=11.7,'Includes the bounded 30% possession burst and its braking');}
  for(const k of ['x','y','z','vx','vy','vz'])assert.ok(Number.isFinite(s.ball[k]),`ball.${k}`);
  assert.ok(s.ball.y>=0.1099);assert.ok(s.time>=0&&s.time<=s.options.duration);assert.ok(s.score.every(n=>Number.isInteger(n)&&n>=0));
  assert.doesNotThrow(()=>JSON.stringify(s));
}

test('two original teams have eleven distinct numbered starters and complete attributes',()=>{
  assert.equal(TEAMS.length,2);
  for(const t of TEAMS){assert.equal(t.players.length,11);assert.equal(new Set(t.players.map(p=>p.number)).size,11);for(const p of t.players)for(const key of ['pace','acceleration','stamina','control','passing','shooting','tackling','goalkeeping'])assert.ok(p.attrs[key]>=0&&p.attrs[key]<=100);}
  invariants(createMatch());
});
test('kickoff releases exactly one ball owner and dead time does not advance the clock',()=>{
  const s=createMatch();ticks(s,90);assert.equal(s.phase,'kickoff');assert.equal(s.time,0);ticks(s,10);assert.equal(s.phase,'playing');assert.ok(s.ball.owner!==null);assert.ok(s.time<0.1);invariants(s);
});
test('movement accelerates, analogue input is normalised, sprint uses stamina',()=>{
  const s=live();clearPitch(s);const p=own(s,9,-30,0);s.ball.owner=null;
  ticks(s,60,[{...neutralInput(),mx:1,mz:1,sprint:true},neutralInput()]);
  assert.ok(p.x>-27);assert.ok(p.z>3);assert.ok(Math.hypot(p.vx,p.vz)<11.7);assert.ok(p.stamina<1);
  const stamina=p.stamina;ticks(s,120,[neutralInput(),neutralInput()]);assert.ok(p.stamina>stamina);assert.ok(Math.hypot(p.vx,p.vz)<0.01);invariants(s);
});
test('short, through and lofted passes release the ball and identify a receiver',()=>{
  for(const [button,kind] of [['pass','pass'],['through','through'],['lob','loft']]) {
    const s=live();clearPitch(s);own(s,6);Object.assign(s.players[8],{x:15,z:0,cooldown:0});
    stepMatch(s,[{...neutralInput(),[button]:true,mx:1},neutralInput()]);
    assert.equal(s.stats.passes[0],1);assert.equal(s.ball.owner,null);assert.ok(s.ball.vx>5);assert.ok(s.receiver[0]!==null);assert.equal(s.event.type,kind);
    if(button==='lob')assert.ok(s.ball.vy>3);invariants(s);
  }
});
test('strong pass aim never silently targets a team-mate behind the aim',()=>{
  const s=live();clearPitch(s);own(s,6,0,0);
  for(const p of s.players.filter(p=>p.team===0&&p.id!==6)){p.x=-10;p.z=p.slot-5;}
  stepMatch(s,[{...neutralInput(),pass:true,mx:1},neutralInput()]);
  assert.equal(s.receiver[0],null);assert.ok(s.ball.vx>8);assert.ok(Math.abs(s.ball.vz)<1);
});
test('passing under pressure, while sprinting or facing away increases dispersion',()=>{
  function attempt(condition) {
    const s=live({seed:1});clearPitch(s);const passer=own(s,6,0,0);Object.assign(s.players[8],{x:15,z:0,cooldown:10});
    if(condition==='facing')passer.facing=Math.PI;
    if(condition==='pressure')Object.assign(s.players[14],{x:0,z:2,cooldown:10});
    stepMatch(s,[{...neutralInput(),pass:true,mx:1,sprint:condition==='sprint'},neutralInput()]);
    return Math.abs(s.ball.vz/s.ball.vx);
  }
  const clean=attempt('clean');assert.ok(clean>0);
  for(const condition of ['facing','pressure','sprint'])assert.ok(attempt(condition)>clean*1.4,condition);
});
test('automatic receiver switching waits for a committed kick animation',()=>{
  const s=live();clearPitch(s);own(s,6);Object.assign(s.players[8],{x:20,z:0,cooldown:10});
  stepMatch(s,[{...neutralInput(),pass:true,mx:1},neutralInput()]);
  const receiver=s.receiver[0];assert.ok(receiver!==null);assert.equal(s.selected[0],6);assert.equal(s.pendingSwitch[0].id,receiver);
  ticks(s,10,[neutralInput(),neutralInput()]);assert.equal(s.selected[0],6);
  ticks(s,12,[neutralInput(),neutralInput()]);assert.equal(s.selected[0],receiver);assert.equal(s.pendingSwitch[0],null);
});
test('shooting charges while held and releases on button-up, with auto release at cap',()=>{
  const s=live();clearPitch(s);const p=own(s,9,20,0);
  ticks(s,15,[{...neutralInput(),shoot:true},neutralInput()]);assert.ok(p.charge>0.2&&p.charge<0.4);assert.equal(s.stats.shots[0],0);
  stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.stats.shots[0],1);assert.equal(p.charge,0);assert.equal(s.ball.owner,null);assert.ok(s.ball.vx>20);
  const capped=live();clearPitch(capped);own(capped,9,10);ticks(capped,65,[{...neutralInput(),shoot:true},neutralInput()]);assert.equal(capped.stats.shots[0],1);
});
test('shot dispersion increases when facing away, moving or shooting from a narrow angle',()=>{
  function attempt(condition) {
    const s=live({seed:1});clearPitch(s);const p=own(s,9,20,condition==='angle'?20:0);
    if(condition==='facing')p.facing=Math.PI;
    if(condition==='motion')p.vx=6;
    p.charge=0.5;s.previous[0].shoot=true;
    const sourceX=s.ball.x,sourceZ=s.ball.z;
    const idealZ=Math.max(-1.8,Math.min(1.8,p.z*0.15));
    stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.stats.shots[0],1);
    return Math.abs(s.ball.vz/s.ball.vx*(PITCH.halfLength+3-sourceX)-(idealZ-sourceZ));
  }
  const clean=attempt('clean');assert.ok(clean>0);
  for(const condition of ['facing','motion','angle'])assert.ok(attempt(condition)>clean*1.1,condition);
});
test('switch action chooses another influential outfield player',()=>{
  const s=live();clearPitch(s);s.selected[0]=1;s.players[5].x=0;s.players[5].z=0;
  stepMatch(s,[{...neutralInput(),switch:true},neutralInput()]);assert.equal(s.selected[0],5);
});
test('whole-ball goal crossing scores once and freezes active time',()=>{
  const s=live();clearPitch(s);Object.assign(s.ball,{x:52.4,y:0.5,z:0,vx:30,vy:0,vz:0,lastTouch:9});
  stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.phase,'goal');assert.deepEqual(s.score,[1,0]);const time=s.time;
  ticks(s,120,[neutralInput(),neutralInput()]);assert.deepEqual(s.score,[1,0]);assert.equal(s.time,time);
});
test('ball must cross completely and posts prevent a goal',()=>{
  const s=live();clearPitch(s);Object.assign(s.ball,{x:52.4,y:0.5,z:0,vx:8,vy:0,vz:0});stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.phase,'playing');assert.deepEqual(s.score,[0,0]);
  const post=live();clearPitch(post);Object.assign(post.ball,{x:52.4,y:0.5,z:3.66,vx:30,vy:0,vz:0,lastTouch:9});stepMatch(post,[neutralInput(),neutralInput()]);assert.equal(post.ball.vx<0,true);assert.deepEqual(post.score,[0,0]);assert.equal(post.event.type,'post');
});
test('last touch correctly awards throw-ins, corners and goal kicks',()=>{
  for(const [x,z,lastTouch,type,team] of [[0,34.05,9,'throwIn',1],[52.4,10,9,'goalKick',1],[52.4,10,15,'corner',0]]) {
    const s=live();clearPitch(s);Object.assign(s.ball,{x,z,y:0.2,vx:x?30:0,vz:x?0:15,vy:0,lastTouch});stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.phase,'restart');assert.equal(s.restart.type,type);assert.equal(s.restart.team,team);invariants(s);
  }
});
test('a diagonal corner crossing is classified by the first boundary crossed',()=>{
  for(const [x,z,type] of [[52.50,34.05,'throwIn'],[52.58,34.0,'goalKick']]) {
    const s=live();clearPitch(s);Object.assign(s.ball,{x,z,y:0.2,vx:30,vz:30,vy:0,lastTouch:9});
    stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.restart.type,type);
  }
});
test('goals are assigned to the correct side after the end change',()=>{
  const s=live();s.half=2;s.time=s.halfDuration;clearPitch(s);Object.assign(s.ball,{x:-52.4,y:0.5,z:0,vx:-30,vy:0,vz:0,lastTouch:9});
  stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.phase,'goal');assert.deepEqual(s.score,[1,0]);assert.equal(s.event.team,0);
});
test('AI restart completes and exempt restarts clear offside',()=>{
  const s=live();s.options.humans=[false,false];clearPitch(s);Object.assign(s.ball,{x:0,z:34.05,y:0.2,vx:0,vz:15,vy:0,lastTouch:9});stepMatch(s,[neutralInput(),neutralInput()]);const time=s.time;
  ticks(s,121,[neutralInput(),neutralInput()]);assert.equal(s.phase,'playing');assert.equal(s.restart,null);assert.equal(s.offside,null);assert.ok(s.time-time<0.1);assert.equal(s.stats.passes[1],1);
});
test('offside is recorded on pass release and penalised only at involvement',()=>{
  const s=live();clearPitch(s);own(s,6,0,0);
  for(const p of s.players.filter(p=>p.team===1)){p.x=10;p.z=20;}
  Object.assign(s.players[11],{x:49,z:0});Object.assign(s.players[9],{x:20,z:0,cooldown:0});
  stepMatch(s,[{...neutralInput(),pass:true,mx:1},neutralInput()]);assert.ok(s.offside.candidates.includes(9));assert.equal(s.phase,'playing');
  Object.assign(s.ball,{x:s.players[9].x,z:s.players[9].z,y:0.11,vx:0,vy:0,vz:0,owner:null});s.players[9].cooldown=0;
  stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.phase,'restart');assert.equal(s.restart.team,1);assert.equal(s.stats.offsides[0],1);assert.equal(s.event.type,'offside');
  assert.equal(s.restart.reasonCode,'offside');assert.match(s.restart.reason,/second-last defender/);
});
test('mistimed contact in the penalty area awards a penalty',()=>{
  const s=live({seed:1});clearPitch(s);const victim=own(s,9,43,0);const defender=s.players[13];
  Object.assign(defender,{x:42.1,z:0,facing:0,cooldown:0});s.selected[1]=defender.id;victim.cooldown=1;
  stepMatch(s,[neutralInput(),{...neutralInput(),tackle:true}]);assert.equal(s.phase,'restart');assert.equal(s.restart.type,'penalty');assert.equal(s.restart.team,0);assert.equal(s.stats.fouls[1],1);
});
test('keeper catches only within finite reach and distributes held ball',()=>{
  const s=live({humans:[false,false]});clearPitch(s);const keeper=s.players[0];Object.assign(keeper,{x:-50,z:0,cooldown:0});
  Object.assign(s.ball,{x:-49.4,z:0,y:0.6,vx:-8,vz:0,vy:0,owner:null,lastTouch:20});stepMatch(s);assert.equal(s.ball.owner,0);assert.equal(s.ball.state,'held');
  ticks(s,105);assert.equal(s.stats.passes[0],1);assert.notEqual(s.ball.state,'held');invariants(s);
});
test('keeper cannot catch through a player or reach outside the penalty area',()=>{
  for(const scenario of ['blocked','outsideBox']) {
    const s=live({humans:[false,false]});clearPitch(s);const keeper=s.players[0];
    Object.assign(keeper,{x:scenario==='blocked'?-50:-36.2,z:0,cooldown:0});
    Object.assign(s.ball,{x:scenario==='blocked'?-48.5:-35.1,z:0,y:1,vx:0,vz:0,vy:0,owner:null,lastTouch:20});
    if(scenario==='blocked')Object.assign(s.players[2],{x:-49.2,z:0,cooldown:10});
    stepMatch(s);assert.notEqual(s.ball.state,'held',scenario);assert.equal(s.stats.saves[0],0);
  }
});
test('halftime changes ends once; fulltime freezes clock and supports serialisation',()=>{
  const s=live({duration:20});s.time=9.999;stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.phase,'halftime');assert.equal(attackDirection(s,0),1);
  ticks(s,245);assert.equal(s.half,2);assert.equal(attackDirection(s,0),-1);assert.equal(s.phase,'kickoff');assert.equal(s.ball.x,0);
  s.phase='playing';s.time=19.999;stepMatch(s,[neutralInput(),neutralInput()]);assert.equal(s.phase,'fulltime');assert.equal(getMatchClock(s),'90:00');const copy=JSON.parse(JSON.stringify(s));ticks(copy,20);assert.equal(copy.time,20);assert.deepEqual(copy.score,s.score);invariants(copy);
});
test('invalid inputs and invalid time steps cannot corrupt match state',()=>{
  const s=live();stepMatch(s,[{mx:Infinity,mz:NaN,shoot:'yes'},null]);stepMatch(s,[],NaN);stepMatch(s,[],Infinity);stepMatch(s,[],-1);invariants(s);
});
test('null human input falls back to AI; explicit neutral input keeps human control',()=>{
  const ai=live();const human=live();clearPitch(ai);clearPitch(human);const p1=own(ai,9);const p2=own(human,9);ai.ball.owner=null;human.ball.owner=null;ai.ball.x=human.ball.x=10;
  ticks(ai,30,[null,neutralInput()]);ticks(human,30,[neutralInput(),neutralInput()]);assert.ok(p1.x>p2.x+0.5);
});
test('seeded six-minute AI matches stay finite with productive attacks and working goals',()=>{
  const phases=new Set();let goals=0;
  // A scoreless draw is valid; require scoring across independent matches rather
  // than tying every movement adjustment to one seed's incidental scoreline.
  for(const seed of [1729,1]){
    const s=createMatch({humans:[false,false],duration:360,seed});
    for(let i=0;i<40000&&s.phase!=='fulltime';i++){stepMatch(s);phases.add(s.phase);if(i%120===0)invariants(s);}
    assert.equal(s.phase,'fulltime');assert.equal(s.time,360);assert.equal(s.half,2);
    assert.ok(s.stats.passes.reduce((a,b)=>a+b)>30);assert.ok(s.stats.shots.reduce((a,b)=>a+b)>5);assert.ok(s.stats.saves.reduce((a,b)=>a+b)>0);
    goals+=s.score.reduce((a,b)=>a+b);invariants(s);
  }
  for(const p of ['kickoff','playing','restart','goal','halftime','fulltime'])assert.ok(phases.has(p),p);assert.ok(goals>0);
});
