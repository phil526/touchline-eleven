import {length, clamp} from './math.js';

export const FIRST_TIME_WINDOW = 0.4;

// Only arm for an incoming ground pass. Contact is still resolved by receiveBall;
// the buffer never attracts the ball or expands the player's receiving radius.
export function updateFirstTime(s, p, input, previous, dt) {
  const b=s.ball;
  if(input.cancelCharge||input.switch||input.pass||input.passHold||input.through||input.throughHold||input.lob||input.oneTwo||input.clear||input.tackle||input.slide){p.firstTime=null;return;}
  if(p.firstTime){
    p.firstTime.remaining-=dt;
    if(p.firstTime.remaining<=0||b.owner!==null||s.passTeam!==p.team||b.y>=.32){p.firstTime=null;return;}
    if(input.shoot){
      p.firstTime.held+=dt;
      p.firstTime.power=clamp(p.firstTime.held/.95,.42,1);
      if(length(input.mx,input.mz)>.16){p.firstTime.input.mx=input.mx;p.firstTime.input.mz=input.mz;}
      p.firstTime.input.finesse=input.finesse;p.firstTime.input.chip=input.chip;
    }
    return;
  }
  if(!(input.strike||input.shoot&&!previous.shoot)||p.cooldown>0||p.actionTime>0||p.role==='GK'||b.owner!==null||b.y>=.32||s.passTeam!==p.team||s.passFrom===p.id)return;
  const dx=p.x-b.x,dz=p.z-b.z,vx=b.vx-p.vx,vz=b.vz-p.vz,speed2=vx*vx+vz*vz;
  const arrival=speed2>1?(dx*vx+dz*vz)/speed2:Infinity;
  if(arrival<0||arrival>FIRST_TIME_WINDOW+.08||length(dx,dz)>8||length(dx-vx*arrival,dz-vz*arrival)>1.4)return;
  p.firstTime={remaining:FIRST_TIME_WINDOW,held:dt,power:.42,input:{mx:input.mx,mz:input.mz,finesse:input.finesse,chip:input.chip,shotAssist:input.shotAssist}};
}
