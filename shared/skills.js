import {clamp} from './math.js';
import {PITCH} from './config.js';

export const SKILLS=Object.freeze({ballRoll:{name:'BALL ROLL',duration:.46},bodyFeint:{name:'BODY FEINT',duration:.5},fakeShot:{name:'FAKE SHOT',duration:.48}});
export function startSkill(s,p,input,previous={}) {
  if(s.phase!=='playing'||s.ball.owner!==p.id||s.ball.state==='held'||p.role==='GK'||p.skill||p.skillCooldown>0||p.cooldown>0||p.actionTime>0)return false;
  const kind=Object.keys(SKILLS).find(k=>input[k]&&!previous[k]);if(!kind)return false;
  const lateral=-Math.sin(p.facing)*(input.mx||0)+Math.cos(p.facing)*(input.mz||0);
  p.skill={kind,age:0,duration:SKILLS[kind].duration,side:lateral<-.12?-1:1,facing:p.facing};
  p.skillCooldown=1.05;p.charge=0;p.shotType=null;p.passCharge=0;p.passType=null;p.firstTime=null;p.shotLatch=!!input.shoot;
  p.actionTime=p.actionDuration=p.skill.duration;p.anim='skill';p.stamina=clamp(p.stamina-.018,0,1);
  return true;
}
export function updateSkill(s,p,dt) {
  const m=p.skill;if(!m)return false;
  if(s.phase!=='playing'||s.ball.owner!==p.id){p.skill=null;p.actionTime=0;return false;}
  m.age=Math.min(m.duration,m.age+dt);const t=m.age/m.duration;
  const lateral=m.kind==='bodyFeint'?(t<.35?-1.6:3.6):m.kind==='ballRoll'?2.35:1.9;
  const forward=m.kind==='fakeShot'?(t<.45?.3:3.3):m.kind==='bodyFeint'?1.6:1.3;
  const c=Math.cos(m.facing),n=Math.sin(m.facing);
  p.vx=c*forward-n*m.side*lateral;p.vz=n*forward+c*m.side*lateral;p.facing=m.facing;
  p.x=clamp(p.x+p.vx*dt,-PITCH.halfLength-1.5,PITCH.halfLength+1.5);p.z=clamp(p.z+p.vz*dt,-PITCH.halfWidth-1.5,PITCH.halfWidth+1.5);
  p.controlMode='close';p.anim='skill';
  if(m.age>=m.duration-1e-9){p.skill=null;p.actionTime=0;}
  return true;
}
export function skillBallOffset(p){
  if(!p.skill)return null;const m=p.skill,t=m.age/m.duration;
  return {lead:.38,side:m.side*(m.kind==='ballRoll'?.38*Math.sin(t*Math.PI):m.kind==='bodyFeint'?.12:.2*Math.sin(t*Math.PI))};
}
