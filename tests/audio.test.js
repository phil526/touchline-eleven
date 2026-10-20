import test from 'node:test';
import assert from 'node:assert/strict';
import {IMPACTS,WHISTLES,impactSamples,whistleSamples,gaspSamples,ambienceSamples} from '../client/sound-synthesis.js';
import {createSoundDirector,soundCue,attackThreat,soundPosition} from '../client/match-sound.js';
import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
const neutral=neutralInput();
function fixture(){const s=createMatch({humans:[true,true]});s.phase='playing';for(const p of s.players)Object.assign(p,{x:-35+p.slot,z:p.team?28:-28,cooldown:9});const p=s.players[9];Object.assign(p,{x:30,z:0,cooldown:0,charge:.7});s.selected[0]=9;Object.assign(s.ball,{x:30.5,y:.11,z:0,owner:9,lastTouch:9});return s;}
test('all contact variations have finite bounded samples and soft endpoints',()=>{
 const fingerprints=new Set();for(const kind of Object.keys(IMPACTS))for(let v=0;v<4;v++){
  const data=impactSamples(kind,22050,v);assert.ok(data.every(x=>Number.isFinite(x)&&Math.abs(x)<1));assert.ok(Math.abs(data[0])===0);assert.ok(Math.abs(data.at(-1))<.001);
  const energy=data.reduce((n,x)=>n+x*x,0);assert.ok(energy>.001);fingerprints.add(energy.toFixed(7));
 }assert.equal(fingerprints.size,Object.keys(IMPACTS).length*4);
});
test('whistle patterns have distinct pulse counts and silent gaps',()=>{
 const rate=22050;for(const [kind,pulses] of Object.entries(WHISTLES)){
  const data=whistleSamples(kind,rate);assert.ok(data.every(x=>Number.isFinite(x)&&Math.abs(x)<.4));
  for(const [start,length] of pulses)assert.ok(data.slice(Math.floor((start+.03)*rate),Math.floor((start+length-.03)*rate)).some(x=>Math.abs(x)>.02));
  for(let i=1;i<pulses.length;i++){const gap=(pulses[i-1][0]+pulses[i-1][1]+pulses[i][0])/2;assert.equal(data[Math.floor(gap*rate)],0);}
 }assert.equal(WHISTLES.fulltime.length,3);assert.equal(WHISTLES.halftime.length,2);
});
test('crowd fallback loops continuously and the gasp has finite energy',()=>{const bed=ambienceSamples();assert.ok(Math.abs(bed[0]-bed.at(-1))<1e-7);assert.ok(gaspSamples(22050).every(x=>Number.isFinite(x)&&Math.abs(x)<1));});
test('contact metadata survives later UI events and serialisation without changing physics inputs',()=>{
 for(const kind of ['normal','finesse','chip']){const s=fixture();s.players[9].shotType=kind;s.previous[0]={...neutral,shoot:true};stepMatch(s,[{...neutral,finesse:kind==='finesse',chip:kind==='chip'},neutral]);
  const e=JSON.parse(JSON.stringify(s)).audioEvents.find(e=>e.type==='shot');assert.ok(e);assert.equal(e.kind,kind);assert.ok(e.power>=.7);assert.equal(soundCue(e).kind,kind==='normal'?'shot':kind);assert.equal(s.ball.lastShot.team,0);
 }
});
test('a close shot wide produces a crowd cue without replacing the restart decision',()=>{
 const s=fixture();Object.assign(s.ball,{owner:null,x:52.3,z:5,y:1,vx:30,vy:0,vz:0,lastShot:{tick:0,team:0}});stepMatch(s,[neutral,neutral]);
 assert.equal(s.phase,'restart');assert.equal(s.restart.type,'goalKick');assert.ok(s.audioEvents.some(e=>e.type==='nearMiss'));assert.equal(s.event.type,'restart');
 const distant=fixture();Object.assign(distant.ball,{owner:null,x:52.3,z:18,y:1,vx:30,vy:0,vz:0,lastShot:{tick:0,team:0}});stepMatch(distant,[neutral,neutral]);assert.ok(!distant.audioEvents.some(e=>e.type==='nearMiss'));
});
test('missed headers stay silent, real headers carry their contact kind',()=>{
 for(const hit of [true,false]){const s=fixture(),p=s.players[9];Object.assign(p,{charge:0});Object.assign(s.ball,{owner:null,lastTouch:8,state:'flight',x:p.x-(hit?2:4),z:0,y:2.55,vx:hit?8:2,vy:-.4,vz:0});s.ballFlightTime=1;
  stepMatch(s,[{...neutral,strike:true},neutral]);for(let i=0;i<25;i++)stepMatch(s,[neutral,neutral]);
  const e=s.audioEvents.find(e=>e.type==='shot');if(hit){assert.equal(e.kind,'header');assert.equal(soundCue(e).kind,'header');}else assert.equal(e,undefined);
 }
});
test('audio event history remains bounded during a complete match',()=>{const s=createMatch({humans:[false,false],duration:20});for(let i=0;i<2400;i++)stepMatch(s,[null,null]);assert.ok(s.audioEvents.length<=24);assert.ok(s.audioSequence>=s.audioEvents.length);assert.equal(s.phase,'fulltime');});
test('director consumes all events once and skips muted or stale reconnect history',()=>{
 const d=createSoundDirector(),s=createMatch();s.phase='playing';s.tick=100;s.audioEvents=[{id:1,tick:60,type:'shot'},{id:2,tick:99,type:'shot',kind:'chip'},{id:3,tick:100,type:'goal'}];
 assert.deepEqual(d.update(s).cues.map(c=>c.kind||c.reaction),['chip','goal']);assert.equal(d.update(s).cues.length,0);
 s.audioEvents.push({id:4,tick:100,type:'foul'});assert.equal(d.update(s,{audible:false}).cues.length,0);assert.equal(d.update(s).cues.length,0);
 d.reset();s.audioEvents=[];s.tick=0;s.phase='kickoff';assert.equal(d.update(s).cues[0].whistle,'kickoff');assert.equal(d.update(s).cues.length,0);
});
test('second-half setup and ordinary restarts do not duplicate referee whistles',()=>{
 assert.equal(soundCue({type:'halftime',phase:'kickoff'}),null);assert.equal(soundCue({type:'restart',phase:'restart'}),null);
 assert.equal(soundCue({type:'halftime',phase:'halftime'}).whistle,'halftime');assert.equal(soundCue({type:'goal'}).whistle,undefined);
 assert.equal(soundCue({type:'save',isSave:false,kind:'catch'}).reaction,null);assert.equal(soundCue({type:'save',isSave:true,kind:'parry'}).reaction,'applause');
});
test('anticipation follows attacking direction after halftime and respects stoppages',()=>{
 const s=fixture();const first=attackThreat(s);s.half=2;s.ball.x=-s.ball.x;assert.equal(attackThreat(s),first);s.ball.x=0;assert.equal(attackThreat(s),0);s.phase='restart';s.ball.x=-50;assert.equal(attackThreat(s),0);
});
test('stereo placement follows the camera and close view attenuates distant contact',()=>{
 const camera={mode:'third-person',position:{x:0,z:10},target:{x:0,z:0}};
 assert.ok(soundPosition({x:5,z:0},camera).pan>0);assert.ok(soundPosition({x:-5,z:0},camera).pan<0);
 const flipped={...camera,position:{x:0,z:-10}};assert.ok(soundPosition({x:5,z:0},flipped).pan<0);
 assert.ok(soundPosition({x:0,z:0},camera).gain>soundPosition({x:40,z:0},camera).gain);
});
