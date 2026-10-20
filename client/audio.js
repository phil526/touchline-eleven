import {IMPACTS,WHISTLES,impactSamples,whistleSamples,gaspSamples,ambienceSamples} from './sound-synthesis.js';
import {createSoundDirector,soundPosition} from './match-sound.js';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const assets={bed:'stadium-bed.mp3',swell:'stadium-swell.mp3',goal:'stadium-goal.mp3',applause:'stadium-applause.mp3'};

export class MatchAudio{
 constructor({context=null,loadAssets=true}={}){
  this.ctx=null;this.suppliedContext=context;this.loadAssets=loadAssets;this.levels={master:.65,effects:.7,crowd:.3};
  this.director=createSoundDirector();this.nodes=new Set();this.buffers={};this.loops=[];this.variants={};this.history=[];
  this.scene='menu';this.threat=0;this.assetStatus='idle';this.reactionAt=-Infinity;this.goalUntil=0;this.ready=Promise.resolve();
 }
 start(){
  if(this.ctx){if(this.ctx.state==='suspended')this.ctx.resume()?.catch(()=>{});return;}
  try{
   const C=globalThis.AudioContext||globalThis.webkitAudioContext;this.ctx=this.suppliedContext||new C();const c=this.ctx;
   this.master=c.createGain();this.master.gain.value=this.levels.master;this.master.connect(c.destination);
   const compressor=c.createDynamicsCompressor();compressor.threshold.value=-13;compressor.knee.value=14;compressor.ratio.value=4;compressor.attack.value=.004;compressor.release.value=.2;
   const limiter=c.createWaveShaper();limiter.curve=Float32Array.from({length:2049},(_,i)=>.94*Math.tanh((i/1024-1)/.94));
   compressor.connect(limiter).connect(this.master);
   this.effects=c.createGain();this.effects.gain.value=this.levels.effects*.8;this.effects.connect(compressor);this.crowd=c.createGain();this.crowd.gain.value=this.levels.crowd;this.crowd.connect(compressor);
   this.field=c.createGain();this.field.connect(this.effects);this.ui=c.createGain();this.ui.connect(this.effects);
   this.stands=c.createGain();this.stands.gain.value=0;this.stands.connect(this.crowd);
   for(const kind of Object.keys(IMPACTS))this.buffers[kind]=Array.from({length:4},(_,v)=>this.buffer(impactSamples(kind,c.sampleRate,v)));
   for(const kind of Object.keys(WHISTLES))this.buffers['whistle-'+kind]=[this.buffer(whistleSamples(kind,c.sampleRate))];
   this.buffers.gasp=[this.buffer(gaspSamples(c.sampleRate))];this.fallback=this.buffer(ambienceSamples(22050),22050);
   this.recordings={bed:this.fallback,swell:this.fallback};this.apply();this.assetStatus=this.loadAssets?'loading':'fallback';
   if(this.loadAssets)this.ready=Promise.allSettled(Object.entries(assets).map(async([name,file])=>{
    const response=await fetch(new URL('../assets/audio/'+file,import.meta.url));if(!response.ok)throw Error('Audio asset unavailable');
    this.recordings[name]=await c.decodeAudioData(await response.arrayBuffer());
   })).then(results=>{this.assetStatus=results.every(r=>r.status==='fulfilled')?'ready':'fallback';this.stopLoops();if(this.scene==='match')this.startLoops();});
  }catch{this.ctx?.close()?.catch(()=>{});this.ctx=null;this.assetStatus='unavailable';}
 }
 buffer(samples,rate=this.ctx.sampleRate){const b=this.ctx.createBuffer(1,samples.length,rate);b.copyToChannel(samples,0);return b;}
 set(levels){for(const k of ['master','effects','crowd'])if(Number.isFinite(levels[k]))this.levels[k]=clamp(levels[k],0,1);this.apply();}
 target(param,value,time=.05){const t=this.ctx.currentTime;param.cancelScheduledValues(t);param.setTargetAtTime(value,t,time);}
 apply(){if(!this.ctx)return;this.target(this.master.gain,this.levels.master);this.target(this.effects.gain,this.levels.effects*.8);this.target(this.crowd.gain,this.levels.crowd);}
 reset(){this.director.reset();this.stopVoices();this.reactionAt=-Infinity;this.goalUntil=0;this.threat=0;}
 stopVoices(){for(const v of [...this.nodes]){try{v.source.stop();}catch{}v.clean();}}
 suspend(){if(!this.ctx)return;this.stopVoices();this.stopLoops();this.ctx.suspend()?.catch(()=>{});}
 stopLoops(){for(const loop of this.loops){try{loop.source.stop();}catch{}loop.source.disconnect();loop.gain.disconnect();}this.loops=[];}
 startLoops(){
  if(!this.ctx||this.loops.length)return;
  for(const name of ['bed','swell']){const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=this.recordings[name];source.loop=true;gain.gain.value=0;source.connect(gain).connect(this.stands);source.start();this.loops.push({name,source,gain});}
 }
 oneShot(buffer,{gain=1,pan=0,bus=this.field,rate=1,priority=false,when=0}={}){
  if(!this.ctx||!buffer||this.ctx.state==='closed')return;
  if(this.nodes.size>=18||(this.nodes.size>=12&&!priority))return;
  const source=this.ctx.createBufferSource(),volume=this.ctx.createGain(),panner=this.ctx.createStereoPanner();
  source.buffer=buffer;source.playbackRate.value=rate;volume.gain.value=gain;panner.pan.value=clamp(pan,-.8,.8);source.connect(volume).connect(panner).connect(bus);
  const voice={source,clean:()=>{source.disconnect();volume.disconnect();panner.disconnect();this.nodes.delete(voice);}};
  this.nodes.add(voice);source.onended=voice.clean;source.start(Math.max(this.ctx.currentTime,when));return voice;
 }
 remember(event){this.history.push(event);if(this.history.length>64)this.history.shift();}
 play(kind='pass',pan=0,power=.55,gain=1){
  if(!this.ctx)return;const bank=this.buffers[kind];if(!bank)return;
  const variant=(this.variants[kind]||0)%bank.length;this.variants[kind]=variant+1;
  this.oneShot(bank[variant],{pan,gain:gain*(kind==='menu'?1:.45+.55*clamp(power,0,1)),rate:kind==='menu'?1:.97+.06*clamp(power,0,1),bus:kind==='menu'?this.ui:this.field});
  this.remember({kind,variant,power,pan});
 }
 whistle(kind){if(!this.ctx)return;this.oneShot(this.buffers['whistle-'+kind]?.[0],{gain:.9,priority:true});this.remember({whistle:kind});}
 react(kind){
  if(!this.ctx)return;const t=this.ctx.currentTime;if(kind!=='goal'&&(t<this.goalUntil||t-this.reactionAt<1.8))return;
  this.reactionAt=t;if(kind==='goal')this.goalUntil=t+5;
  const buffer=kind==='gasp'?this.buffers.gasp[0]:this.recordings[kind]||this.buffers.gasp[0];
  this.oneShot(buffer,{gain:kind==='goal'?.9:kind==='applause'?.5:.9,bus:this.stands,priority:kind==='goal'});this.remember({reaction:kind});
 }
 update(state,{active=false,paused=false,hidden=false,menu=false,camera=null}={}){
  const audible=active&&!paused&&!hidden&&(!menu||state?.phase==='fulltime'),directed=this.director.update(state,{audible});this.threat=directed.threat;
  if(!this.ctx)return;this.scene=active?'match':'menu';
  if(hidden){if(this.ctx.state==='running')this.suspend();return;}
  if(active)this.startLoops();else if(this.loops.length)this.stopLoops();
  this.target(this.field.gain,paused||menu&&state?.phase!=='fulltime'?0:1,.05);
  this.target(this.stands.gain,active?((paused||menu) ? .16 : 1):0,.18);
  for(const loop of this.loops)this.target(loop.gain.gain,loop.name==='bed'?.32:.06+this.threat*.5,.55);
  for(const cue of directed.cues){const position=soundPosition(cue,camera);if(cue.kind)this.play(cue.kind,position.pan,cue.power,position.gain);if(cue.whistle)this.whistle(cue.whistle);if(cue.reaction)this.react(cue.reaction);}
 }
 stats(){return {context:this.ctx?.state||'not-started',assets:this.assetStatus,voices:this.nodes.size,loops:this.loops.length,scene:this.scene,threat:this.threat,levels:{...this.levels},events:this.history.slice()};}
}
