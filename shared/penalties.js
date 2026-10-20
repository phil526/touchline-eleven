import {PITCH} from './config.js';
import {clamp} from './math.js';
import {attackDirection} from './rules.js';

export function updatePenaltyAim(s,input,dt){
 const r=s.restart,dir=attackDirection(s,r.team);
 r.aimGoalZ=clamp((r.aimGoalZ??0)+(input?.mx||0)*dir*3.8*dt,-3.2,3.2);
 r.aimGoalY=clamp((r.aimGoalY??.95)-(input?.mz||0)*1.65*dt,.25,2.18);
}

// Remember the set piece through its flight without changing saved camera settings.
export function penaltyScene(s){
 if(s?.phase==='restart'&&s.restart?.type==='penalty')return {...s.restart,half:s.half};
 const shot=s?.ball?.lastShot,age=(s?.tick??0)-(shot?.tick??0);
 if(shot?.penalty&&age>=0&&age<150&&s.ball.owner===null&&['playing','goal'].includes(s.phase))return {...shot.penalty,team:shot.team};
 const saving=s?.players?.find(p=>p.savePenalty&&(p.anim==='save'&&p.actionTime>0||s.ball.owner===p.id&&s.tick-p.savePenalty.savedAt<90));
 if(s?.phase==='playing'&&saving)return {...saving.savePenalty};
 return null;
}

export function penaltyShotAim(s,p,input={},power=.55){
 const r=s.restart,dir=attackDirection(s,p.team),kind=input.chip?'chip':input.finesse?'finesse':'normal';power=clamp(power,0,1);
 const origin={x:s.ball.x,y:s.ball.y,z:s.ball.z},target={x:dir*(PITCH.halfLength+PITCH.ballRadius),y:clamp(r.aimGoalY??.95,.25,2.18),z:clamp(r.aimGoalZ??0,-3.2,3.2)};
 const dx=target.x-origin.x,dz=target.z-origin.z,range=Math.hypot(dx,dz);
 const flight=kind==='chip'?1.5+power*.75:range/(kind==='finesse'?18+power*9:21+power*12);
 // Compensate airborne drag and the fixed-step gravity update at the goal plane.
 const travel=(1-Math.exp(-.035*flight))/.035,curl=kind==='finesse'?(Math.sign(dz)||-dir)*(2.4+power*1.6):0;
 const velocity={x:dx/travel,y:(target.y-origin.y)/flight+4.905*(flight-1/60),z:dz/travel-curl*flight*.5};
 return {origin,target,velocity,spread:(100-p.attrs.shooting)/100*(kind==='finesse'?.3:.5),speed:Math.hypot(velocity.x,velocity.z),power,kind,curl,flight,penalty:true,cleanFinish:false,assisted:false};
}
