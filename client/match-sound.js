import {attackDirection} from '../shared/rules.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function soundCue(event){
 const base={power:event.power??.55,x:event.x??0,z:event.z??0};
 switch(event.type){
  case 'pass':case 'through':case 'loft':return {...base,kind:event.type};
  case 'shot':return {...base,kind:['finesse','chip','header','volley'].includes(event.kind)?event.kind:'shot'};
  case 'clearance':return {...base,kind:['header','volley'].includes(event.kind)?event.kind:'clearance'};
  case 'tackle':return {...base,kind:event.kind==='slide'?'slide':'tackle'};
  case 'save':return {...base,kind:event.kind==='parry'?'parry':'catch',reaction:event.isSave?'applause':null};
  case 'post':return {...base,kind:'post',reaction:'gasp'};
  case 'nearMiss':return {...base,kind:null,reaction:'gasp'};
  case 'goal':return {...base,kind:null,reaction:'goal'};
  case 'foul':case 'offside':return {...base,whistle:event.type};
  case 'halftime':case 'fulltime':return event.phase===event.type?{...base,whistle:event.type}:null;
  default:return null;
 }
}
export function attackThreat(s){
 if(!s||s.phase!=='playing')return 0;const actor=s.players[s.ball.owner??s.ball.lastTouch];if(!actor)return 0;
 const distance=52.5-s.ball.x*attackDirection(s,actor.team),central=1-clamp((Math.abs(s.ball.z)-10)/30,0,.8);
 return clamp((36-distance)/28,0,1)*central;
}
export function soundPosition(point,camera){
 if(!camera?.position||!camera?.target)return {pan:0,gain:1};
 const dx=camera.target.x-camera.position.x,dz=camera.target.z-camera.position.z,len=Math.hypot(dx,dz)||1,ox=point.x-camera.target.x,oz=point.z-camera.target.z;
 const pan=clamp((-dz*ox+dx*oz)/(len*(camera.mode==='third-person'?13:38)),-.8,.8),distance=Math.hypot(point.x-camera.position.x,point.z-camera.position.z);
 return {pan,gain:camera.mode==='third-person'?clamp(1.2-distance/65,.25,1):.8};
}
// Consume live authority, never the replay's visual snapshots. Stale reconnect
// events are discarded instead of being replayed as a loud burst.
export function createSoundDirector(){
 let sequence=0,tick=-1,phase=null;
 return {reset(){sequence=0;tick=-1;phase=null;},update(s,{audible=true}={}){
  if(!s)return {cues:[],threat:0};if(s.tick<tick){sequence=0;phase=null;}tick=s.tick;const cues=[];
  for(const e of s.audioEvents||[]){if(e.id<=sequence)continue;sequence=e.id;if(!audible||s.tick-e.tick>30)continue;const cue=soundCue(e);if(cue)cues.push(cue);}
  if(s.phase==='kickoff'&&phase!=='kickoff'&&audible)cues.push({whistle:'kickoff',x:0,z:0});
  phase=s.phase;return {cues,threat:audible?attackThreat(s):0};
 }};
}
