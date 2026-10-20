import { PITCH, FORMATION } from './config.js';
import { clamp, length, distance, normal } from './math.js';
import { attackDirection } from './rules.js';
import { keeperPosition } from './goalkeeping.js';
import {oneTwoTarget} from './one-two.js';

const {halfLength:HL,halfWidth:HW} = PITCH;
const ownerOf=s=>s.ball.owner===null?null:s.players[s.ball.owner]??null;
const outfield=(s,team)=>s.players.filter(p=>p.team===team&&p.role!=='GK');
const mentalityOf=(s,team)=>s.options.tactics[team]==='attacking'?5:s.options.tactics[team]==='defensive'?-5:0;

// Pure perception and target selection. Simulation alone commits actions and RNG.
export function chooseReceiver(s,p,input,kind='pass',power=0) {
  const dir=attackDirection(s,p.team),mx=input?.mx??0,mz=input?.mz??0,analog=length(mx,mz)>0.25;
  const aim=analog?normal(mx,mz):[dir,0],idealDistance=(kind==='through'?22:kind==='lob'?28:15)+clamp(Number.isFinite(power)?power:0,0,1)*(kind==='pass'?26:kind==='through'?18:0);
  let best=null,bestScore=-Infinity;
  for(const q of s.players) {
    if(q.team!==p.team||q.id===p.id||q.role==='GK')continue;
    const dx=q.x-p.x,dz=q.z-p.z,d=length(dx,dz);if(d<2||d>53)continue;
    const alignment=(dx*aim[0]+dz*aim[1])/d;
    // Aimed passes may target offside players; rules decide the consequence.
    if(analog&&alignment<0.25)continue;
    let obstruction=0,receiverSpace=8;
    for(const defender of s.players) {
      if(defender.team===p.team)continue;
      receiverSpace=Math.min(receiverSpace,distance(defender,q));
      const t=clamp(((defender.x-p.x)*dx+(defender.z-p.z)*dz)/(d*d),0,1);
      const gap=length(defender.x-p.x-dx*t,defender.z-p.z-dz*t);
      if(t>0.05&&t<0.94&&gap<2.6)obstruction+=(2.6-gap)*(kind==='lob'?1.1:2.7);
    }
    const running=kind==='through'?clamp((q.vx??0)*dir,-2,4)*0.45:0;
    const run=s.runs?.[p.team],returnOption=run&&!run.returned&&s.tick<run.expires&&run.receiver===p.id&&run.runner===q.id&&(kind==='pass'||kind==='through')&&(!analog||alignment>.7);
    const score=(returnOption?12:0)+alignment*(analog?26:7)+dx*dir*0.18-Math.abs(d-idealDistance)*0.25-obstruction+Math.min(receiverSpace,5)*0.55+running+(q.role==='ST'?0.5:0);
    if(score>bestScore){bestScore=score;best=q;}
  }
  return best;
}

function screenTarget(s,team) {
  const dir=attackDirection(s,team),b=s.ball,[gx,gz]=normal(-dir*HL-b.x,-b.z);
  const separation=s.options.tactics[team]==='defensive'?8:s.options.tactics[team]==='attacking'?5.5:6.5;
  return {x:b.x+gx*separation,z:b.z+gz*separation};
}

// First ID chases; second ID screens and must never also target the ball.
export function selectPressers(s) {
  const owner=ownerOf(s);
  return [0,1].map(team=>{
    if(owner?.team===team)return [];
    const dir=attackDirection(s,team),candidates=outfield(s,team),relativeBall=s.ball.x*dir;
    const cost=p=>{
      const preserveLine=p.role==='CB'&&relativeBall>-27?10:p.slot<=4&&relativeBall>-12?4:0;
      const alreadyClosing=Number.isFinite(p.targetX)&&length(p.targetX-s.ball.x,p.targetZ-s.ball.z)<3?1.1:0;
      return distance(p,s.ball)+preserveLine-alreadyClosing;
    };
    candidates.sort((a,b)=>cost(a)-cost(b)||a.id-b.id);
    if(!candidates.length)return [];
    const intended=owner===null?candidates.find(p=>p.id===s.receiver?.[team]):null;
    const chaser=intended??candidates[0],screen=screenTarget(s,team);
    const coverCost=p=>distance(p,screen)+(p.role==='CB'&&relativeBall>-27?9:0)-(p.role==='DM'?3:0);
    const cover=candidates.filter(p=>p.id!==chaser.id).sort((a,b)=>coverCost(a)-coverCost(b)||a.id-b.id)[0];
    return cover?[chaser.id,cover.id]:[chaser.id];
  });
}

function onsideLimit(s,team) {
  const dir=attackDirection(s,team),defenders=s.players.filter(q=>q.team!==team).map(q=>q.x*dir).sort((a,b)=>b-a);
  return Math.max(0,s.ball.x*dir,defenders[1]??0)-0.85;
}
function readyToRelease(s,owner,dir) {
  const forward=Math.cos(owner.facing??(dir>0?0:Math.PI))*dir>0.2||(owner.vx??0)*dir>1.2;
  return forward&&(owner.cooldown??0)<0.25&&(owner.actionTime??0)<0.3&&!s.players.some(q=>q.team!==owner.team&&distance(q,owner)<2.7);
}
function supportTarget(s,p,owner,tx,tz) {
  const dir=attackDirection(s,p.team),ox=owner.x*dir,oz=owner.z*dir;
  const ready=readyToRelease(s,owner,dir),side=p.slot===6||p.slot===8||p.slot===1?-1:1;
  if(p.slot===5) {
    tx=clamp(ox-9,-29,14);tz=clamp(oz*0.4,-14,14);
  } else if(p.slot===6||p.slot===7) {
    const ahead=owner.slot<=4?14:owner.slot>=8?-9:(owner.slot===6||owner.slot===7)?(ready?7:3):p.slot===6?-3:6;
    tx=clamp(ox+ahead,-31,37);tz=clamp(oz+side*9.5,-23,23);
  } else if(p.slot===8||p.slot===10) {
    tx=clamp(tx+(ready?3:0),ox+6,ox+(ready?24:17));tz=side*clamp(25+Math.abs(oz)*0.04,24,27);
  } else if(p.slot===9) {
    tx=clamp(tx+(ready?4:0),ox+8,ox+(ready?28:15));tz=clamp(oz*0.25+(oz>0?-3.5:3.5),-10,10);
  } else if((p.slot===1||p.slot===4)&&s.options.tactics[p.team]==='attacking'&&oz*side>12&&ox>-15) {
    // Only the ball-side fullback overlaps; opposite fullback retains cover.
    tx=Math.max(tx,Math.min(ox-8,20));tz=side*27;
  }
  return {x:Math.min(tx,onsideLimit(s,p.team))*dir,z:tz*dir};
}
function defensiveMarks(s,team,pressers) {
  const dir=attackDirection(s,team),owner=ownerOf(s),b=s.ball;
  const available=outfield(s,team).filter(p=>p.slot<=5&&!pressers[team]?.includes(p.id));
  const threats=s.players.filter(q=>q.team!==team&&q.role!=='GK'&&q.id!==owner?.id&&q.x*dir<Math.min(6,b.x*dir+18));
  threats.sort((a,c)=>(a.x*dir+Math.abs(a.z)*0.12)-(c.x*dir+Math.abs(c.z)*0.12)||a.id-c.id);
  const assignments=new Map();
  for(const threat of threats) {
    if(!available.length)break;
    const [gx,gz]=normal(-dir*HL-threat.x,-threat.z),goalSide={x:threat.x+gx*2.2,z:threat.z+gz*2.2};
    let bestIndex=0,bestCost=Infinity;
    for(let i=0;i<available.length;i++) {
      const defender=available[i],anchorZ=FORMATION[defender.slot][1]*dir,cost=distance(defender,goalSide)+Math.abs(anchorZ-threat.z)*0.35;
      if(cost<bestCost){bestCost=cost;bestIndex=i;}
    }
    const [defender]=available.splice(bestIndex,1);assignments.set(defender.id,goalSide);
  }
  return assignments;
}

export function formationTarget(s,p,pressers) {
  const b=s.ball,dir=attackDirection(s,p.team),owner=ownerOf(s),possession=owner?.team===p.team;
  const [ax,az]=FORMATION[p.slot],mentality=mentalityOf(s,p.team);
  let tx=(ax+clamp(b.x*dir*0.28,-11,15)+mentality+(possession?8:0))*dir,tz=az*dir*(possession?1:0.88)+b.z*0.15;
  const runTarget=oneTwoTarget(s,p);
  const isPresser=!possession&&pressers[p.team]?.[0]===p.id,isCover=!possession&&pressers[p.team]?.[1]===p.id;
  if(s.receiver?.[p.team]===p.id&&b.owner===null) {
    // After release the receiver follows the flight; rules retain the offside snapshot.
    const flight=clamp(distance(p,b)/Math.max(length(b.vx,b.vz),5),0.12,0.65);tx=b.x+b.vx*flight;tz=b.z+b.vz*flight;
  } else if(runTarget) {
    tx=runTarget.x;tz=runTarget.z;
  } else if(isPresser) {
    const lead=owner?0.14:clamp(distance(p,b)/Math.max(length(b.vx,b.vz),8),0.12,0.4);tx=b.x+b.vx*lead;tz=b.z+b.vz*lead;
  } else if(isCover) {
    ({x:tx,z:tz}=screenTarget(s,p.team));
  } else if(possession) {
    ({x:tx,z:tz}=supportTarget(s,p,owner,tx*dir,tz*dir));
  } else if(p.slot<=5) {
    const mark=defensiveMarks(s,p.team,pressers).get(p.id);
    if(mark) {tx=Math.min(tx*dir+6,mark.x*dir)*dir;tz=mark.z;}
  }
  return {x:clamp(tx,-HL+3,HL-3),z:clamp(tz,-HW+2,HW-2),isPresser};
}

export function keeperTarget(s,p) {
  return keeperPosition(s,p);
}
