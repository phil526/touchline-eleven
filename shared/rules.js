import { PITCH } from './config.js';
import { clamp } from './math.js';

const {halfLength:HL,halfWidth:HW} = PITCH;

// Pure rule decisions. The match coordinator applies awards and emits events.
export function attackDirection(s,team) {return (team===0?1:-1)*(s.half===1?1:-1);}
export function getMatchClock(s) {
  const seconds=Math.min(5400,Math.floor(s.time/s.halfDuration*2700));
  return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
}
export function offsideAtRelease(s,p) {
  const dir=attackDirection(s,p.team);
  const defenders=s.players.filter(q=>q.team!==p.team).map(q=>q.x*dir).sort((a,b)=>b-a);
  const line=Math.max(defenders[1],s.ball.x*dir,0);
  return {team:p.team,candidates:s.players.filter(q=>q.team===p.team&&q.id!==p.id&&q.x*dir>line+0.05).map(q=>q.id)};
}
export function foulAward(s,victim) {
  const dir=attackDirection(s,victim.team);
  const penalty=victim.x*dir>HL-16.5&&Math.abs(victim.z)<20.16;
  return {type:penalty?'penalty':'freeKick',team:victim.team,x:penalty?dir*(HL-11):victim.x,z:penalty?0:victim.z};
}
export function boundaryAward(s,crossing) {
  const {axis,side,x,z}=crossing;
  if(axis==='z') {
    const lastTeam=s.ball.lastTouch===null?0:s.players[s.ball.lastTouch].team;
    return {type:'throwIn',team:1-lastTeam,x:clamp(x,-HL+1,HL-1),z:side*HW};
  }
  const attacking=attackDirection(s,0)===side?0:1;
  const lastTeam=s.ball.lastTouch===null?attacking:s.players[s.ball.lastTouch].team;
  return {type:lastTeam===attacking?'goalKick':'corner',team:lastTeam===attacking?1-attacking:attacking,x:side*HL,z:z>0?HW:-HW};
}
export function keeperCanHandle(s,p,ball) {
  const dir=attackDirection(s,p.team);
  return p.x*dir<-(HL-16.5)&&Math.abs(p.z)<20.16&&ball.x*dir<-(HL-16.5)&&Math.abs(ball.z)<20.16;
}

// Earliest foot-path contact with a circular ground footprint. A foot already
// overlapping a body but moving away does not create a new challenge contact.
export function segmentCircleContact(start,end,centre,radius) {
  const dx=end.x-start.x,dz=end.z-start.z,ox=start.x-centre.x,oz=start.z-centre.z;
  const a=dx*dx+dz*dz;if(a<1e-10)return null;
  const c=ox*ox+oz*oz-radius*radius,b=2*(ox*dx+oz*dz);
  if(c<=0)return b<0?0:null;
  const discriminant=b*b-4*a*c;if(discriminant<0)return null;
  const t=(-b-Math.sqrt(discriminant))/(2*a);
  return t>=0&&t<=1?t:null;
}

// How far the foot path cuts inside a circular footprint (0 = grazing the edge).
export function segmentCircleDepth(start,end,centre,radius) {
  const dx=end.x-start.x,dz=end.z-start.z,a=dx*dx+dz*dz;
  const t=a<1e-10?0:clamp(((centre.x-start.x)*dx+(centre.z-start.z)*dz)/a,0,1);
  return radius-Math.hypot(start.x+dx*t-centre.x,start.z+dz*t-centre.z);
}

// Contact tuning. Standing tackles use a tighter leg footprint than slides; a
// foot that only clips the edge from the front or side is play-on, and a ball
// reached within a short margin after the leg counts as a contested clean win.
// Challenges from behind never receive either allowance.
export const CHALLENGE = {
  standingRadius:0.4,slideRadius:0.54,
  standingLight:0.11,slideLight:0,
  standingMargin:0.22,slideMargin:0.12,
  behindDot:-0.3
};

export function challengeContacts(s,p,start,end,sliding=false) {
  const radius=sliding?CHALLENGE.slideRadius:CHALLENGE.standingRadius;
  let opponent=null,opponentTime=Infinity;
  for(const q of s.players) {
    if(q.team===p.team)continue;
    const t=segmentCircleContact(start,end,q,radius);
    if(t!==null&&t<opponentTime){opponent=q;opponentTime=t;}
  }
  const owner=s.ball.owner===null?null:s.players[s.ball.owner];
  const ballRadius=sliding?0.3:0.26,ballLive=s.ball.y<=0.65&&owner?.team!==p.team;
  const ballTime=ballLive?segmentCircleContact(start,end,s.ball,ballRadius):null;
  const result={opponent,opponentTime,ballTime,ballFirst:ballTime!==null&&ballTime<=opponentTime+1e-6,contested:false,light:false,fromBehind:false,depth:0};
  if(!opponent||result.ballFirst)return result;
  // Was the challenger behind the opponent's body line when the challenge began?
  const away=Math.hypot(p.x-opponent.x,p.z-opponent.z),facing=opponent.facing??0;
  result.fromBehind=away>1e-6&&(Math.cos(facing)*(p.x-opponent.x)+Math.sin(facing)*(p.z-opponent.z))/away<CHALLENGE.behindDot;
  result.depth=segmentCircleDepth(start,end,opponent,radius);
  if(result.fromBehind)return result;
  // Closely contested: the same swing reaches the ball within a small margin.
  const length=Math.hypot(end.x-start.x,end.z-start.z),margin=sliding?CHALLENGE.slideMargin:CHALLENGE.standingMargin;
  if(ballLive&&length>1e-6) {
    const reach={x:end.x+(end.x-start.x)/length*margin,z:end.z+(end.z-start.z)/length*margin};
    const t=segmentCircleContact(start,reach,s.ball,ballRadius);
    if(t!==null&&t*(length+margin)<=opponentTime*length+margin){result.ballFirst=result.contested=true;return result;}
  }
  result.light=result.depth<(sliding?CHALLENGE.slideLight:CHALLENGE.standingLight);
  return result;
}
