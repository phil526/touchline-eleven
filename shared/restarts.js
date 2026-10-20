import {clamp,normal} from './math.js';
import {attackDirection} from './rules.js';
import {PITCH} from './config.js';
export const MANUAL_RESTARTS=['freeKick','throwIn','goalKick','corner','penalty'];
export const THROW_HEIGHT=1.8, THROW_STANCE=.32, THROW_DURATION=.65;
export function isManualRestart(s,team=s?.restart?.team){return s?.phase==='restart'&&s.restart?.team===team&&MANUAL_RESTARTS.includes(s.restart.type)&&s.options.humans[team];}
export function restartDirection(s,input={}){
 const r=s.restart,dir=attackDirection(s,r.team);
 if(r.type==='penalty')return normal(dir*PITCH.halfLength-r.x,(r.aimGoalZ??0)-r.z);
 if(Math.hypot(input.mx||0,input.mz||0)>.2){
  return normal(input.mx||0,input.mz||0);
 }
 if(Number.isFinite(r.aimX)&&Number.isFinite(r.aimZ))return [r.aimX,r.aimZ];
 if(r.type==='throwIn')return normal(dir*.35,-Math.sign(r.z)||1);
 if(r.type==='corner')return normal(dir*(PITCH.halfLength-10)-r.x,-r.z);
 return normal(dir*PITCH.halfLength-r.x,-r.z);
}
export function restartPassAim(s,p,input={},kind='pass',power=0){
 power=clamp(power,0,1);const [nx,nz]=restartDirection(s,input),throwing=s.restart.type==='throwIn',loft=kind==='lob'||throwing;
 const range=(kind==='lob'?18:kind==='through'?16:8)+power*(kind==='lob'?24:kind==='through'?25:22);
 const origin={x:s.ball.x,y:throwing?THROW_HEIGHT:s.ball.y,z:s.ball.z},target={x:origin.x+nx*range,y:PITCH.ballRadius,z:origin.z+nz*range};
 const flightTime=loft?clamp(range/(throwing?12:15),.7,2.8):null,speed=10+power*15+(kind==='through'?3:0);
 const velocity=flightTime?{x:nx*range/flightTime,y:(target.y-origin.y)/flightTime+4.905*flightTime,z:nz*range/flightTime}:{x:nx*speed,y:.15,z:nz*speed};
 return {kind,power,receiverId:null,origin,target,velocity,speed:Math.hypot(velocity.x,velocity.z),spread:(100-p.attrs.passing)/100*.3,distance:range,flightTime};
}
// AI throw-ins select a nearby infield teammate and release from the hands.
// Keep this separate from ground-pass speed/receiver logic.
export function aiThrowAim(s,p){
 const r=s.restart,inward=-Math.sign(r.z)||1,dir=attackDirection(s,p.team);
 const candidates=s.players.filter(q=>q.team===p.team&&q.id!==p.id&&q.role!=='GK')
  .map(q=>({q,d:Math.hypot(q.x-r.x,q.z-r.z)}))
  .filter(({q,d})=>d>=4&&d<=26&&(q.z-r.z)*inward>=2&&Math.abs(q.x)<PITCH.halfLength-1&&Math.abs(q.z)<PITCH.halfWidth-1);
 const score=({q,d})=>Math.abs(d-12)+s.players.filter(o=>o.team!==p.team&&Math.hypot(o.x-q.x,o.z-q.z)<4).length*5-(q.x-r.x)*dir*.1;
 candidates.sort((a,b)=>score(a)-score(b));const receiver=candidates[0]?.q;
 const origin={x:r.x,y:THROW_HEIGHT,z:r.z},target={x:receiver?.x??clamp(r.x+dir*4,-PITCH.halfLength+2,PITCH.halfLength-2),y:PITCH.ballRadius,z:receiver?.z??r.z+inward*12};
 const dx=target.x-origin.x,dz=target.z-origin.z,range=Math.hypot(dx,dz),flightTime=clamp(range/12,.8,2.2);
 const velocity={x:dx/flightTime,y:(target.y-origin.y)/flightTime+4.905*flightTime,z:dz/flightTime};
 return {kind:'pass',power:clamp((range-8)/22,0,1),receiverId:receiver?.id??null,origin,target,velocity,speed:Math.hypot(velocity.x,velocity.z),spread:(100-p.attrs.passing)/100*.3,distance:range,flightTime};
}
export function restartShotAim(s,p,input={},power=.55){
 power=clamp(power,0,1);const [nx,nz]=restartDirection(s,input),kind=input.chip?'chip':input.finesse?'finesse':'normal';
 const speed=kind==='chip'?10+power*8:kind==='finesse'?18+power*9:21+power*12;
 const vy=kind==='chip'?5+power*5:kind==='finesse'?2+power*4.5:1.8+power*5;
 const origin={x:s.ball.x,y:s.ball.y,z:s.ball.z},flight=(vy+Math.sqrt(vy*vy+19.62*Math.max(0,origin.y-PITCH.ballRadius)))/9.81;
 const curl=kind==='finesse'?(Math.sign(nz)||-attackDirection(s,p.team))*(2.4+power*1.6):0;
 const target={x:origin.x+nx*speed*flight,y:PITCH.ballRadius,z:origin.z+nz*speed*flight+curl*flight*flight*.5};
 return {origin,target,velocity:{x:nx*speed,y:vy,z:nz*speed},speed,power,kind,curl,flight,directional:true,spread:(100-p.attrs.shooting)/100*.5};
}
