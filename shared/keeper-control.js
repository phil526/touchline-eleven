import {PITCH} from './config.js';
import {attackDirection} from './rules.js';
import {clamp} from './math.js';

export function defendingPenalty(s,team){
  if(s?.phase==='restart'&&s.restart?.type==='penalty'&&s.restart.team!==team)return s.restart;
  const shot=s?.ball?.lastShot;
  if(s?.phase==='playing'&&shot?.penalty&&shot.team!==team&&s.ball.owner===null&&s.tick-shot.tick<120&&s.ball.lastTouch!==team*11)return {...shot.penalty,team:shot.team};
  return null;
}
export function updatePenaltyKeeper(s,inputs,dt){
  let team=[0,1].find(t=>s.options.humans[t]&&inputs[t]!=null&&defendingPenalty(s,t));
  const old=s.penaltyKeeper;
  if(team===undefined){
    if(old){const p=s.players[old.id];p.penaltyDive=null;if(s.selected[old.team]===old.id&&s.ball.owner!==old.id)s.selected[old.team]=old.previousSelected;s.penaltyKeeper=null;}
    return;
  }
  const input=inputs[team],p=s.players[team*11],scene=defendingPenalty(s,team),dir=attackDirection(s,scene.team);
  if(!old||old.team!==team){s.penaltyKeeper={id:p.id,team,choice:0,committed:false,age:0,previousSelected:s.selected[team],assisted:input.keeperAssist===true};}
  const k=s.penaltyKeeper;k.assisted=input.keeperAssist===true;
  // An assisted goalkeeper retains the existing released-ball AI and finite reach.
  if(k.assisted){p.penaltyDive=null;if(s.selected[team]===p.id)s.selected[team]=k.previousSelected;return;}
  s.selected[team]=p.id;s.pendingSwitch[team]=null;
  if(!k.committed&&!input.cancelCharge){
    if(input.keeperLeft||input.mx<-.25)k.choice=-1;
    else if(input.keeperRight||input.mx>.25)k.choice=1;
    else if(input.keeperCentre||Math.abs(input.mz)>.5)k.choice=0;
    if(input.keeperDive&&!s.previous[team].keeperDive){k.committed=true;k.age=0;}
  }
  if(k.committed)k.age+=dt;
  const previousZ=k.lastZ??0,extend=clamp(k.age/.42,0,1),recover=clamp((k.age-.68)/.45,0,1);
  const reach=k.committed?extend*extend*(3-2*extend)*(1-recover):0;
  p.x=dir*(PITCH.halfLength-.3);p.z=dir*k.choice*2.55*reach;p.vx=0;p.vz=(p.z-previousZ)/dt;p.facing=dir>0?Math.PI:0;
  k.lastZ=p.z;
  p.penaltyDive={choice:k.choice,worldSide:dir*k.choice,age:k.committed?k.age:-1,active:k.committed&&k.age>=.06&&k.age<.72};
  if(p.anim!=='save'||p.actionTime<=0)p.anim=k.committed&&k.age<1.13?'keeperCommit':'idle';
}
export function manualKeeper(s,p){return s.penaltyKeeper?.id===p.id&&!s.penaltyKeeper.assisted&&!!defendingPenalty(s,p.team);}
