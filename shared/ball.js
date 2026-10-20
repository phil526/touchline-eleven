import { PITCH } from './config.js';
import { clamp, length } from './math.js';

const {halfLength:HL,halfWidth:HW,ballRadius:BR} = PITCH;
export const GROUND_DRAG = 0.65;
// For exponential rolling resistance, v(start) = v(arrival) + drag * distance.
export function groundPassSpeed(distance,kind='pass') {
  return clamp((kind==='through'?6.8:4.6)+Math.max(0,distance)*GROUND_DRAG,kind==='through'?12:9.5,kind==='through'?40:37);
}

// Integrates only the supplied ball; ownership and events remain in simulation.
export function integrateBall(ball,dt) {
  ball.x+=ball.vx*dt;ball.z+=ball.vz*dt;ball.y+=ball.vy*dt;
  ball.vy-=9.81*dt;
  if(ball.y<=BR){ball.curl=0;ball.y=BR;ball.vy=Math.abs(ball.vy)>1.4?-ball.vy*0.44:0;const friction=Math.exp(-GROUND_DRAG*dt);ball.vx*=friction;ball.vz*=friction;}
  else{ball.vz+=(Number.isFinite(ball.curl)?clamp(ball.curl,-4,4):0)*dt;ball.vx*=Math.exp(-0.035*dt);ball.vz*=Math.exp(-0.035*dt);}
}

// Pure swept boundary query, ordered by time of intersection within the step.
export function firstBoundaryCrossing(old,ball) {
  const crossings=[];
  for(const side of [-1,1]) {
    const plane=side*(HL+BR);
    if(old.x*side<=HL+BR&&ball.x*side>HL+BR)crossings.push({axis:'x',side,t:clamp((plane-old.x)/(ball.x-old.x),0,1)});
    const touchPlane=side*(HW+BR);
    if(old.z*side<=HW+BR&&ball.z*side>HW+BR)crossings.push({axis:'z',side,t:clamp((touchPlane-old.z)/(ball.z-old.z),0,1)});
  }
  crossings.sort((a,b)=>a.t-b.t);
  const hit=crossings[0];if(!hit)return null;
  return {...hit,x:old.x+(ball.x-old.x)*hit.t,z:old.z+(ball.z-old.z)*hit.t,y:old.y+(ball.y-old.y)*hit.t};
}
export function goalLineOutcome({axis,y,z}) {
  if(axis!=='x')return 'out';
  if(Math.abs(z)<3.66+0.18&&y<2.44+0.2&&(Math.abs(Math.abs(z)-3.66)<0.17||Math.abs(y-2.44)<0.15))return 'post';
  if(Math.abs(z)+BR<3.66&&y+BR<2.44)return 'goal';
  return 'out';
}
export function reachBlocked(s,p,ball) {
  const dx=ball.x-p.x,dz=ball.z-p.z,len2=dx*dx+dz*dz;
  if(len2<0.01||ball.y>1.9)return false;
  return s.players.some(q=> {
    if(q.id===p.id)return false;
    const t=((q.x-p.x)*dx+(q.z-p.z)*dz)/len2;
    return t>0.12&&t<0.96&&length(q.x-p.x-dx*t,q.z-p.z-dz*t)<0.45;
  });
}
