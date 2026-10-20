import {isManualRestart,restartShotAim} from './restarts.js';
import {penaltyShotAim} from './penalties.js';
import { PITCH } from './config.js';
import { clamp, length, distance, normal, angleDiff } from './math.js';
import { attackDirection } from './rules.js';
import { integrateBall } from './ball.js';

export const shotType = (input={}) => input.chip===true?'chip':input.finesse===true?'finesse':'normal';
export const SHOT_NAMES = Object.freeze({normal:'SHOT POWER',finesse:'FINESSE SHOT',chip:'CHIP SHOT'});

// The client guide and authoritative shot release share this exact base aim.
// No random numbers are consumed, and neither match nor player is mutated.
export function shotAim(s,p,input={},power=0.55) {
  const penalty=s.phase==='restart'&&s.restart?.type==='penalty'&&s.restart.taker===p.id;
  if(penalty)return penaltyShotAim(s,p,input,power);
  if(isManualRestart(s,p.team)&&!penalty)return restartShotAim(s,p,input,power);
  const dir=attackDirection(s,p.team),d=Math.abs(dir*PITCH.halfLength-p.x);
  power=clamp(Number.isFinite(power)?power:0.55,0,1);
  let aimZ=clamp(p.z*0.15,-1.8,1.8);
  if(Number.isFinite(input.mz)&&Math.abs(input.mz)>0.16)aimZ=clamp(input.mz*3.2,-3.2,3.2);
  const keeper=s.players.find(q=>q.team!==p.team&&q.role==='GK');
  if(!s.options.humans[p.team]&&keeper)aimZ=keeper.z>0?-2.6:2.6;
  const pressure=s.players.filter(q=>q.team!==p.team&&distance(q,p)<3).length;
  const goalBearing=Math.atan2(-p.z,dir*PITCH.halfLength-p.x);
  const facingError=Math.abs(angleDiff(goalBearing,p.facing))/Math.PI;
  const shootingAngle=Math.atan2(Math.abs(p.z),Math.max(d,0.1))/(Math.PI/2);
  const motion=clamp(length(p.vx,p.vz)/(4.7+p.attrs.pace*0.026),0,1.25);
  let spread=(100-p.attrs.shooting)/100*(1+pressure*0.5)*(0.6+d/20)*(1+facingError*0.65+shootingAngle*0.55+motion*0.35);
  const cleanFinish=!penalty&&d<=16.5&&Math.abs(p.z)<=20.16&&pressure===0&&facingError<=.25&&motion<=1.02;
  if(cleanFinish)spread*=.6;
  const assisted=cleanFinish&&s.options.humans[p.team]&&input.shotAssist!==false;
  if(assisted){
    if(Math.abs(input.mz||0)>.16){
      // A deliberate side always wins. Full-width aim stays exactly where chosen.
      aimZ+=Math.sign(aimZ)*Math.max(0,2.65-Math.abs(aimZ))*.45;
    }else{
      const score=z=>{
        let value=keeper?Math.abs(z-keeper.z)*.7:0;
        const dx=dir*PITCH.halfLength-s.ball.x,dz=z-s.ball.z,den=dx*dx+dz*dz;
        for(const q of s.players)if(q.team!==p.team){
          const t=clamp(((q.x-s.ball.x)*dx+(q.z-s.ball.z)*dz)/Math.max(den,.01),0,1);
          const gap=length(q.x-s.ball.x-dx*t,q.z-s.ball.z-dz*t);
          if(t>.05&&t<1&&gap<1.5)value-=(1.5-gap)*2;
        }
        return value;
      };
      const corner=score(-2.65)>=score(2.65)?-2.65:2.65;
      aimZ+=(corner-aimZ)*.65;
    }
  }
  const origin={x:s.ball.x,y:s.ball.y,z:s.ball.z};
  const kind=shotType(input);
  const target={x:dir*(PITCH.halfLength+(kind==='normal'&&!penalty&&!cleanFinish?3:PITCH.ballRadius)),y:0.25+power*0.8,z:aimZ};
  if(kind!=='normal') {
    const range=Math.max(.5,Math.abs(target.x-origin.x));
    // A finesse shot starts outside the direct line and bends back towards aim.
    // A chip spends longer in the air. Very long chips fall short of the goal.
    const flight=kind==='chip'?1.5+power*.75:range/(18+power*9);
    const speed=kind==='chip'?Math.min(19,range/flight):18+power*9;
    const curl=kind==='finesse'?(Math.sign(target.z-origin.z)||-dir)*(2.4+power*1.6):0;
    const velocity={x:dir*speed,y:clamp((target.y-origin.y)/flight+4.905*flight,1.6,11.5),z:(target.z-origin.z)/flight-curl*flight*.5};
    return {origin,target,velocity,spread:spread*(kind==='finesse'?.55:.85),speed,power,kind,curl,flight,cleanFinish,assisted};
  }
  const speed=21+power*12,flight=d/speed;
  const [nx,nz]=normal(target.x-origin.x,target.z-origin.z);
  const vy=clamp((target.y-origin.y)/Math.max(flight,0.1)+4.905*flight,1.6,9);
  return {origin,target,velocity:{x:nx*speed,y:vy,z:nz*speed},spread,speed,power,kind,curl:0,cleanFinish,assisted};
}

// Dispersion changes the horizontal target, preserving the base flight power.
export function withShotSpread(aim,offset) {
  if(aim.directional){const a=offset/Math.max(12,aim.speed*aim.flight),c=Math.cos(a),s=Math.sin(a),v=aim.velocity;return {...aim,velocity:{x:v.x*c-v.z*s,y:v.y,z:v.x*s+v.z*c}};}

  const target={...aim.target,z:aim.target.z+offset};
  if(aim.kind!=='normal'&&aim.flight)return {...aim,target,velocity:{...aim.velocity,z:aim.velocity.z+offset/aim.flight}};
  const [nx,nz]=normal(target.x-aim.origin.x,target.z-aim.origin.z);
  return {...aim,target,velocity:{x:nx*aim.speed,y:aim.velocity.y,z:nz*aim.speed}};
}

// Draw the same airborne path used by live physics and goalkeeper prediction.
// Stop at the goal plane or first landing; opponents and dispersion are excluded.
export function shotTrajectory(aim) {
  const b={...aim.origin,vx:aim.velocity.x,vy:aim.velocity.y,vz:aim.velocity.z,curl:aim.curl};
  const points=[{...aim.origin}],dir=Math.sign(aim.velocity.x),plane=dir*(PITCH.halfLength+PITCH.ballRadius);
  for(let i=0;i<240;i++) {
    const old={...b};integrateBall(b,1/60);
    if(Math.abs(aim.velocity.x)>.001&&old.x*dir<=plane*dir&&b.x*dir>=plane*dir) {
      const t=(plane-old.x)/(b.x-old.x);
      points.push({x:plane,y:old.y+(b.y-old.y)*t,z:old.z+(b.z-old.z)*t});break;
    }
    if(i%3===2||b.y<=PITCH.ballRadius)points.push({x:b.x,y:b.y,z:b.z});
    if(b.y<=PITCH.ballRadius)break;
  }
  return points;
}
