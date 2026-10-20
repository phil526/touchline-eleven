import {clamp,distance,normal} from './math.js';
import {attackDirection} from './rules.js';
import {PITCH} from './config.js';

export const AERIAL_DURATION=.64;
export const aerialLift=age=>.68*Math.sin(Math.PI*clamp(age/AERIAL_DURATION,0,1));

// A press commits to one short timing window. No remote ball attraction.
export function aerialKind(s,p) {
  const b=s.ball;
  if(s.phase!=='playing'||b.owner!==null||p.role==='GK'||p.cooldown>0||p.actionTime>0||b.y<.32||b.y>3.5)return null;
  if(p.id===b.lastTouch&&s.ballFlightTime<.3)return null;
  if(distance(p,b)>4.5)return null;
  return b.y+b.vy*.12-4.905*.12**2>1.45?'header':'volley';
}

function interval(from,to,centre,radius){
  const dx=to.x-from.x,dz=to.z-from.z,ox=from.x-centre.x,oz=from.z-centre.z;
  const a=dx*dx+dz*dz,c=ox*ox+oz*oz-radius*radius;
  if(a<1e-12)return c<=0?[0,1]:null;
  const b=2*(ox*dx+oz*dz),d=b*b-4*a*c;if(d<0)return null;
  const lo=Math.max(0,(-b-Math.sqrt(d))/(2*a)),hi=Math.min(1,(-b+Math.sqrt(d))/(2*a));return lo<=hi?[lo,hi]:null;
}
export function aerialContact(s,p,from,to){
  const a=p.aerial;if(!a||a.hit||s.ball.owner!==null||a.age<.08||a.age>.46)return null;
  const head=a.kind==='header',height=head?1.65+aerialLift(a.age):.85;
  const centre={x:p.x+Math.cos(p.facing)*.25,z:p.z+Math.sin(p.facing)*.25};
  let span=interval(from,to,centre,head?.78:1.05);if(!span)return null;
  const low=height-(head?.33:.52),high=height+(head?.33:.52),dy=to.y-from.y;
  if(Math.abs(dy)<1e-9){if(from.y<low||from.y>high)return null;}
  else {const u=(low-from.y)/dy,v=(high-from.y)/dy;span=[Math.max(span[0],Math.min(u,v)),Math.min(span[1],Math.max(u,v))];}
  if(span[0]>span[1])return null;
  const t=span[0];
  return {t,point:{x:from.x+(to.x-from.x)*t,y:from.y+dy*t,z:from.z+(to.z-from.z)*t},timing:clamp(1-Math.abs(a.age-.24)/.24,.15,1)};
}

export function aerialVelocity(s,p,point,kind,mode,input={},timing=1,dispersion=0){
  const dir=attackDirection(s,p.team),skill=(p.attrs.shooting+p.attrs.control)/200;
  if(mode==='clear'){
    // Never default a clearance towards the player's own goal.
    const mx=Number.isFinite(input.mx)&&input.mx*dir>.1?input.mx:dir;
    const mz=Number.isFinite(input.mz)&&Math.abs(input.mz)>.15?input.mz:(Math.sign(p.z)||1)*.45;
    const [nx,nz]=normal(mx,mz),speed=(kind==='header'?17:24)+timing*4;
    return {x:nx*speed,y:kind==='header'?4.8:7,z:nz*speed};
  }
  const targetZ=clamp(Math.abs(input.mz||0)>.16?input.mz*3.1:p.z*.12,-3.1,3.1)+dispersion*(1.3-skill)*(.5+1-timing);
  const [nx,nz]=normal(dir*(PITCH.halfLength+.15)-point.x,targetZ-point.z);
  const speed=(kind==='header'?13:20)+skill*3+timing*4,flight=Math.max(.15,Math.abs(dir*PITCH.halfLength-point.x)/Math.max(3,Math.abs(nx*speed)));
  return {x:nx*speed,y:clamp((.55-point.y)/flight+4.905*flight,-4,8),z:nz*speed};
}
