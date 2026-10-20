// Original deterministic sources. Audio randomness never touches match authority.
const TAU=Math.PI*2;
export const IMPACTS={
 pass:{duration:.15,pitch:155,body:.52,snap:.27,decay:35},through:{duration:.18,pitch:142,body:.6,snap:.33,decay:30},loft:{duration:.2,pitch:125,body:.62,snap:.28,decay:25},
 shot:{duration:.26,pitch:112,body:.78,snap:.53,decay:23},finesse:{duration:.2,pitch:148,body:.54,snap:.38,decay:29},chip:{duration:.14,pitch:205,body:.38,snap:.22,decay:38},
 header:{duration:.16,pitch:94,body:.58,snap:.08,decay:32},volley:{duration:.23,pitch:128,body:.72,snap:.62,decay:27},clearance:{duration:.24,pitch:119,body:.7,snap:.46,decay:25},
 tackle:{duration:.24,pitch:85,body:.36,snap:.45,decay:22},slide:{duration:.42,pitch:80,body:.26,snap:.38,decay:12},catch:{duration:.16,pitch:100,body:.4,snap:.2,decay:34},parry:{duration:.2,pitch:137,body:.48,snap:.4,decay:30},
 post:{duration:.7,pitch:360,body:.38,snap:.16,decay:6},menu:{duration:.07,pitch:620,body:.12,snap:.025,decay:65}
};
export const WHISTLES={kickoff:[[0,.32]],foul:[[0,.48]],offside:[[0,.16],[.24,.25]],halftime:[[0,.23],[.36,.48]],fulltime:[[0,.2],[.32,.2],[.65,.7]]};
function noise(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/2147483648-1;};}
export function impactSamples(kind,rate=44100,variant=0){
 const p=IMPACTS[kind]||IMPACTS.pass,data=new Float32Array(Math.ceil(rate*p.duration)),random=noise(9041+variant*307+Object.keys(IMPACTS).indexOf(kind)*739),detune=1+(variant-1.5)*.025;let low=0,phase=0;
 for(let i=0;i<data.length;i++){
  const t=i/rate,n=random();low+=.23*(n-low);phase+=TAU*p.pitch*detune*(.62+.38*Math.exp(-t*55))/rate;
  const attack=Math.min(1,t/.0015),tail=Math.min(1,(p.duration-t)/.012);
  const body=kind==='post'?Math.sin(TAU*p.pitch*t)+.35*Math.sin(TAU*p.pitch*2.71*t)+.18*Math.sin(TAU*p.pitch*4.13*t):Math.sin(phase)+.2*Math.sin(phase*2.2);
  const friction=kind==='slide'?low*Math.exp(-t*6):0;
  data[i]=attack*tail*(p.body*body*Math.exp(-p.decay*t)+p.snap*(n-low)*Math.exp(-t*(kind==='slide'?12:100))+friction*.65)*.72;
 }return data;
}
export function whistleSamples(kind,rate=44100){
 const pulses=WHISTLES[kind]||WHISTLES.foul,duration=Math.max(...pulses.map(([t,d])=>t+d))+.1,data=new Float32Array(Math.ceil(rate*duration)),random=noise(191);
 for(const [start,length] of pulses)for(let i=0;i<Math.ceil(length*rate);i++){
  const t=i/rate,envelope=Math.min(1,t/.015,(length-t)/.035),flutter=.82+.18*Math.sin(TAU*37*t);
  // Close resonances, breath noise and pea flutter with soft edges.
  const tone=.5*Math.sin(TAU*2350*t+1.4*Math.sin(TAU*24*t))+.3*Math.sin(TAU*2980*t)+.11*random();
  data[Math.floor(start*rate)+i]=tone*flutter*Math.max(0,envelope)*.31;
 }return data;
}
export function gaspSamples(rate=44100){
 const duration=1.65,data=new Float32Array(Math.ceil(rate*duration)),random=noise(4181);
 for(let v=0;v<24;v++){
  const pitch=108+(random()+1)*48,delay=(random()+1)*.07,phase=random()*Math.PI;
  for(let i=Math.floor(delay*rate);i<data.length;i++){
   const t=i/rate-delay,envelope=Math.min(1,t/.16)*Math.exp(-t*2.8)*Math.min(1,(duration-i/rate)/.2),fundamental=TAU*pitch*(t-.035*t*t)+phase;
   data[i]+=envelope*(Math.sin(fundamental)*.35+Math.sin(fundamental*3)*.5+Math.sin(fundamental*6)*.18)/24;
  }
 }return data;
}
export function ambienceSamples(rate=22050){
 const data=new Float32Array(rate*6),random=noise(341),length=data.length;let low=0;
 for(let i=0;i<length;i++){low+=(random()-low)*.08;data[i]=low*.16*(.75+.25*Math.sin(TAU*i/length*3));}
 const jump=data[length-1]-data[0];for(let i=0;i<length;i++)data[i]-=jump*i/(length-1);return data;
}
