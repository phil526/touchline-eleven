import {PITCH} from './config.js';
import {clamp,length,distance,normal} from './math.js';
import {attackDirection,keeperCanHandle} from './rules.js';
import {integrateBall,reachBlocked} from './ball.js';

export const KEEPER_TUNING=Object.freeze({
  minDepth:.75,boxMargin:.8,maxGuardDepth:5.5,maxCloseDepth:8.5,
  closeThreatDepth:24,claimHorizon:1.25,claimStep:.125,raceMargin:.08,
  lowHeight:.65,maxHeight:2.45,rearReach:.32,
  lowReach:.72,lowSkillReach:.23,highReach:.8,highSkillReach:.32,
  smotherReach:.55,smotherSkillReach:.12,parryRecovery:.58
});
const skillOf=p=>clamp((p.attrs?.goalkeeping??50)/100,0,1);
const ownerOf=s=>s.ball.owner===null?null:s.players[s.ball.owner]??null;
const runSpeed=p=>(4.7+(p.attrs?.pace??60)*.026)*1.22;
const reactionTime=p=>.07+(1-skillOf(p))*.12;

// Use the same bounded bounce/rolling model as the live ball. Forecasts never
// move authority and are recalculated after every deflection or rebound.
export function predictKeeperBall(ball,seconds) {
  const copy={...ball},time=clamp(Number.isFinite(seconds)?seconds:0,0,2.5);
  for(let t=0;t<time-1e-9;t+=1/60)integrateBall(copy,Math.min(1/60,time-t));
  return copy;
}
function safeBoxPoint(s,p,point) {
  const dir=attackDirection(s,p.team),depth=point.x*dir+PITCH.halfLength;
  return depth>KEEPER_TUNING.minDepth&&depth<PITCH.boxLength-KEEPER_TUNING.boxMargin&&Math.abs(point.z)<PITCH.boxWidth/2-KEEPER_TUNING.boxMargin;
}
function anglePosition(depth,z,guardDepth) {
  const left=normal(-Math.max(depth,.1),-PITCH.goalWidth/2-z),right=normal(-Math.max(depth,.1),PITCH.goalWidth/2-z);
  return z+(guardDepth-depth)*(left[1]+right[1])/Math.min(-.001,left[0]+right[0]);
}
function safeClaim(s,p) {
  const b=s.ball;if(b.owner!==null||!safeBoxPoint(s,p,b))return null;
  const opponents=s.players.filter(q=>q.team!==p.team&&q.role!=='GK');
  for(let t=KEEPER_TUNING.claimStep;t<=KEEPER_TUNING.claimHorizon+1e-9;t+=KEEPER_TUNING.claimStep) {
    const point=predictKeeperBall(b,t);
    if(!safeBoxPoint(s,p,point)||point.y>1.15)continue;
    const arrival=reactionTime(p)+Math.max(0,distance(p,point)-.65)/runSpeed(p);
    const opponentArrival=Math.min(...opponents.map(q=>Math.max(0,distance(q,point)-.7)/runSpeed(q)));
    if(arrival<=t&&arrival+KEEPER_TUNING.raceMargin<opponentArrival)return {point,arrival};
  }
  return null;
}
function shotCrossing(s,p,guardDepth) {
  const dir=attackDirection(s,p.team),b=s.ball;
  let previous={...b};
  for(let t=1/60;t<=1.8;t+=1/60) {
    const next={...previous};integrateBall(next,1/60);
    const before=previous.x*dir+PITCH.halfLength,after=next.x*dir+PITCH.halfLength;
    if(before>=guardDepth&&after<=guardDepth) {
      const blend=(before-guardDepth)/Math.max(before-after,.0001);
      return {x:-dir*PITCH.halfLength+dir*guardDepth,z:previous.z+(next.z-previous.z)*blend,y:previous.y+(next.y-previous.y)*blend,time:t};
    }
    previous=next;
  }
  return null;
}

export function keeperPosition(s,p) {
  const dir=attackDirection(s,p.team),b=s.ball,depth=b.x*dir+PITCH.halfLength,owner=ownerOf(s),speed=length(b.vx,b.vz);
  const incoming=owner===null&&b.vx*dir<-1,ballAtOwnEnd=depth<20&&depth>-1;
  const rebound=owner===null&&b.lastTouch===p.id&&(s.ballFlightTime??0)<2;
  let targetDepth=clamp(1.1+depth*.075,1.1,KEEPER_TUNING.maxGuardDepth),mode=rebound?'recover':'guard';
  if(incoming)targetDepth=Math.min(targetDepth,clamp(p.x*dir+PITCH.halfLength,1.1,4));
  const closeThreat=owner&&owner.team!==p.team&&depth>2&&depth<KEEPER_TUNING.closeThreatDepth&&Math.abs(b.z)<18;
  const cover=closeThreat&&s.players.some(q=>q.team===p.team&&q.id!==p.id&&q.x*dir<b.x*dir-.4&&distance(q,b)<3.4);
  if(closeThreat&&!cover) {
    targetDepth=Math.min(clamp(depth*.38,2.8,KEEPER_TUNING.maxCloseDepth),Math.max(.75,depth-1.4));
    if(Math.abs(b.z)>12)targetDepth=Math.min(targetDepth,3.2);
    mode='oneOnOne';
  }
  let z=clamp(anglePosition(depth,b.z,targetDepth),-PITCH.goalWidth/2+.15,PITCH.goalWidth/2-.15);
  if(incoming) {
    const crossing=shotCrossing(s,p,targetDepth);
    if(crossing&&Math.abs(crossing.z)<PITCH.goalWidth/2+1.5&&crossing.y<3.3) {
      z=clamp(crossing.z,-PITCH.goalWidth/2-.6,PITCH.goalWidth/2+.6);mode='intercept';
    }
  }
  // A moving shot uses its intercept line. Only slower loose balls and parry
  // rebounds are eligible for a race out from the goal.
  if(owner===null&&(speed<8.5||rebound&&speed<14)) {
    const claim=safeClaim(s,p);
    if(claim){targetDepth=claim.point.x*dir+PITCH.halfLength;z=claim.point.z;mode=rebound?'rebound':'collect';}
  }
  const x=-dir*PITCH.halfLength+dir*clamp(targetDepth,KEEPER_TUNING.minDepth,PITCH.boxLength-KEEPER_TUNING.boxMargin);
  return {x,z:clamp(z,-PITCH.boxWidth/2+KEEPER_TUNING.boxMargin,PITCH.boxWidth/2-KEEPER_TUNING.boxMargin),speed,incoming,ballAtOwnEnd,mode,sprint:incoming||['oneOnOne','collect','rebound'].includes(mode),reaction:reactionTime(p)};
}

function circleInterval(from,to,p,radius) {
  const ox=from.x-p.x,oz=from.z-p.z,dx=to.x-from.x,dz=to.z-from.z,a=dx*dx+dz*dz,c=ox*ox+oz*oz-radius*radius;
  if(a<1e-12)return c<=0?[0,1]:null;
  const b=2*(ox*dx+oz*dz),discriminant=b*b-4*a*c;if(discriminant<0)return null;
  const root=Math.sqrt(discriminant),lo=Math.max(0,(-b-root)/(2*a)),hi=Math.min(1,(-b+root)/(2*a));
  return lo<=hi?[lo,hi]:null;
}
function clipInterval(interval,from,to,min,max) {
  if(!interval)return null;
  const change=to-from;
  if(Math.abs(change)<1e-12)return from>=min&&from<=max?interval:null;
  const a=(min-from)/change,b=(max-from)/change,lo=Math.max(interval[0],Math.min(a,b)),hi=Math.min(interval[1],Math.max(a,b));
  return lo<=hi?[lo,hi]:null;
}
function reboundVelocity(s,p,point,speed) {
  const dir=attackDirection(s,p.team),opponents=s.players.filter(q=>q.team!==p.team);
  const score=side=>{
    const landing={x:point.x+dir*4,z:point.z+side*6};
    const space=Math.min(10,...opponents.map(q=>distance(q,landing)));
    return space+(side*point.z>0?1.5:0);
  };
  const left=score(-1),right=score(1),side=Math.abs(left-right)<1e-8?(Math.abs(point.z)>.1?Math.sign(point.z):dir):(left>right?-1:1);
  return {x:dir*clamp(speed*.24,4.2,8),z:side*clamp(speed*.3,5,10),y:point.y<KEEPER_TUNING.lowHeight?clamp(speed*.025,.35,1.1):clamp(speed*.06,1,2.3)};
}

// Run after ball integration, before goal/boundary awards. This queries only
// the ball's actual swept segment this tick; it never catches a future ball.
export function keeperContact(s,p,fromBall,toBall) {
  if(p.role!=='GK'||p.cooldown>0)return null;
  const owner=ownerOf(s);if(owner?.team===p.team)return null;
  const skill=skillOf(p),smother=owner!==null,low=Math.max(fromBall.y,toBall.y)<=KEEPER_TUNING.lowHeight;
  const manual=p.penaltyDive,ready=manual?.active===true;
  const reach=manual?(ready?.95:.38):smother?KEEPER_TUNING.smotherReach+skill*KEEPER_TUNING.smotherSkillReach:low?KEEPER_TUNING.lowReach+skill*KEEPER_TUNING.lowSkillReach:KEEPER_TUNING.highReach+skill*KEEPER_TUNING.highSkillReach;
  const dir=attackDirection(s,p.team),speed=length(fromBall.vx??s.ball.vx,fromBall.vz??s.ball.vz);
  let interval=circleInterval(fromBall,toBall,p,reach);
  interval=clipInterval(interval,fromBall.y,toBall.y,PITCH.ballRadius-.02,manual&&!ready?1.35:KEEPER_TUNING.maxHeight);
  interval=clipInterval(interval,(fromBall.x-p.x)*dir,(toBall.x-p.x)*dir,-KEEPER_TUNING.rearReach,reach);
  if(!interval)return null;
  const t=interval[0],point={x:fromBall.x+(toBall.x-fromBall.x)*t,y:fromBall.y+(toBall.y-fromBall.y)*t,z:fromBall.z+(toBall.z-fromBall.z)*t};
  if(!keeperCanHandle(s,p,point)||reachBlocked(s,p,point))return null;
  if(smother&&(point.y>.65||speed>14))return null;
  const pressure=s.players.filter(q=>q.team!==p.team&&distance(q,point)<2.3).length;
  const relativeSpeed=length((fromBall.vx??s.ball.vx)-p.vx,(fromBall.vz??s.ball.vz)-p.vz);
  const catchLimit=12+skill*6-pressure*1.6-distance(p,point)/reach*3;
  const outcome=smother||relativeSpeed<=catchLimit&&point.y<2.05?'catch':'parry';
  return {t,point,outcome,smother,reach,velocity:outcome==='parry'?reboundVelocity(s,p,point,speed):{x:0,y:0,z:0},cooldown:outcome==='catch'?.5:speed>22?.38:.3,recovery:outcome==='catch'?.52:KEEPER_TUNING.parryRecovery,saveTarget:{...point},isSave:!smother&&speed>8&&(fromBall.vx??s.ball.vx)*dir<0};
}
