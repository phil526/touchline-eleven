import {attackDirection} from './rules.js';
import {PITCH} from './config.js';

export function recordShot(s,p,{power=0,kind='normal',origin=s.ball,target=null}={}){
  s.shotLog??=[];s.shotSequence=(s.shotSequence||0)+1;
  const entry={id:s.shotSequence,team:p.team,player:p.id,name:p.name,tick:s.tick,time:s.time,half:s.half,dir:attackDirection(s,p.team),x:origin.x,z:origin.z,power,kind,target:target?{...target}:null,keeperZ:s.players.find(q=>q.role==='GK'&&q.team!==p.team)?.z??0,outcome:'flight'};
  s.shotLog.push(entry);if(s.shotLog.length>512)s.shotLog.shift();
  if(s.ball.lastShot)s.ball.lastShot.logId=entry.id;
  return entry;
}
export function finishShot(s,outcome,point=s.ball){
  const entry=s.shotLog?.find(q=>q.id===s.ball.lastShot?.logId);if(!entry)return;
  // A parry/post can still cross the goal line. Keep the final goal on that shot.
  if(entry.outcome!=='flight'&&outcome!=='goal')return;
  entry.outcome=outcome;entry.end={x:point.x,y:point.y,z:point.z};entry.resolvedTick=s.tick;
}
export function settleShot(s){
  const shot=s.ball.lastShot;if(!shot)return;
  if(s.phase==='fulltime'||s.phase==='halftime'||s.tick-shot.tick>360)finishShot(s,'missed');
}
export function shotFeedback(shot){
  if(!shot)return 'Aim for a corner, then hold and release Shoot.';
  if(shot.outcome==='goal')return 'Goal. Good placement — try the other corner next.';
  if(shot.outcome==='saved')return Math.abs((shot.end?.z??0)-shot.keeperZ)<.85?'Straight at the keeper. Aim farther into a corner.':'Saved. Try a different corner, shot type or power.';
  if(shot.outcome==='blocked')return 'Blocked. Create a clearer shooting lane with a pass or skill move.';
  if(shot.outcome==='woodwork')return 'Off the woodwork. Aim a little farther inside the post.';
  if(shot.outcome==='flight')return 'Shot in flight.';
  if(shot.end?.y>PITCH.goalHeight)return shot.power>.8?'Over the bar. Try less power on the next attempt.':'Over the bar. Lower your aim or use a more controlled shot.';
  if(Math.abs(shot.end?.z??0)>PITCH.goalWidth/2)return 'Wide. Bring your aim farther inside the post.';
  return 'Shot did not score. Try a clearer angle or a different corner.';
}
