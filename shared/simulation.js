import { TEAMS, PITCH, FORMATION } from './config.js';
import { clamp, length, distance, normal, angleDiff } from './math.js';
import { attackDirection, getMatchClock, offsideAtRelease, foulAward, boundaryAward, challengeContacts } from './rules.js';
import { integrateBall, firstBoundaryCrossing, goalLineOutcome } from './ball.js';
import { chooseReceiver, selectPressers, formationTarget, keeperTarget } from './ai.js';
import { shotAim, withShotSpread, shotType } from './shooting.js';
import { passPreview, withPassSpread, PASS_CHARGE_SECONDS } from './passing.js';
import {aerialKind,aerialContact,aerialVelocity,AERIAL_DURATION} from './aerial.js';
import {isManualRestart,restartDirection,aiThrowAim,THROW_HEIGHT,THROW_STANCE,THROW_DURATION} from './restarts.js';
import { keeperContact } from './goalkeeping.js';
import {finishPossessionBurst,POSSESSION_BURST_MULTIPLIER} from './possession-burst.js';
import {updateFirstTime} from './first-time.js';
import {startOneTwo,pruneRuns,oneTwoTarget} from './one-two.js';
import {updatePenaltyAim} from './penalties.js';
import {startSkill,updateSkill,skillBallOffset} from './skills.js';
import {recordShot,finishShot,settleShot} from './shot-log.js';
import {updatePenaltyKeeper,manualKeeper} from './keeper-control.js';

export { attackDirection, getMatchClock };

const {halfLength:HL,halfWidth:HW,ballRadius:BR} = PITCH;
// Per-second chance an AI defender lunges in without a clean route to the ball.
const AI_RASH_TACKLE_RATE = 0.12;
const validTactic = x => ['defensive','balanced','attacking'].includes(x)?x:'balanced';
function random(s) { s.rng=(Math.imul(s.rng,1664525)+1013904223)>>>0; return s.rng/4294967296; }
function recordSound(s,type,data={}) {
  s.audioSequence=(s.audioSequence||0)+1;s.audioEvents??=[];
  s.audioEvents.push({id:s.audioSequence,tick:s.tick,type,phase:s.phase,x:s.ball.x,z:s.ball.z,...data});
  if(s.audioEvents.length>24)s.audioEvents.splice(0,s.audioEvents.length-24);
}
function event(s,type,text,audio={}) { s.event={id:(s.event?.id||0)+1,type,text};recordSound(s,type,audio); }

export function neutralInput() {return {mx:0,mz:0,sprint:false,jockey:false,pass:false,through:false,passHold:false,throughHold:false,lob:false,shoot:false,finesse:false,chip:false,strike:false,clear:false,tackle:false,slide:false,switch:false,oneTwo:false,ballRoll:false,bodyFeint:false,fakeShot:false,keeperLeft:false,keeperRight:false,keeperCentre:false,keeperDive:false,keeperReady:false,keeperAssist:true,cancelCharge:false,shotAssist:true};}
function clearPassCharge(p) {p.passCharge=0;p.passType=null;}
export function createMatch(options={}) {
  const duration=Number.isFinite(options.duration)?clamp(options.duration,20,3600):360;
  const settings={duration,difficulty:options.difficulty==='easy'?'easy':'standard',humans:[options.humans?.[0]??true,options.humans?.[1]??false],tactics:[validTactic(options.tactics?.[0]),validTactic(options.tactics?.[1])]};
  const s={tick:0,time:0,half:1,halfDuration:duration/2,phase:'kickoff',phaseTime:0,score:[0,0],selected:[9,20],players:[],ball:{x:0,y:BR,z:0,vx:0,vy:0,vz:0,owner:null,state:'dead',curl:0,lastTouch:null},event:{id:1,type:'kickoff',text:'Welcome to Meridian Ground'},restart:null,options:settings,rng:(options.seed??1729)>>>0,receiver:[null,null],pendingSwitch:[null,null],offside:null,kickoffTeam:0,previous:[neutralInput(),neutralInput()],stats:{shots:[0,0],headers:[0,0],volleys:[0,0],clearances:[0,0],passes:[0,0],completedPasses:[0,0],tackles:[0,0],saves:[0,0],fouls:[0,0],offsides:[0,0],possession:[0,0]},passFrom:null,passTeam:null,ballFlightTime:0};
  s.audioEvents=[];s.audioSequence=0;s.shotLog=[];s.shotSequence=0;
  s.passHoldLatch=[false,false];s.runs=[null,null];
  TEAMS.forEach((team,t)=>team.players.forEach((data,slot)=>s.players.push({...data,attrs:{...data.attrs},id:t*11+slot,team:t,slot,x:0,z:0,vx:0,vz:0,facing:t===0?0:Math.PI,stamina:1,anim:'idle',aerial:null,actionTime:0,actionDuration:0,charge:0,shotType:null,passCharge:0,passType:null,passLatch:false,cooldown:0,touchTime:0,touchTick:-100,touchFoot:slot%2,receiveTime:0,controlMode:'normal',shielding:false,firstTime:null,holdTime:0,aiTime:0,shotLatch:false,slideTime:0,slideDir:{x:0,z:0},slideHit:false,slideSpeed:0,slideReach:0,targetX:0,targetZ:0})));
  kickoffPositions(s,0);
  return s;
}
function kickoffPositions(s,team) {
  s.offside=null;s.receiver=[null,null];s.pendingSwitch=[null,null];s.passFrom=null;s.passTeam=null;
  s.passHoldLatch=[false,false];s.runs=[null,null];
  for(const p of s.players) {
    const dir=attackDirection(s,p.team); const [ax,az]=FORMATION[p.slot];
    p.x=dir*(p.slot>7?-Math.abs(ax)*0.6:ax);p.z=az*dir;p.vx=0;p.vz=0;p.facing=dir>0?0:Math.PI;p.anim='idle';p.actionTime=0;p.actionDuration=0;p.charge=0;p.shotType=null;p.cooldown=0;p.shotLatch=false;p.touchTime=0;p.receiveTime=0;p.touchTick=-100;p.controlMode='normal';p.slideTime=0;p.aerial=null;p.slideHit=false;
    clearPassCharge(p);p.passLatch=false;p.possessionBurst=0;p.savePenalty=null;p.skill=null;p.skillCooldown=0;p.penaltyDive=null;
  }
  const taker=s.players[team*11+9];taker.x=-attackDirection(s,team)*0.65;taker.z=0;
  const support=s.players[team*11+7];support.x=-attackDirection(s,team)*3;support.z=4;
  s.selected[team]=taker.id;s.selected[1-team]=(1-team)*11+6;
  Object.assign(s.ball,{x:0,y:BR,z:0,vx:0,vy:0,vz:0,owner:null,state:'dead',curl:0,lastTouch:null});
  s.kickoffTeam=team;
}
function cleanInput(input) {
  const i=neutralInput(); if(!input||typeof input!=='object')return i;
  i.mx=Number.isFinite(input.mx)?clamp(input.mx,-1,1):0;i.mz=Number.isFinite(input.mz)?clamp(input.mz,-1,1):0;
  const mag=length(i.mx,i.mz);if(mag>1){i.mx/=mag;i.mz/=mag;}
  for(const k of ['sprint','jockey','pass','through','passHold','throughHold','lob','shoot','finesse','chip','strike','clear','tackle','slide','switch','oneTwo','ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','cancelCharge'])i[k]=input[k]===true;
  i.shotAssist=input.shotAssist!==false;i.keeperAssist=input.keeperAssist!==false;
  return i;
}
function requestAutoSwitch(s,team,id) {
  if(!s.options.humans[team])return;
  const current=s.players[s.selected[team]];
  if(current.id!==id&&(current.actionTime>0||current.charge>0||current.passCharge>0))s.pendingSwitch[team]={id,expires:s.tick+90};
  else {s.selected[team]=id;s.pendingSwitch[team]=null;}
}
function penaliseOffsideInvolvement(s,p) {
  if(s.offside?.team===p.team&&s.offside.candidates.includes(p.id)) {
    s.stats.offsides[p.team]++;event(s,'offside',`${p.name} is offside`);
    beginRestart(s,'freeKick',1-p.team,p.x,p.z,`Offside: ${p.name} was beyond the ball and second-last defender when the ball was played.`,'offside');return true;
  }
  return false;
}
function setOwner(s,p,keeper=false) {
  if(penaliseOffsideInvolvement(s,p))return false;
  if(s.passFrom!==null&&s.passTeam===p.team&&s.passFrom!==p.id)s.stats.completedPasses[p.team]++;
  s.passFrom=null;s.passTeam=null;s.offside=null;s.receiver=[null,null];
  finishShot(s,p.role==='GK'?'saved':s.players[s.ball.lastShot?.team*11]?.team!==p.team?'blocked':'missed');
  s.ball.lastShot=null;s.ball.curl=0;s.ball.owner=p.id;s.ball.lastTouch=p.id;s.ball.state=keeper?'held':'controlled';p.touchTime=0;p.holdTime=0;
  s.pendingSwitch[1-p.team]=null;
  // Possession must belong to the human immediately, even if the passer's
  // follow-through is still playing. Otherwise AI can act on a short return.
  if(s.options.humans[p.team]){s.selected[p.team]=p.id;s.pendingSwitch[p.team]=null;}
  if(keeper){s.ball.vx=0;s.ball.vy=0;s.ball.vz=0;}
  return true;
}
function releaseBall(s,p,vx,vy,vz,anim) {
  finishShot(s,s.ball.lastShot?.team!==p.team?'blocked':'missed');
  Object.assign(s.ball,{owner:null,lastShot:null,curl:0,state:vy>1?'flight':'free',vx,vy,vz,lastTouch:p.id});
  p.anim=anim;p.actionTime=p.actionDuration=0.32;p.cooldown=0.42;p.charge=0;p.shotType=null;p.receiveTime=0;p.touchTime=0.15;p.touchTick=s.tick;s.ballFlightTime=0;
  clearPassCharge(p);
}
function passBall(s,p,input,kind='pass',power=0,providedAim=null) {
  const throwing=s.phase==='restart'&&s.restart?.type==='throwIn';
  const base=providedAim||passPreview(s,p,input,kind,power);
  const offsetZ=(random(s)-0.5)*base.spread,offsetX=(random(s)-0.5)*base.spread;
  const aim=withPassSpread(base,offsetX,offsetZ),receiver=aim.receiverId===null?null:s.players.find(q=>q.id===aim.receiverId);
  s.offside=offsideAtRelease(s,p);
  if(throwing)Object.assign(s.ball,aim.origin);
  releaseBall(s,p,aim.velocity.x,aim.velocity.y,aim.velocity.z,throwing?'throw':'pass');
  if(throwing){p.actionTime=p.actionDuration=THROW_DURATION;p.cooldown=THROW_DURATION;p.facing=Math.atan2(aim.velocity.z,aim.velocity.x);s.offside=null;}
  s.receiver[p.team]=receiver?.id??null;s.passFrom=p.id;s.passTeam=p.team;s.stats.passes[p.team]++;
  const run=s.runs?.[p.team];
  if(run){if(p.id===run.receiver&&receiver?.id===run.runner){run.returned=true;run.expires=s.tick+180;}else s.runs[p.team]=null;}
  if(receiver)requestAutoSwitch(s,p.team,receiver.id);
  const giveAndGo=input.oneTwo===true&&kind==='pass'&&startOneTwo(s,p,receiver);
  event(s,throwing?'throw':kind==='lob'?'loft':kind,throwing?'Throw-in':giveAndGo?'One-two: passer making a forward run':kind==='through'?'Through ball':kind==='lob'?'Lofted pass':'Pass',{power});
}
function shootBall(s,p,input,power=0.55) {
  if(s.runs)s.runs[p.team]=null;
  const base=shotAim(s,p,input,power),aim=withShotSpread(base,(random(s)-0.5)*base.spread);
  s.offside=offsideAtRelease(s,p);releaseBall(s,p,aim.velocity.x,aim.velocity.y,aim.velocity.z,'shoot');s.ball.curl=aim.curl;s.ball.shotKind=aim.kind;s.ball.lastShot={tick:s.tick,team:p.team};s.stats.shots[p.team]++;
  recordShot(s,p,aim);
  if(base.penalty)s.ball.lastShot.penalty={x:s.restart.x,z:s.restart.z,taker:p.id,half:s.half};
  s.passFrom=null;s.passTeam=null;event(s,'shot',`${p.name} ${aim.kind==='finesse'?'curls a finesse shot':aim.kind==='chip'?'chips the keeper':'shoots'}`,{kind:aim.kind,power});
}
function startAerial(s,p,input,mode='shot') {
  const kind=aerialKind(s,p);if(!kind)return false;
  p.aerial={kind,mode,age:0,hit:false,input:{mx:input.mx||0,mz:input.mz||0}};
  p.anim=kind;p.actionTime=p.actionDuration=AERIAL_DURATION;p.cooldown=.8;p.charge=0;p.shotType=null;clearPassCharge(p);
  p.facing=mode==='shot'?Math.atan2(-p.z,attackDirection(s,p.team)*HL-p.x):Math.atan2(input.mz||0,attackDirection(s,p.team));
  return true;
}
function clearBall(s,p,input) {
  if(s.runs)s.runs[p.team]=null;
  const v=aerialVelocity(s,p,s.ball,'volley','clear',input);
  s.offside=offsideAtRelease(s,p);releaseBall(s,p,v.x,v.y,v.z,'clear');
  s.passFrom=s.passTeam=null;s.receiver=[null,null];s.stats.clearances[p.team]++;event(s,'clearance',`${p.name} clears upfield`,{kind:'clearance',power:.8});
}
function strikeAerial(s,p,c) {
  if(penaliseOffsideInvolvement(s,p))return;
  const a=p.aerial;if(!a)return;a.hit=true;
  if(s.runs)s.runs[p.team]=null;
  if(s.passTeam===p.team&&s.passFrom!==null&&s.passFrom!==p.id)s.stats.completedPasses[p.team]++;
  Object.assign(s.ball,c.point);const v=aerialVelocity(s,p,c.point,a.kind,a.mode,a.input,c.timing,random(s)-.5);
  s.offside=offsideAtRelease(s,p);releaseBall(s,p,v.x,v.y,v.z,a.kind);
  p.actionDuration=AERIAL_DURATION;p.actionTime=Math.max(.08,AERIAL_DURATION-a.age);
  s.passFrom=s.passTeam=null;s.receiver=[null,null];s.ball.shotKind=a.mode==='clear'?'clearance':a.kind;s.ball.lastShot=a.mode==='shot'?{tick:s.tick,team:p.team}:null;
  s.stats[a.kind==='header'?'headers':'volleys'][p.team]++;
  if(a.mode==='clear'){s.stats.clearances[p.team]++;event(s,'clearance',`${p.name} clears with a ${a.kind}`,{kind:a.kind,power:c.timing});}
  else {s.stats.shots[p.team]++;recordShot(s,p,{kind:a.kind,power:c.timing,origin:c.point});event(s,'shot',`${p.name} ${a.kind==='header'?'heads at goal':'hits a volley'}`,{kind:a.kind,power:c.timing});}
}
function switchPlayer(s,team,mx=0,mz=0) {
  const b=s.ball;let best=-1,score=Infinity;
  for(const p of s.players) {
    if(p.team!==team||p.role==='GK')continue;
    const d=length(p.x-(b.x+b.vx*0.23),p.z-(b.z+b.vz*0.23));
    const axis=normal(p.x-b.x,p.z-b.z); const value=d+(p.id===s.selected[team]?3:0)-(mx*axis[0]+mz*axis[1])*2;
    if(value<score){score=value;best=p.id;}
  }
  if(best>=0)s.selected[team]=best;
  s.pendingSwitch[team]=null;
}
function foulDescription(offender,victim,sliding,fromBehind) {
  if(sliding)return fromBehind?{kind:'slideBehind',label:'Slide from behind',reason:`Slide from behind: ${offender.name}'s slide went through ${victim.name} before the ball.`}
    :{kind:'lateSlide',label:'Late slide',reason:`Late slide: ${offender.name}'s slide took ${victim.name}'s legs before the ball.`};
  return fromBehind?{kind:'trip',label:'Trip from behind',reason:`Trip from behind: ${offender.name}'s standing tackle caught ${victim.name}'s heels before the ball.`}
    :{kind:'lateTackle',label:'Late standing tackle',reason:`Late standing tackle: ${offender.name} contacted ${victim.name}'s legs before the ball.`};
}
function foul(s,offender,victim,sliding=false,fromBehind=false) {
  s.stats.fouls[offender.team]++;const award=foulAward(s,victim),at={x:victim.x,z:victim.z};
  const {kind,label,reason}=foulDescription(offender,victim,sliding,fromBehind);
  event(s,'foul',award.type==='penalty'?`Penalty to ${TEAMS[victim.team].abbr}`:`Foul by ${offender.name}`);
  beginRestart(s,award.type,award.team,award.x,award.z,reason,'foul');
  // Presentation-only detail: who was involved and where the contact happened.
  s.restart.foul={offender:offender.id,victim:victim.id,x:at.x,z:at.z,kind,label};
}
function resolveChallenge(s,p,start,end,sliding=false) {
  const contact=challengeContacts(s,p,start,end,sliding);
  if(contact.ballFirst) {
    if(penaliseOffsideInvolvement(s,p))return true;
    const owner=s.ball.owner===null?null:s.players[s.ball.owner];
    s.stats.tackles[p.team]++;
    const [nx,nz]=normal(end.x-start.x,end.z-start.z),speed=sliding?10:4.5;
    Object.assign(s.ball,{owner:null,curl:0,state:'free',vx:nx*speed,vy:sliding?0.55:0.35,vz:nz*speed,lastTouch:p.id});
    s.offside=null;s.receiver=[null,null];s.passFrom=null;s.passTeam=null;s.ballFlightTime=0;
    if(owner)owner.cooldown=Math.max(owner.cooldown,0.5);
    event(s,'tackle',`${p.name} ${sliding?'slides to clear':'wins'} the ball${contact.contested?' in a close challenge':''}`,{kind:sliding?'slide':'tackle'});return true;
  }
  // Light edge contact from the front or side is play-on: the tackle simply misses.
  if(contact.opponent&&!contact.light){foul(s,p,contact.opponent,sliding,contact.fromBehind);return true;}
  return false;
}
function standingTacklePath(p,facing=p.facing) {
  const nx=Math.cos(facing),nz=Math.sin(facing),reach=1.2+p.attrs.tackling/500;
  return [{x:p.x+nx*0.2,z:p.z+nz*0.2},{x:p.x+nx*reach,z:p.z+nz*reach}];
}
function tackle(s,p) {
  if(p.cooldown>0||p.actionTime>0)return;
  p.anim='tackle';p.actionTime=p.actionDuration=0.55;p.cooldown=1.15;
  resolveChallenge(s,p,...standingTacklePath(p));
}
function startSlide(p,input) {
  if(p.cooldown>0||p.actionTime>0)return;
  const moving=length(p.vx,p.vz),aimed=length(input.mx,input.mz)>0.2;
  const [nx,nz]=aimed?normal(input.mx,input.mz):moving>0.4?normal(p.vx,p.vz):[Math.cos(p.facing),Math.sin(p.facing)];
  p.slideDir={x:nx,z:nz};p.slideTime=0.48;p.slideReach=0.2;p.slideHit=false;
  p.slideSpeed=clamp(5.5+p.attrs.pace*0.015+moving*0.15,5.5,8.4);
  p.anim='slide';p.actionTime=p.actionDuration=0.85;p.cooldown=1.5;p.charge=0;p.shotType=null;p.receiveTime=0;
  p.facing=Math.atan2(nz,nx);p.vx=nx*p.slideSpeed;p.vz=nz*p.slideSpeed;p.stamina=clamp(p.stamina-0.025,0,1);
}
function updateSlide(s,p,dt) {
  const {x:nx,z:nz}=p.slideDir,oldX=p.x,oldZ=p.z,oldReach=p.slideReach;
  p.facing=Math.atan2(nz,nx);p.controlMode='normal';
  if(p.slideTime>0) {
    const speed=p.slideSpeed*(0.35+0.65*p.slideTime/0.48);
    p.vx=nx*speed;p.vz=nz*speed;p.slideReach=Math.min(0.95,oldReach+dt*6);
    p.x=clamp(p.x+p.vx*dt,-HL-1.5,HL+1.5);p.z=clamp(p.z+p.vz*dt,-HW-1.5,HW+1.5);
    p.slideTime=Math.max(0,p.slideTime-dt);
    if(!p.slideHit)p.slideHit=resolveChallenge(s,p,{x:oldX+nx*oldReach,z:oldZ+nz*oldReach},{x:p.x+nx*p.slideReach,z:p.z+nz*p.slideReach},true);
  } else {
    p.vx*=Math.exp(-dt*12);p.vz*=Math.exp(-dt*12);
    p.x=clamp(p.x+p.vx*dt,-HL-1.5,HL+1.5);p.z=clamp(p.z+p.vz*dt,-HW-1.5,HW+1.5);
  }
}
function beginRestart(s,type,team,x,z,reason='',reasonCode=null) {
  finishShot(s,'missed');s.penaltyKeeper=null;for(const p of s.players){p.skill=null;p.penaltyDive=null;}
  s.phase='restart';s.phaseTime=0;s.offside=null;s.passFrom=null;s.passTeam=null;s.receiver=[null,null];s.pendingSwitch=[null,null];
  const dir=attackDirection(s,team);
  if(type==='goalKick'){x=-dir*(HL-5.5);z=clamp(z,-9,9);}
  let eligible=s.players.filter(p=>p.team===team&&(type==='goalKick'?p.role==='GK':p.role!=='GK'));
  if(type==='penalty')eligible=eligible.sort((a,b)=>b.attrs.shooting-a.attrs.shooting);
  else eligible.sort((a,b)=>length(a.x-x,a.z-z)-length(b.x-x,b.z-z));
  const taker=eligible[0];
  s.restart={type,team,x:clamp(x,-HL,HL),z:clamp(z,-HW,HW),taker:taker.id,reason,reasonCode};
  Object.assign(s.ball,{x:s.restart.x,y:BR,z:s.restart.z,vx:0,vy:0,vz:0,owner:null,curl:0,state:'dead'});
  for(const p of s.players){p.vx=0;p.vz=0;p.charge=0;p.shotType=null;p.anim='idle';p.actionTime=0;p.receiveTime=0;p.slideTime=0;p.aerial=null;clearPassCharge(p);p.shotLatch=false;p.passLatch=false;}
  s.selected[team]=taker.id;
  if(type!=='penalty'&&s.event.type!=='offside'&&s.event.type!=='foul')event(s,'restart',`${type==='throwIn'?'Throw-in':type==='goalKick'?'Goal kick':type==='corner'?'Corner':'Free kick'} · ${TEAMS[team].abbr}`);
}
function manualRestart(s,dt,input) {
  const r=s.restart,p=s.players[r.taker];s.selected[r.team]=p.id;
  if(r.type==='penalty')updatePenaltyAim(s,input?.cancelCharge?null:input,dt);
  const [nx,nz]=restartDirection(s,input||{});r.aimX=nx;r.aimZ=nz;
  const throwing=r.type==='throwIn',stance=throwing?THROW_STANCE:.65;
  p.x=r.x-nx*stance;p.z=r.z-nz*stance;p.facing=Math.atan2(nz,nx);p.vx=p.vz=0;p.cooldown=0;
  if(r.type==='penalty'){const dir=attackDirection(s,p.team);p.x=r.x-dir*.65;p.z=r.z+dir*.55;}
  Object.assign(s.ball,{x:r.x,z:r.z,y:throwing?THROW_HEIGHT:BR,owner:p.id,lastTouch:p.id,state:'dead',vx:0,vy:0,vz:0});
  if(!input||input.cancelCharge){p.charge=0;p.shotType=null;clearPassCharge(p);r.armed=false;return;}
  const held=input.shoot||input.passHold||input.throughHold||input.pass||input.through||input.lob||input.clear||input.strike;
  if(!r.armed){p.charge=0;clearPassCharge(p);if(!held)r.armed=true;return;}
  if(s.phaseTime<2){p.charge=0;clearPassCharge(p);if(held)r.armed=false;return;}
  let action=null,power=0;
  if(input.passHold||input.throughHold){const kind=input.throughHold?'through':'pass';p.charge=0;p.shotType=null;if(p.passType!==kind){p.passCharge=0;p.passType=kind;}p.passCharge=clamp(p.passCharge+dt/PASS_CHARGE_SECONDS,0,1);}
  else if(p.passType&&p.passCharge>0){action=p.passType;power=p.passCharge;}
  else if(input.pass||input.through){action=input.through?'through':'pass';}
  else if(input.lob){action='lob';power=.55;}
  else if(input.shoot){p.shotType=shotType(input);p.charge=clamp(p.charge+dt/.95,0,1);}
  else if(p.charge>0){action=r.type==='throwIn'?'lob':'shot';power=Math.max(.18,p.charge);}
  else if(input.strike){action=r.type==='throwIn'?'lob':'shot';power=.18;}
  if(!action)return;
  const type=r.type,shotInput={...input,finesse:p.shotType==='finesse',chip:p.shotType==='chip'};
  // Compute release while the restart still supplies its persistent aim.
  if(action==='shot')shootBall(s,p,shotInput,power);else passBall(s,p,input,action,power);
  if(['throwIn','goalKick','corner'].includes(type))s.offside=null;
  s.phase='playing';s.phaseTime=0;s.restart=null;
  s.passHoldLatch[p.team]=false;p.passLatch=false;p.shotLatch=!!input.shoot;
}
function restartUpdate(s,dt,inputs) {
  const r=s.restart;if(!r)return;
  const dir=attackDirection(s,r.team),taker=s.players[r.taker];
  taker.x=r.x-dir*0.65;taker.z=r.z;taker.facing=dir>0?0:Math.PI;
  if(r.type==='penalty')taker.z=r.z+dir*.55;
  if(r.type==='corner'){
    const attackers=s.players.filter(p=>p.team===r.team&&p.slot>=7&&p.id!==taker.id);
    attackers.forEach((p,i)=>{p.x=dir*(HL-10-i%2*3);p.z=(i-1)*5;});
    s.players.filter(p=>p.team!==r.team&&[2,3,5].includes(p.slot)).forEach((p,i)=>{p.x=dir*(HL-8-i%2*3);p.z=(i-1)*5+1.2;});
    const keeper=s.players.find(p=>p.team!==r.team&&p.role==='GK');keeper.x=dir*(HL-1);keeper.z=Math.sign(r.z)*1.2;
  }
  for(const p of s.players) {
    if(p.id===r.taker)continue;
    const d=distance(p,s.ball);
    const minDist=p.team!==r.team?(r.type==='penalty'?10:9.15):2;
    if(d<minDist){let [nx,nz]=normal(p.x-r.x,p.z-r.z);if(d<0.01){nx=-dir;nz=(p.slot%2?1:-1)*0.5;}p.x=clamp(r.x+nx*minDist,-HL+0.5,HL-0.5);p.z=clamp(r.z+nz*minDist,-HW+0.5,HW-0.5);}
    if(r.type==='penalty') {
      if(p.team!==r.team&&p.role==='GK'){p.x=dir*(HL-0.3);p.z=0;}
      else if(p.x*dir>HL-17.5)p.x=dir*(HL-17.5);
    }
  }
  if(r.type==='penalty')updatePenaltyKeeper(s,inputs,dt);
  if(isManualRestart(s)){manualRestart(s,dt,inputs[r.team]);return;}
  if(r.type==='throwIn'){
    const aim=aiThrowAim(s,taker),[nx,nz]=normal(aim.velocity.x,aim.velocity.z);
    taker.x=r.x-nx*THROW_STANCE;taker.z=r.z-nz*THROW_STANCE;taker.facing=Math.atan2(nz,nx);taker.vx=taker.vz=0;
    Object.assign(s.ball,{...aim.origin,owner:taker.id,lastTouch:taker.id,state:'dead',vx:0,vy:0,vz:0});
    if(s.phaseTime<2)return;
    passBall(s,taker,neutralInput(),'pass',aim.power,aim);
    s.phase='playing';s.phaseTime=0;s.restart=null;return;
  }
  if(s.phaseTime<2.0)return;
  if(r.type==='penalty'){
    // Choose independently of a human's dive and vary repeat penalty attempts.
    if(s.options.humans[1-r.team]){r.aimGoalZ=[-2.45,0,2.45][Math.floor(random(s)*3)];r.aimGoalY=.55+random(s)*.9;}
    else {const keeper=s.players.find(p=>p.team!==r.team&&p.role==='GK');r.aimGoalZ=keeper?.z>0?-2.6:2.6;r.aimGoalY=.8;}
    shootBall(s,taker,neutralInput(),.65);s.phase='playing';s.phaseTime=0;s.restart=null;return;
  }
  s.phase='playing';s.phaseTime=0;s.ball.owner=taker.id;s.ball.state='controlled';s.ball.lastTouch=taker.id;s.restart=null;
  if(r.type==='corner'){
    const target=s.players.find(p=>p.team===r.team&&p.role==='ST'&&p.id!==taker.id)||s.players.find(p=>p.team===r.team&&p.slot>=7&&p.id!==taker.id);
    const flight=1.8;
    releaseBall(s,taker,(target.x-s.ball.x)/flight,4.905*flight+(1.8-s.ball.y)/flight,(target.z-s.ball.z)/flight,'pass');
    s.receiver[r.team]=target.id;s.passFrom=taker.id;s.passTeam=r.team;s.stats.passes[r.team]++;requestAutoSwitch(s,r.team,target.id);event(s,'loft','Corner into the penalty area',{power:.75});
  }
  else passBall(s,taker,neutralInput(),r.type==='corner'?'lob':r.type==='goalKick'?'lob':'pass');
  // Offside does not apply directly from throw-ins, corners or goal kicks.
  if(['throwIn','corner','goalKick'].includes(r.type))s.offside=null;
}
function scoreGoal(s,team) {
  if(s.phase!=='playing')return;
  finishShot(s,s.ball.lastShot?.team===team?'goal':'missed');s.score[team]++;s.phase='goal';s.phaseTime=0;s.kickoffTeam=1-team;s.offside=null;
  s.ball.owner=null;s.ball.state='dead';s.ball.vx=0;s.ball.vy=0;s.ball.vz=0;
  for(const p of s.players) {p.vx=0;p.vz=0;p.anim=p.team===team?'celebrate':'idle';p.actionTime=p.actionDuration=2.8;p.charge=0;p.shotType=null;p.receiveTime=0;p.slideTime=0;p.aerial=null;}
  event(s,'goal',`GOAL · ${TEAMS[team].name}`);
  s.event.team=team;
}
function advanceBall(s,dt) {
  const b=s.ball,old={...b};
  if(b.owner!==null)b.curl=0;
  if(b.owner!==null) {
    const p=s.players[b.owner];
    if(b.state==='held') {b.x=p.x+Math.cos(p.facing)*0.35;b.z=p.z+Math.sin(p.facing)*0.35;b.y=1.15;b.vx=p.vx;b.vz=p.vz;b.vy=0;return;}
    p.touchTime-=dt;
    const d=distance(p,b);
    if(d>3.2||b.y>1.5){b.owner=null;b.state='free';}
    else {
      const speed=length(p.vx,p.vz),skill=p.attrs.control/100,close=p.controlMode==='close',sprint=p.controlMode==='sprint';
      const skillOffset=skillBallOffset(p);
      const lead=skillOffset?.lead??(close?0.34+speed*0.02:sprint?0.72+speed*0.075:0.4+speed*0.03);
      if(p.touchTime<=0){if(speed>0.35){p.touchFoot=1-(p.touchFoot||0);p.touchTick=s.tick;}p.touchTime=(close?0.14:sprint?0.3:0.18)+(1-skill)*(sprint?0.08:0.05);}
      const side=skillOffset?.side??((p.touchFoot===0?-1:1)*(close?0.08:0.11));
      const tx=p.x+Math.cos(p.facing)*lead-Math.sin(p.facing)*side,tz=p.z+Math.sin(p.facing)*lead+Math.cos(p.facing)*side;
      const gain=close?17:sprint?7.5:14,ex=(tx-b.x)*gain,ez=(tz-b.z)*gain;
      const reachSpeed=close?7+skill*4:sprint?5+skill*3:6+skill*4;
      const correction=Math.min(1,reachSpeed/(length(ex,ez)||1));
      const response=1-Math.exp(-dt*(p.receiveTime>0?22+skill*6:close?28:sprint?14:24));
      b.vx+=(p.vx+ex*correction-b.vx)*response;b.vz+=(p.vz+ez*correction-b.vz)*response;b.lastTouch=p.id;
    }
  }
  integrateBall(b,dt);
  s.ballFlightTime+=dt;
  if(b.owner===null)b.state=b.y>BR+0.1?'flight':'free';
  const crossing=firstBoundaryCrossing(old,b);
  const save=s.players.filter(p=>p.role==='GK').map(p=>({player:p,contact:keeperContact(s,p,old,b)})).filter(hit=>hit.contact&&hit.contact.t<(crossing?.t??Infinity)).sort((a,c)=>a.contact.t-c.contact.t)[0];
  const aerial=s.players.map(p=>({p,c:aerialContact(s,p,old,b)})).filter(h=>h.c&&h.c.t<(crossing?.t??Infinity)&&h.c.t<(save?.contact.t??Infinity)).sort((a,c)=>a.c.t-c.c.t||a.p.id-c.p.id)[0];
  if(aerial){strikeAerial(s,aerial.p,aerial.c);return;}
  if(save){
    if(save.contact.isSave)finishShot(s,'saved',save.contact.point);
    const p=save.player,c=save.contact;Object.assign(b,c.point);
    p.anim='save';p.actionTime=p.actionDuration=Math.max(c.recovery,.95);p.cooldown=c.cooldown;p.saveTarget={...c.saveTarget};
    p.saveOutcome=c.outcome==='catch'?'catch':'punch';p.saveFacing=Math.atan2(-(old.vz||0),-(old.vx||attackDirection(s,p.team)));
    p.saveVelocity={...c.velocity};
    p.savePenalty=b.lastShot?.penalty?{...b.lastShot.penalty,team:b.lastShot.team,savedAt:s.tick}:null;
    if(c.outcome==='catch'){
      if(setOwner(s,p,true)){if(c.isSave)s.stats.saves[p.team]++;event(s,'save',`${p.name} gathers`,{kind:'catch',isSave:c.isSave});}
    }else{
      Object.assign(b,{owner:null,curl:0,state:c.point.y>BR+.1?'flight':'free',vx:c.velocity.x,vy:c.velocity.y,vz:c.velocity.z,lastTouch:p.id});
      s.ballFlightTime=0;s.passFrom=s.passTeam=null;s.receiver=[null,null];
      if(c.isSave)s.stats.saves[p.team]++;event(s,'save',`${p.name} punches clear`,{kind:'parry',technique:'punch',isSave:c.isSave});
    }
    return;
  }
  if(crossing) {
    const outcome=goalLineOutcome(crossing);
    if(outcome==='post') {
      finishShot(s,'woodwork',crossing);
      b.curl=0;b.x=crossing.side*(HL-0.15);b.vx=-b.vx*0.62;b.vy*=0.7;b.owner=null;event(s,'post','Off the woodwork');return;
    }
    if(outcome==='goal'){scoreGoal(s,attackDirection(s,0)===crossing.side?0:1);return;}
    const shot=b.lastShot;if(crossing.axis==='x'&&shot&&s.tick-shot.tick<240&&attackDirection(s,shot.team)===crossing.side&&Math.abs(crossing.z)<8&&crossing.y<5.5)recordSound(s,'nearMiss');
    const award=boundaryAward(s,crossing);beginRestart(s,award.type,award.team,award.x,award.z);
  }
}
// Close control turns the body away from the nearest pressure. Existing foot-path
// collision rules still allow a clean tackle from an exposed side.
function shieldingDirection(s,p,close) {
  if(!close||p.charge>0||p.passCharge>0||p.actionTime>0||s.ball.owner!==p.id||s.ball.state==='held')return null;
  let nearest=null,best=2.3;
  for(const q of s.players)if(q.team!==p.team){const d=distance(p,q);if(d<best){nearest=q;best=d;}}
  return nearest?Math.atan2(p.z-nearest.z,p.x-nearest.x):null;
}
function movePlayer(p,ix,iz,sprint,jockey,dt,hasBall=false,shieldFacing=null) {
  if(p.anim==='throw'&&p.actionTime>0){p.vx=p.vz=0;return;}
  const mag=Math.min(1,length(ix,iz));const [nx,nz]=normal(ix,iz);
  const sprinting=sprint&&!jockey&&p.stamina>0.08,speed=length(p.vx,p.vz);
  p.controlMode=hasBall&&jockey?'close':hasBall&&sprinting?'sprint':'normal';p.shielding=Number.isFinite(shieldFacing);
  const burst=hasBall&&p.possessionBurst>0?POSSESSION_BURST_MULTIPLIER:1;
  const top=(4.7+p.attrs.pace*0.026)*(sprinting?1.22:1)*(jockey?(hasBall?0.8:0.6):1)*(hasBall?0.97:1)*burst;
  const turnAmount=speed>0.2?clamp(1-(p.vx*nx+p.vz*nz)/speed,0,2):0;
  const braking=mag<0.05?2:1+turnAmount*0.55;
  const maxDelta=(5.5+p.attrs.acceleration*0.065)*1.3*(p.actionTime>0?0.65:1)*braking*dt*burst;
  const tx=nx*mag*top,tz=nz*mag*top;const dx=tx-p.vx,dz=tz-p.vz;const dl=length(dx,dz);
  const factor=dl>maxDelta?maxDelta/dl:1;p.vx+=dx*factor;p.vz+=dz*factor;
  p.x=clamp(p.x+p.vx*dt,-HL-1.5,HL+1.5);p.z=clamp(p.z+p.vz*dt,-HW-1.5,HW+1.5);
  if(mag>0.1||p.shielding){const goal=p.shielding?shieldFacing:Math.atan2(nz,nx),turn=hasBall&&jockey?12:sprinting?9:11;p.facing+=clamp(angleDiff(goal,p.facing),-dt*turn,dt*turn);}
  if(sprinting&&mag>0.25&&p.stamina>0.08)p.stamina=clamp(p.stamina-dt*(0.035+(100-p.attrs.stamina)*0.00025),0,1);
  else p.stamina=clamp(p.stamina+dt*(mag>0.5?0.008:0.027),0,1);
  if(p.actionTime<=0)p.anim=p.receiveTime>0?'control':length(p.vx,p.vz)>0.4?(sprinting?'sprint':'run'):'idle';
}
function keeperAI(s,p,dt,isHuman) {
  const b=s.ball;
  if(b.owner===p.id&&b.state==='held') {
    if(isHuman)return null;
    p.holdTime+=dt;
    if(p.holdTime>1.5)passBall(s,p,neutralInput(),'pass');
    return [0,0,false];
  }
  const {x,z,sprint,mode}=keeperTarget(s,p);
  p.targetX=x;p.targetZ=z;p.keeperMode=mode;
  if(isHuman)return null;
  const [nx,nz]=normal(x-p.x,z-p.z);const scale=clamp(length(x-p.x,z-p.z),0,1);return[nx*scale,nz*scale,sprint];
}
function aiIntent(s,p,pressers,dt) {
  const b=s.ball,dir=attackDirection(s,p.team),owner=b.owner===null?null:s.players[b.owner];
  const easy=s.options.difficulty==='easy'&&s.options.humans[1-p.team];
  if(p.role==='GK')return keeperAI(s,p,dt,false)??[0,0,false];
  if(owner?.id===p.id) {
    p.aiTime-=dt; const goalDist=HL-p.x*dir;
    if(p.aiTime<=0&&p.cooldown<=0) {
      p.aiTime=easy?1.05:0.48+random(s)*0.35;
      const pressure=s.players.some(q=>q.team!==p.team&&distance(q,p)<3.7);
      if(goalDist<23&&Math.abs(p.z)<18)shootBall(s,p,neutralInput(),clamp(0.35+goalDist/45,0.4,0.85));
      else if(pressure||random(s)<0.26){const q=chooseReceiver(s,p,neutralInput());if(q&&q.x*dir>p.x*dir-5)passBall(s,p,neutralInput(),random(s)<0.22?'through':'pass');}
    }
    p.targetX=dir*(HL-5);p.targetZ=p.z*0.4;
    const [nx,nz]=normal(p.targetX-p.x,p.targetZ-p.z);return[nx,nz,!easy&&Math.abs(p.z)>10];
  }
  let {x:tx,z:tz,isPresser}=formationTarget(s,p,pressers),jockey=false,face=null;
  if(owner&&owner.team!==p.team&&distance(p,owner)<3) {
    // Commit only when the standing tackle would reach the ball before the body.
    const clean=challengeContacts(s,p,...standingTacklePath(p)).ballFirst;
    // A rare mistimed lunge keeps defending human rather than perfect.
    if(p.cooldown<=0&&(clean?random(s)<dt*(easy?0.7:1.6):distance(p,owner)<1.55&&random(s)<dt*AI_RASH_TACKLE_RATE))tackle(s,p);
    else if(!clean&&isPresser) {
      // Jockey: hold goal-side of a shielding attacker, otherwise step round to
      // the exposed ball side and face it so a clean angle opens up.
      const [gx,gz]=normal(-dir*HL-owner.x,-owner.z),[bx,bz]=normal(b.x-owner.x,b.z-owner.z);
      ({x:tx,z:tz}=owner.shielding?{x:owner.x+gx*1.6,z:owner.z+gz*1.6}:{x:b.x+bx,z:b.z+bz});
      jockey=true;face=Math.atan2(b.z-p.z,b.x-p.x);
    }
  }
  p.targetX=tx;p.targetZ=tz;
  const [nx,nz]=normal(tx-p.x,tz-p.z);const scale=clamp(length(tx-p.x,tz-p.z)*0.6,0,1);
  return[nx*scale,nz*scale,!jockey&&(!!oneTwoTarget(s,p)&&length(tx-p.x,tz-p.z)>2||isPresser&&!easy&&distance(p,b)>4),jockey,face];
}
function resolvePlayerCollisions(s) {
  for(let i=0;i<s.players.length;i++)for(let j=i+1;j<s.players.length;j++) {
    const a=s.players[i],b=s.players[j],dx=b.x-a.x,dz=b.z-a.z,d=length(dx,dz);
    if(d<0.64&&d>0.0001){const push=(0.64-d)*0.5;a.x-=dx/d*push;a.z-=dz/d*push;b.x+=dx/d*push;b.z+=dz/d*push;}
  }
}
function receiveBall(s) {
  if(s.ball.owner!==null||s.ball.y>1.2)return;
  const nearby=s.players.filter(p=>p.cooldown<=0&&distance(p,s.ball)<0.87).sort((a,b)=>distance(a,s.ball)-distance(b,s.ball));
  for(const p of nearby) {
    if(manualKeeper(s,p))continue; // Manual penalties use the timed glove contact above.
    if(p.id===s.ball.lastTouch&&s.ballFlightTime<0.25)continue;
    const speed=length(s.ball.vx-p.vx,s.ball.vz-p.vz);
    if(speed>25&&s.passTeam===null) {
      if(distance(p,s.ball)<0.58) {
        const [nx,nz]=normal(s.ball.x-p.x,s.ball.z-p.z);
        const dot=s.ball.vx*nx+s.ball.vz*nz;
        s.ball.curl=0;s.ball.vx=(s.ball.vx-2*dot*nx)*0.4;s.ball.vz=(s.ball.vz-2*dot*nz)*0.4;s.ball.vy=Math.max(1,s.ball.vy*0.5);s.ball.lastTouch=p.id;s.offside=null;
        finishShot(s,'blocked');event(s,'deflection',`${p.name} blocks the shot`);break;
      }
      continue;
    }
    const queued=s.ball.y<.32?p.firstTime:null;
    if(setOwner(s,p)){
      if(queued){p.firstTime=null;shootBall(s,p,queued.input,queued.power);p.shotLatch=true;s.event.text=`${p.name} hits a first-time ${s.ball.shotKind==='normal'?'shot':s.ball.shotKind+' shot'}`;break;}
      const retained=0.08+(1-p.attrs.control/100)*0.15;
      s.ball.vx=p.vx+(s.ball.vx-p.vx)*retained;s.ball.vz=p.vz+(s.ball.vz-p.vz)*retained;s.ball.vy=Math.min(0,s.ball.vy)*0.25;
      p.receiveTime=clamp(0.09+(1-p.attrs.control/100)*0.12+speed*0.0015,0.1,0.19);p.touchTime=0.12;p.touchTick=s.tick;p.anim='control';
    }
    break;
  }
}
function humanAction(s,p,input,previous,dt) {
  const owns=s.ball.owner===p.id;
  if(p.skill)return;
  if(!input.cancelCharge&&startSkill(s,p,input,previous))return;
  if(p.aerial&&p.actionTime>0)return;
  updateFirstTime(s,p,input,previous,dt);
  if(input.cancelCharge){p.charge=0;p.shotType=null;clearPassCharge(p);p.shotLatch=!!input.shoot;return;}
  if(input.clear&&p.cooldown<=0){
    if(owns){clearBall(s,p,input);return;}
    if(startAerial(s,p,input,'clear'))return;
    if(s.ball.owner===null&&s.ball.y<.32&&distance(p,s.ball)<1.05){if(!penaliseOffsideInvolvement(s,p))clearBall(s,p,input);return;}
  }
  if(!owns&&(input.strike||input.shoot&&!previous.shoot)&&startAerial(s,p,input))return;
  if(input.slide&&!previous.slide&&!owns){startSlide(p,input);if(p.anim==='slide')return;}
  if(input.tackle&&!owns)tackle(s,p);
  if(s.phase!=='playing')return;
  if(owns) {
    if(s.ball.state==='held'){p.holdTime+=dt;if(p.holdTime>3.5)passBall(s,p,input,'pass');}
    if(p.cooldown<=0) {
      if(input.oneTwo&&!previous.oneTwo&&p.role!=='GK'){passBall(s,p,input,'pass');return;}
      const heldType=p.passType==='pass'&&input.passHold?'pass':p.passType==='through'&&input.throughHold?'through':input.throughHold?'through':input.passHold?'pass':null;
      const passBlocked=!!s.passHoldLatch?.[p.team]||!!p.passLatch;
      if(heldType) {
        p.charge=0;p.shotType=null;
        if(!passBlocked) {
          if(p.passType!==heldType){clearPassCharge(p);p.passType=heldType;}
          p.passCharge=clamp((p.passCharge||0)+dt/PASS_CHARGE_SECONDS,0,1);
          if(p.passCharge>=1-1e-9){passBall(s,p,input,heldType,1);s.passHoldLatch[p.team]=true;p.passLatch=true;}
        }
      } else if(p.passType&&p.passCharge>0) {
        // A release pulse may accompany the held-button edge. Consume it once.
        if(!passBlocked)passBall(s,p,input,p.passType,p.passCharge);
        else clearPassCharge(p);
      } else if(input.pass&&!passBlocked)passBall(s,p,input,'pass');
      else if(input.through&&!passBlocked)passBall(s,p,input,'through');
      else if(input.lob)passBall(s,p,input,'lob');
      else if(input.shoot&&!p.shotLatch) {
        p.shotType=shotType(input);p.charge=clamp(p.charge+dt/0.95,0,1);
        if(p.charge>=1){shootBall(s,p,input,1);p.shotLatch=true;}
      } else if(!input.shoot&&previous.shoot&&p.charge>0)shootBall(s,p,{...input,finesse:p.shotType==='finesse',chip:p.shotType==='chip'},Math.max(0.18,p.charge));
    }
  } else {
    if(p.passCharge>0&&(input.passHold||input.throughHold))s.passHoldLatch[p.team]=true;
    p.charge=0;p.shotType=null;clearPassCharge(p);
  }
  if(!input.shoot)p.shotLatch=false;
}

function finishPassInput(s,actions,inputs) {
  for(let team=0;team<2;team++)if(!actions[team].passHold&&!actions[team].throughHold)s.passHoldLatch[team]=false;
  for(const p of s.players) {
    const eligible=(s.phase==='playing'||isManualRestart(s,p.team))&&s.ball.owner===p.id&&s.selected[p.team]===p.id&&inputs[p.team]!=null;
    if(p.firstTime&&(s.phase!=='playing'||s.selected[p.team]!==p.id||inputs[p.team]==null||s.ball.owner!==null))p.firstTime=null;
    if(!eligible) {
      p.charge=0;p.shotType=null;
      // Losing control cancels the charge instead of releasing a stale intent later.
      if(p.passCharge>0&&(actions[p.team].passHold||actions[p.team].throughHold))s.passHoldLatch[p.team]=true;
      clearPassCharge(p);
    }
    p.passLatch=!!s.passHoldLatch[p.team];
  }
}

export function stepMatch(s,inputs=[null,null],dt=1/60) {
  if(!Number.isFinite(dt)||dt<=0)return s;
  const possessionBefore=s.ball.owner,wasPlaying=s.phase==='playing';
  dt=Math.min(dt,0.05);s.tick++;s.phaseTime+=dt;
  const actions=[cleanInput(inputs[0]),cleanInput(inputs[1])];
  s.passHoldLatch??=[false,false];
  pruneRuns(s);
  for(const p of s.players)if(s.phase!=='playing'||s.selected[p.team]!==p.id||inputs[p.team]==null||actions[p.team].cancelCharge||actions[p.team].switch)p.firstTime=null;
  if(s.phase==='fulltime'){finishPassInput(s,actions,inputs);s.previous=actions;return s;}
  for(const p of s.players){p.skillCooldown=Math.max(0,(p.skillCooldown||0)-dt);if(p.skill&&(s.phase!=='playing'||s.ball.owner!==p.id)){p.skill=null;p.actionTime=0;}p.possessionBurst=Math.max(0,(p.possessionBurst||0)-dt);p.shielding=false;p.cooldown=Math.max(0,p.cooldown-dt);p.actionTime=Math.max(0,p.actionTime-dt);p.receiveTime=Math.max(0,(p.receiveTime||0)-dt);if(p.aerial){p.aerial.age+=dt;if(p.aerial.age>AERIAL_DURATION||s.phase!=='playing')p.aerial=null;}}
  for(let team=0;team<2;team++) {
    const pending=s.pendingSwitch[team];if(!pending)continue;
    const current=s.players[s.selected[team]];
    if(s.tick>pending.expires)s.pendingSwitch[team]=null;
    else if(current.actionTime<=0&&current.charge<=0&&!(current.passCharge>0)){s.selected[team]=pending.id;s.pendingSwitch[team]=null;}
  }
  if(s.phase==='kickoff') {
    if(s.phaseTime>=1.6){s.phase='playing';s.phaseTime=0;setOwner(s,s.players[s.kickoffTeam*11+9]);event(s,'kickoff',`${TEAMS[s.kickoffTeam].abbr} kick off`);}
  } else if(s.phase==='goal') {
    if(s.phaseTime>=3){kickoffPositions(s,s.kickoffTeam);s.phase='kickoff';s.phaseTime=0;}
  } else if(s.phase==='halftime') {
    if(s.phaseTime>=4){s.half=2;kickoffPositions(s,1);s.phase='kickoff';s.phaseTime=0;event(s,'halftime','Second half · teams change ends');}
  } else if(s.phase==='restart') restartUpdate(s,dt,inputs.map((i,t)=>i==null?null:actions[t]));
  else if(s.phase==='playing') {
    s.time=Math.min(s.options.duration,s.time+dt);
    if(s.ball.owner!==null)s.stats.possession[s.players[s.ball.owner].team]+=dt;
    // A shot request can take control of the intended receiver during the
    // passer's follow-through, so a short pass does not swallow first-time input.
    for(let team=0;team<2;team++){
      const a=actions[team],pending=s.pendingSwitch[team];
      if(s.options.humans[team]&&inputs[team]!=null&&pending&&s.ball.owner===null&&s.ball.y<.32&&s.passTeam===team&&s.receiver[team]===pending.id&&!a.cancelCharge&&!a.switch&&(a.strike||a.shoot&&!s.previous[team].shoot)){
        s.selected[team]=pending.id;s.pendingSwitch[team]=null;
      }
    }
    updatePenaltyKeeper(s,inputs.map((i,t)=>i==null?null:actions[t]),dt);
    const pressers=selectPressers(s);
    for(let team=0;team<2;team++)if(s.options.humans[team]&&actions[team].switch&&s.penaltyKeeper?.team!==team)switchPlayer(s,team,actions[team].mx,actions[team].mz);
    for(const p of s.players)if(p.passCharge>0&&(s.ball.owner!==p.id||s.selected[p.team]!==p.id||inputs[p.team]==null)) {
      if(actions[p.team].passHold||actions[p.team].throughHold)s.passHoldLatch[p.team]=true;
      clearPassCharge(p);
    }
    for(const p of s.players) {
      if(manualKeeper(s,p))continue;
      const human=s.options.humans[p.team]&&inputs[p.team]!=null&&s.selected[p.team]===p.id&&!(s.penaltyKeeper?.id===p.id&&s.penaltyKeeper.assisted);
      if(p.anim==='slide'&&p.actionTime>0)updateSlide(s,p,dt);
      else if(human) {
        if(p.role==='GK')keeperAI(s,p,dt,true);
        humanAction(s,p,actions[p.team],s.previous[p.team],dt);
        if(s.phase==='playing') {
          if(p.anim==='slide'&&p.actionTime>0)updateSlide(s,p,dt);
          else if(!updateSkill(s,p,dt))movePlayer(p,actions[p.team].mx,actions[p.team].mz,actions[p.team].sprint,actions[p.team].jockey,dt,s.ball.owner===p.id,shieldingDirection(s,p,actions[p.team].jockey));
        }
      } else {
        if(!p.aerial&&aerialKind(s,p)&&distance(p,{x:s.ball.x+s.ball.vx*.2,z:s.ball.z+s.ball.vz*.2})<1.5){
          const attacking=p.x*attackDirection(s,p.team)>22;
          startAerial(s,p,neutralInput(),attacking?'shot':'clear');
        }
        const [mx,mz,sprint,jockey,face]=aiIntent(s,p,pressers,dt);
        if(s.phase==='playing'){movePlayer(p,mx,mz,sprint,!!jockey,dt,s.ball.owner===p.id);if(Number.isFinite(face)&&p.actionTime<=0)p.facing+=clamp(angleDiff(face,p.facing),-dt*10,dt*10);}
      }
      if(s.phase!=='playing')break;
    }
    if(s.phase==='playing') {
      resolvePlayerCollisions(s);advanceBall(s,dt);
      if(s.phase==='playing')receiveBall(s);
    }
    if(s.time>=s.halfDuration*s.half&&s.phase!=='goal') {
      s.phase=s.half===1?'halftime':'fulltime';s.phaseTime=0;s.restart=null;s.ball.owner=null;s.ball.state='dead';s.ball.vx=s.ball.vy=s.ball.vz=0;
      for(const p of s.players){p.vx=p.vz=0;p.charge=0;p.shotType=null;p.anim='idle';p.actionTime=0;p.slideTime=0;p.aerial=null;}
      event(s,s.phase,s.half===1?'Half-time':'Full-time');
    }
  }
  pruneRuns(s);
  settleShot(s);
  finishPossessionBurst(s,possessionBefore,wasPlaying);
  finishPassInput(s,actions,inputs);
  s.previous=actions;return s;
}
