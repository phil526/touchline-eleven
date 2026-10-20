import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';
import {chromium} from 'playwright';
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0});const {port}=await service.listen();
const checks=[],errors=[],mark=(name,data={})=>{checks.push({name,status:'passed',...data});console.log('PASS '+name);};
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.goto(`http://localhost:${port}/?debug=1`);await page.waitForFunction(()=>window.__T11);
 assert.equal(await page.evaluate(()=>__T11.audio.stats().context),'not-started');mark('Audio stays silent until a user gesture');
 await page.locator('#settings-open').click();await page.waitForFunction(()=>__T11.audio.stats().assets==='ready');
 const decoded=await page.evaluate(()=>Object.fromEntries(Object.entries(__T11.audio.recordings).map(([k,b])=>[k,{seconds:b.duration,channels:b.numberOfChannels}])));
 assert.equal(Object.keys(decoded).length,4);assert.equal(decoded.bed.channels,2);assert.ok(decoded.goal.seconds>8);mark('All four self-hosted crowd recordings decode successfully',decoded);
 assert.equal(await page.locator('#settings-dialog a[href*="free-crowd"]').count(),1);
 await page.locator('#settings-dialog .dialog-close').click();await page.locator('#play-offline').click();await page.locator('#kickoff').click();
 await page.waitForFunction(()=>__T11.getState()?.phase==='playing').catch(async e=>{console.log(await page.evaluate(()=>({phase:__T11.getState()?.phase,tick:__T11.getState()?.tick,dialogs:[...document.querySelectorAll('dialog[open]')].map(x=>x.id),audio:__T11.audio.stats()})));await page.screenshot({path:resolve(out,'audio-failure.png')});throw e;});
 assert.equal(await page.evaluate(()=>__T11.audio.stats().events.filter(e=>e.whistle==='kickoff').length),1);mark('Kick-off uses one referee whistle and starts the stadium ambience');
 const prepare=async()=>page.evaluate(()=>{
  __T11.input.clear();const s=__T11.getState();s.phase='playing';s.time=10;s.phaseTime=0;s.restart=null;s.offside=null;s.receiver=[null,null];s.pendingSwitch=[null,null];s.passFrom=s.passTeam=null;s.ballFlightTime=1;s.selected=[9,20];
  for(const p of s.players)Object.assign(p,{x:-30+p.slot,z:p.team?26:-26,vx:0,vz:0,cooldown:10,actionTime:0,actionDuration:0,charge:0,shotType:null,shotLatch:false,aerial:null,receiveTime:0});
  const p=s.players[9];Object.assign(p,{x:20,z:0,cooldown:0,facing:0});Object.assign(s.ball,{x:20.6,z:0,y:.11,owner:9,lastTouch:9,state:'controlled',vx:0,vy:0,vz:0});s.previous=[{},{}];
  return __T11.audio.history.length;
 });
 for(const [kind,key] of [['shot',null],['finesse','KeyZ'],['chip','KeyX']]){
  const before=await prepare();if(key)await page.keyboard.down(key);await page.keyboard.down('Space');await page.waitForFunction(()=>__T11.getState().players[9].charge>.18);await page.keyboard.up('Space');if(key)await page.keyboard.up(key);
  await page.waitForFunction(({kind,before})=>__T11.audio.history.slice(before).some(e=>e.kind===kind),{kind,before});
 }mark('Real keyboard charge/release selects normal, finesse and chip contact sounds');
 const beforeHeader=await prepare();await page.evaluate(()=>{const s=__T11.getState();Object.assign(s.ball,{owner:null,lastTouch:8,x:18,y:2.55,vx:8,vy:-.4,state:'flight'});});
 await page.keyboard.press('Space');await page.waitForFunction(before=>__T11.audio.history.slice(before).some(e=>e.kind==='header'),beforeHeader);mark('A timed aerial contact selects the header sound');
 await prepare();const threat=await page.evaluate(()=>{const s=__T11.getState(),a=__T11.audio;s.ball.x=0;a.update(s,{active:true});const calm=a.threat;s.ball.x=46;a.update(s,{active:true});return {calm,danger:a.threat};});assert.equal(threat.calm,0);assert.ok(threat.danger>.9);mark('Crowd anticipation rises near the attacking goal',threat);
 await prepare();await page.evaluate(()=>{const s=__T11.getState();Object.assign(s.ball,{owner:null,x:52.3,z:5,y:1,vx:30,vy:0,vz:0,lastShot:{tick:s.tick,team:0}});});
 await page.waitForFunction(()=>__T11.audio.history.some(e=>e.reaction==='gasp'));mark('A real close shot wide triggers a gasp');
 await prepare();await page.waitForTimeout(2100);await page.evaluate(()=>{const s=__T11.getState();Object.assign(s.ball,{owner:null,x:52.3,z:0,y:1,vx:30,vy:0,vz:0});});
 await page.waitForFunction(()=>__T11.audio.history.some(e=>e.reaction==='goal'));const goalsBefore=await page.evaluate(()=>__T11.audio.history.filter(e=>e.reaction==='goal').length);
 await page.waitForTimeout(900);assert.equal(await page.evaluate(()=>__T11.audio.history.filter(e=>e.reaction==='goal').length),goalsBefore);mark('Goal celebration triggers once while the automatic replay runs');
 await page.keyboard.press('Enter');await page.keyboard.press('Escape');await page.locator('#pause-settings').click();
 await page.locator('#volume-effects').fill('0');await page.locator('#volume-crowd').fill('0');await page.waitForTimeout(400);
 const mute=await page.evaluate(()=>({effects:__T11.audio.effects.gain.value,crowd:__T11.audio.crowd.gain.value,master:__T11.audio.master.gain.value}));assert.ok(mute.effects<.001&&mute.crowd<.001&&mute.master>.1);mark('Effects and crowd controls mute independently',mute);
 await page.locator('#volume-master').fill('0');await page.reload();await page.waitForFunction(()=>window.__T11);await page.locator('#settings-open').click();
 assert.equal(await page.evaluate(()=>__T11.audio.master.gain.value),0);mark('Saved mute is respected from the first audio gesture after reload');
 await page.locator('#settings-dialog .dialog-close').click();await page.locator('#quit-game').click();await page.locator('#quit-confirm').click();
 await page.waitForFunction(()=>__T11.audio.stats().context==='suspended');assert.equal(await page.evaluate(()=>__T11.audio.stats().loops),0);mark('Quit releases voices and ambience and suspends the audio context');
 // Actual offline Web Audio output, including the compressor/limiter and stereo buses.
 const rendered=await page.evaluate(async()=>{
  const {MatchAudio}=await import('./client/audio.js');
  async function render(master,mutedEffects=false){
   const ctx=new OfflineAudioContext(2,44100*3,44100),a=new MatchAudio({context:ctx,loadAssets:false});a.set({master,effects:mutedEffects?0:1,crowd:0});a.start();
   a.oneShot(a.buffers.shot[0],{when:.1,pan:-.7});a.oneShot(a.buffers.header[0],{when:.7,pan:.7});a.oneShot(a.buffers['whistle-fulltime'][0],{when:1.2});
   const b=await ctx.startRendering(),left=b.getChannelData(0),right=b.getChannelData(1);let peak=0,energy=0,leftEarly=0,rightEarly=0;
   for(let i=0;i<left.length;i++){peak=Math.max(peak,Math.abs(left[i]),Math.abs(right[i]));energy+=left[i]**2+right[i]**2;if(i<22050){leftEarly+=left[i]**2;rightEarly+=right[i]**2;}}
   return {peak,energy,leftEarly,rightEarly,remaining:a.nodes.size};
  }
  return {audible:await render(1),masterMuted:await render(0),effectsMuted:await render(1,true)};
 });assert.ok(rendered.audible.energy>1&&rendered.audible.peak<.95);assert.ok(rendered.audible.leftEarly>rendered.audible.rightEarly*2);assert.equal(rendered.masterMuted.peak,0);assert.equal(rendered.effectsMuted.peak,0);assert.equal(rendered.audible.remaining,0);mark('Rendered stereo output is finite, bounded and truly silent when muted',rendered);
 // Produce a short audition using the actual mixer and shipped recordings.
 const demo=await page.evaluate(async()=>{
  const {MatchAudio}=await import('./client/audio.js'),ctx=new OfflineAudioContext(2,44100*16,44100),a=new MatchAudio({context:ctx});a.start();await a.ready;a.stands.gain.value=1;
  a.oneShot(a.recordings.bed,{when:0,bus:a.stands,gain:.3,priority:true});
  const labels=[['pass',1],['shot',2],['chip',3],['finesse',4],['header',5],['volley',6]];
  for(const [kind,when] of labels)a.oneShot(a.buffers[kind][0],{when,gain:.85,priority:true});
  a.oneShot(a.buffers['whistle-offside'][0],{when:7.2,priority:true});a.oneShot(a.buffers.gasp[0],{when:8.5,bus:a.stands,gain:1,priority:true});a.oneShot(a.recordings.goal,{when:10,bus:a.stands,gain:.9,priority:true});
  a.master.gain.setTargetAtTime(0,15,.2);const b=await ctx.startRendering(),bytes=new Uint8Array(b.length*4+44),v=new DataView(bytes.buffer);const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));
  str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,2,true);v.setUint32(24,b.sampleRate,true);v.setUint32(28,b.sampleRate*4,true);v.setUint16(32,4,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,bytes.length-44,true);
  const l=b.getChannelData(0),r=b.getChannelData(1);for(let i=0;i<b.length;i++){v.setInt16(44+i*4,Math.max(-1,Math.min(1,l[i]))*32767,true);v.setInt16(46+i*4,Math.max(-1,Math.min(1,r[i]))*32767,true);}let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);
 });await writeFile(resolve(out,'sound-design-demo.wav'),Buffer.from(demo,'base64'));mark('Rendered a 16-second audition through the real game mixer');
 const mobile=await browser.newContext({viewport:{width:844,height:390},hasTouch:true,isMobile:true});const phone=await mobile.newPage();phone.on('pageerror',e=>errors.push(e.message));
 await phone.goto(`http://localhost:${port}/?debug=1`);await phone.waitForFunction(()=>window.__T11);await phone.locator('#play-offline').tap();await phone.waitForFunction(()=>__T11.audio.stats().assets==='ready');assert.equal(await phone.evaluate(()=>__T11.audio.stats().context),'running');
 await phone.locator('#kickoff').tap();await phone.waitForFunction(()=>__T11.getState()?.phase==='playing');assert.equal(await phone.evaluate(()=>__T11.audio.stats().loops),2);mark('Touch gestures unlock the audio and start the two bounded ambience layers');
 await phone.locator('#pause-open').tap();await phone.locator('#pause-settings').tap();await phone.locator('#volume-crowd').scrollIntoViewIfNeeded();
 const slider=await phone.locator('#volume-crowd').boundingBox();await phone.touchscreen.tap(slider.x+slider.width*.5,slider.y+slider.height*.5);await phone.screenshot({path:resolve(out,'sound-settings-phone.png')});
 assert.ok(await phone.evaluate(()=>__T11.audio.levels.crowd>.35));assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);mark('Audio controls and recording attribution remain usable on a landscape phone');
 await phone.evaluate(()=>__T11.audio.suspend());await phone.waitForFunction(()=>__T11.audio.stats().context==='suspended');await phone.locator('#volume-crowd').tap();await phone.waitForFunction(()=>__T11.audio.stats().context==='running');mark('A fresh touch resumes audio after context suspension');
 await mobile.close();
 const fallback=await browser.newPage();fallback.on('pageerror',e=>errors.push(e.message));await fallback.route('**/assets/audio/*.mp3',r=>r.abort());
 await fallback.goto(`http://localhost:${port}/?debug=1`);await fallback.waitForFunction(()=>window.__T11);await fallback.locator('#play-offline').click();await fallback.locator('#kickoff').click();await fallback.waitForFunction(()=>__T11.getState()?.phase==='playing'&&__T11.audio.stats().assets==='fallback');assert.equal(await fallback.evaluate(()=>__T11.audio.stats().loops),2);mark('Failed crowd downloads fall back without stopping play');await fallback.close();
 const silent=await browser.newPage();silent.on('pageerror',e=>errors.push(e.message));await silent.addInitScript(()=>{window.AudioContext=undefined;window.webkitAudioContext=undefined;});
 await silent.goto(`http://localhost:${port}/?debug=1`);await silent.waitForFunction(()=>window.__T11);await silent.locator('#play-offline').click();await silent.locator('#kickoff').click();await silent.waitForFunction(()=>__T11.getState()?.phase==='playing');assert.equal(await silent.evaluate(()=>__T11.audio.stats().assets),'unavailable');mark('Unavailable Web Audio leaves the game playable');await silent.close();
 assert.deepEqual(errors,[]);mark('No browser JavaScript errors');
 await writeFile(resolve(out,'audio-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),checks,errors},null,2));
}finally{await browser.close();await service.close();}
