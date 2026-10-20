import {PITCH} from './config.js';
import {attackDirection} from './rules.js';
import {clamp} from './math.js';

export function startOneTwo(s,p,receiver){
  if(!receiver||p.role==='GK'||s.phase!=='playing')return false;
  const dir=attackDirection(s,p.team),side=Math.sign(p.z-receiver.z)||(p.z>0?-1:1);
  s.runs??=[null,null];
  s.runs[p.team]={runner:p.id,receiver:receiver.id,half:s.half,expires:s.tick+300,returned:false,
    x:dir*clamp(p.x*dir+15,-PITCH.halfLength+3,PITCH.halfLength-3),z:clamp(p.z+side*4,-PITCH.halfWidth+3,PITCH.halfWidth-3)};
  // Let the passer run immediately; the receiver remains under the user's control.
  s.selected[p.team]=receiver.id;s.pendingSwitch[p.team]=null;
  return true;
}

export function pruneRuns(s){
  s.runs??=[null,null];
  for(let team=0;team<2;team++){
    const r=s.runs[team];if(!r)continue;
    const owner=s.ball.owner===null?null:s.players[s.ball.owner],touch=s.players[s.ball.lastTouch];
    if(s.phase!=='playing'||s.half!==r.half||s.tick>=r.expires||owner?.team===1-team||touch?.team===1-team||owner?.id===r.runner||owner&&owner.id!==r.receiver)s.runs[team]=null;
  }
}

export function oneTwoTarget(s,p){
  const r=s.runs?.[p.team];if(!r||r.runner!==p.id||s.tick>=r.expires||s.half!==r.half||s.phase!=='playing')return null;
  const dir=attackDirection(s,p.team);
  const defenders=s.players.filter(q=>q.team!==p.team).map(q=>q.x*dir).sort((a,b)=>b-a);
  const onside=Math.max(0,s.ball.x*dir,defenders[1]??0)-.9;
  // Once the return pass has been released, offside uses its saved snapshot.
  return {x:r.returned?r.x:Math.min(r.x*dir,onside)*dir,z:r.z};
}
