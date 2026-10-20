import {createMatch,stepMatch,neutralInput} from '../shared/simulation.js';
import {updatePenaltyKeeper} from '../shared/keeper-control.js';

export function createKeeperPractice({seed=4242,info}={}){
 let state,round=0,attempts=0,successes=0,phase='ready',result='',resultCode=null,feedbackTime=0,elapsed=0,releaseRequired=false,history=[];
 function park(){for(const p of state.players)if(![0,20].includes(p.id))Object.assign(p,{x:30+p.slot,z:p.team?30:-30,vx:0,vz:0,cooldown:10,actionTime:0,anim:'idle'});}
 function next(requireRelease=false){
  if(state)history.push(...state.shotLog.map(q=>({...q,id:(round-1)*10000+q.id})));history=history.slice(-500);
  round++;state=createMatch({duration:3600,humans:[true,false],seed:(seed+Math.imul(round,0x9e3779b9))>>>0});
  Object.assign(state,{phase:'restart',phaseTime:0,selected:[0,20],restart:{type:'penalty',team:1,taker:20,x:-41.5,z:0},offside:null});
  park();Object.assign(state.players[0],{x:-52.2,z:0,facing:0,cooldown:0});Object.assign(state.players[20],{x:-40.85,z:0,facing:Math.PI,cooldown:0});
  Object.assign(state.ball,{x:-41.5,y:.11,z:0,owner:null,lastTouch:20,state:'dead'});
  phase='ready';result='';resultCode=null;elapsed=feedbackTime=0;releaseRequired=requireRelease;
  return state;
 }
 function finish(success,code,message){if(phase==='feedback')return;successes+=Number(success);phase='feedback';resultCode=code;result=message;feedbackTime=0;}
 function step(input=neutralInput(),dt=1/60){
  if(!Number.isFinite(dt)||dt<=0)return state;dt=Math.min(.05,dt);
  const actions={...neutralInput(),...input,switch:false};
  if(releaseRequired){if(actions.keeperReady||actions.keeperDive||actions.shoot||actions.passHold)return state;releaseRequired=false;}
  if(phase==='feedback'){
   feedbackTime+=dt;
   if(resultCode==='saved'&&feedbackTime<1.25){stepMatch(state,[{...neutralInput(),keeperAssist:actions.keeperAssist},null],dt);park();}
   if(feedbackTime>=1.65)next(true);return state;
  }
  if(phase==='ready'){
   updatePenaltyKeeper(state,[{...actions,keeperDive:false},null],dt);
   if(actions.keeperReady&&!actions.cancelCharge){phase='countdown';state.phaseTime=0;}
   return state;
  }
  const before=state.stats.shots[1];stepMatch(state,[actions,null],dt);park();elapsed+=dt;
  if(state.stats.shots[1]>before){attempts++;phase='action';elapsed=0;}
  if(phase==='action'){
   if(state.stats.saves[0]>0)finish(true,'saved','Saved! Good timing. Get ready for another penalty.');
   else if(state.score[1]>0){const k=state.penaltyKeeper;finish(false,'goal',!k?.committed?'Goal conceded. Choose a side, then press Dive as the shot is taken.':k.age>.75?'Too early. Wait until the taker strikes before diving.':'Goal conceded. Read the shot and try the other side.');}
   else if(state.phase==='restart'||elapsed>4.5)finish(false,'missed','The taker missed. No save credited — prepare for the next kick.');
  }
  return state;
 }
 next();
 return {step,drill:'keeperPenalties',restart(){state=null;history=[];round=attempts=successes=0;return next(true);},
  get state(){return state;},get shots(){return [...history,...state.shotLog.map(q=>({...q,id:(round-1)*10000+q.id}))];},
  get status(){return {drill:'keeperPenalties',...info,round,attempts,successes,phase,result,resultCode,releaseRequired,countdown:Math.max(0,2-state.phaseTime)};}};
}
