import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0});const address=await service.listen();const origin=`http://127.0.0.1:${address.port}`;
let browser;const checks=[],errors=[];const mark=(name,data={})=>{checks.push({name,status:'passed',...data});console.log('PASS '+name);};
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1440,height:900}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/?debug=1');await page.waitForFunction(()=>window.__T11);await page.waitForTimeout(500);
 await page.screenshot({path:resolve(out,'title.png')});assert.equal(await page.locator('h1').getAttribute('aria-label'),'Touchline Eleven');assert.ok(await page.locator('#play-practice').isVisible());mark('Broadcast title screen and game renderer load');
 await page.locator('#play-offline').click();await page.locator('#duration').selectOption('60');await page.locator('#mentality').selectOption('attacking');await page.locator('#kickoff').click();await page.waitForFunction(()=>__T11.getState()?.phase==='playing');
 assert.equal(await page.evaluate(()=>__T11.getState().players.length),22);mark('Offline setup starts full 11-a-side match');
 // Establish room to move, then wait on simulation state rather than a host
 // sleep that can expire before several frames render on a busy machine.
 const before=await page.evaluate(()=>{
  __T11.input.clear();const s=__T11.getState();s.phase='playing';s.restart=null;s.offside=null;s.pendingSwitch=[null,null];s.selected[0]=9;
  for(const p of s.players)Object.assign(p,{x:-35+p.slot*2,z:p.team===0?-25:25,vx:0,vz:0,cooldown:3,actionTime:0,charge:0});
  const p=s.players[9];Object.assign(p,{x:-10,z:0,cooldown:0,facing:0});Object.assign(s.ball,{x:-9.4,z:0,y:.11,owner:9,lastTouch:9,vx:0,vy:0,vz:0,state:'controlled'});return {id:p.id,x:p.x};
 });await page.keyboard.down('KeyD');await page.waitForFunction(({id,x})=>__T11.getState().players[id].x>x+.4,before,{timeout:10000});await page.keyboard.up('KeyD');const after=await page.evaluate(id=>__T11.getState().players[id].x,before.id);assert.ok(after>before.x+.2);mark('Keyboard movement changes authoritative player position',{metres:after-before.x});
 // The live movement check can run long enough for defenders to win possession.
 // Establish only the shooting precondition; charge and shot count still come
 // exclusively from the real held/released keyboard input below.
 const shotFixture=await page.evaluate(()=>{
  __T11.input.clear();const s=__T11.getState(),shooter=9;
  s.phase='playing';s.phaseTime=0;s.restart=null;s.offside=null;s.receiver=[null,null];s.pendingSwitch=[null,null];s.passFrom=s.passTeam=null;s.ballFlightTime=1;s.selected[0]=shooter;
  for(const p of s.players){p.x=-30+p.slot*2;p.z=p.team===0?-24:24;p.vx=p.vz=0;p.cooldown=2;p.charge=0;p.actionTime=p.actionDuration=0;p.receiveTime=0;p.touchTime=0;p.shotLatch=false;}
  const p=s.players[shooter];Object.assign(p,{x:18,z:0,facing:0,cooldown:0,controlMode:'normal'});
  Object.assign(s.ball,{x:p.x+.55,y:.11,z:p.z,vx:0,vy:0,vz:0,owner:shooter,state:'controlled',lastTouch:shooter});
  s.previous=[{mx:0,mz:0,shoot:false},{mx:0,mz:0,shoot:false}];
  return {shooter,shotsBefore:s.stats.shots[0],tick:s.tick};
 });
 // Let input.clear() cancellation reach authority before issuing a fresh hold.
 await page.waitForFunction(tick=>{const s=__T11.getState();return s.tick>tick+2&&!s.previous[0].cancelCharge;},shotFixture.tick);
 assert.equal(await page.evaluate(()=>__T11.getState().ball.owner),shotFixture.shooter);
 await page.keyboard.down('Space');const charging=await(await page.waitForFunction(id=>{const s=__T11.getState(),p=s.players[id];return p.charge>.1?{charge:p.charge,owner:s.ball.owner}:false;},shotFixture.shooter)).jsonValue();
 await page.keyboard.up('Space');assert.ok(charging.charge>0);assert.equal(charging.owner,shotFixture.shooter);
 await page.waitForFunction(({shooter,shotsBefore})=>__T11.getState().stats.shots[0]===shotsBefore+1&&__T11.getState().ball.owner!==shooter,shotFixture);
 mark('Hold/release shooting charges and releases a shot',{charge:charging.charge});
 await page.keyboard.press('Escape');assert.ok(await page.locator('#pause-dialog').isVisible());const paused=await page.evaluate(()=>__T11.getState().time);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>__T11.getState().time),paused);await page.locator('#resume').click();mark('Offline pause stops simulation and resumes');
 await page.keyboard.down('KeyD');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('KeyD');assert.equal(await page.evaluate(()=>__T11.input.sample().mx),0);await page.locator('#resume').click();mark('Focus loss clears held input');
 await page.screenshot({path:resolve(out,'match.png')});
 await page.evaluate(()=>{__T11.getState().options.humans=[false,false];__T11.advance(150);});await page.waitForFunction(()=>document.getElementById('results-dialog').open);const result=await page.evaluate(()=>({state:__T11.getState().score,text:document.getElementById('final-score').textContent,half:__T11.getState().half}));assert.equal(result.half,2);assert.equal(result.text,result.state.join(' – '));mark('Complete match changes ends and results match authority',result);
 await page.locator('#rematch').click();await page.waitForFunction(()=>__T11.getState().phase!=='fulltime'&&!document.getElementById('results-dialog').open&&document.getElementById('loading').hidden);assert.deepEqual(await page.evaluate(()=>__T11.getState().score),[0,0]);mark('Offline rematch resets score');await page.locator('#pause-open').click();await page.locator('#leave-match').click();await page.locator('#quit-confirm').click();await page.locator('#return-home').click();
 // Standard Gamepad API is emulated: no physical controller certification.
 await page.evaluate(()=>{window.__fakePad={id:'Test standard pad',index:0,connected:true,mapping:'standard',axes:[.6,-.4],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[window.__fakePad]});const ev=new Event('gamepadconnected');ev.gamepad=window.__fakePad;window.dispatchEvent(ev);});
 await page.evaluate(()=>__T11.start({duration:60,humans:[true,false]}));await page.waitForTimeout(150);const pad=await page.evaluate(()=>__T11.input.sample());assert.ok(pad.mx>.3&&pad.mz<-.2);await page.evaluate(()=>{__fakePad.connected=false;Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]});window.dispatchEvent(new Event('gamepaddisconnected'));});assert.equal(await page.evaluate(()=>__T11.input.sample().mx),0);mark('Emulated standard gamepad analogue movement and disconnect');
 // Two isolated browser contexts, using the real server and room interface.
 await page.keyboard.press('Escape');await page.locator('#leave-match').click();await page.locator('#quit-confirm').click();await page.locator('#return-home').click();await page.locator('#play-online').click();await page.locator('#server-url').fill(origin.replace('http','ws')+'/ws');await page.locator('#create-room').click();await page.waitForFunction(()=>__T11.getNetwork()?.room);
 const code=await page.locator('#room-display').textContent();const guestContext=await browser.newContext({viewport:{width:1280,height:800}});const guest=await guestContext.newPage();guest.on('pageerror',e=>errors.push(e.message));await guest.goto(origin+'/?debug=1');await guest.locator('#play-online').click();await guest.locator('#server-url').fill(origin.replace('http','ws')+'/ws');await guest.locator('#room-code').fill(code);await guest.locator('#join-room').click();await guest.waitForFunction(()=>__T11.getNetwork()?.room);
 await page.locator('#online-duration').selectOption('180');await guest.waitForFunction(()=>document.getElementById('online-duration').value==='180');await guest.locator('#online-tactic').selectOption('defensive');await page.waitForFunction(()=>__T11.getNetwork().room.settings.tactics[1]==='defensive');await page.locator('#ready').click();await guest.locator('#ready').click();await page.waitForFunction(()=>__T11.getState()?.tick>100&&__T11.getNetwork().room.phase==='playing');await guest.waitForFunction(()=>__T11.getState()?.tick>100&&__T11.getNetwork().room.phase==='playing');
 assert.deepEqual(await page.evaluate(()=>__T11.getState().score),await guest.evaluate(()=>__T11.getState().score));mark('Two browser contexts create/join, synchronise tactics, ready and agree on score');
 await page.locator('#pause-open').click();const tick=await page.evaluate(()=>__T11.getState().tick);await page.waitForTimeout(350);assert.ok(await page.evaluate(()=>__T11.getState().tick)>tick);await page.locator('#resume').click();mark('Online menu cannot pause authority');
 await page.evaluate(()=>{const net=__T11.getNetwork(),onStatus=net.onStatus;window.__reconnectObserved=false;window.__oldSocket=net.socket;window.__reconnectTick=net.latestState.tick;net.onStatus=status=>{if(status==='reconnecting')__reconnectObserved=true;onStatus(status);};net.socket.close();});await page.waitForFunction(()=>{const net=__T11.getNetwork();return __reconnectObserved&&net.socket!==__oldSocket&&net.status==='connected'&&net.latestState.tick>__reconnectTick;});assert.equal(await page.evaluate(()=>__T11.getNetwork().room.code),code);mark('Browser transport reconnects to original room');
 await guestContext.close();await context.close();
 const mobileContext=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:1,isMobile:true,hasTouch:true});const mobile=await mobileContext.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(origin+'/?debug=1');await mobile.evaluate(()=>__T11.start({duration:60,humans:[true,false]}));await mobile.waitForFunction(()=>__T11.getState()?.phase==='playing');
 const stick=await mobile.locator('#touch-stick').boundingBox(),shoot=await mobile.locator('[data-action=shoot]').boundingBox();assert.ok(stick&&shoot);const cdp=await mobileContext.newCDPSession(mobile);
 const points=[{x:stick.x+stick.width*.8,y:stick.y+stick.height*.5,id:1},{x:shoot.x+shoot.width*.5,y:shoot.y+shoot.height*.5,id:2}];await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});await mobile.waitForTimeout(200);const touch=await mobile.evaluate(()=>__T11.input.sample());assert.ok(touch.mx>.5&&touch.shoot);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForTimeout(100);const cleared=await mobile.evaluate(()=>__T11.input.sample());assert.equal(cleared.mx,0);assert.equal(cleared.shoot,false);mark('Emulated mobile simultaneous joystick and held shot release');
 const overflow=await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);await mobile.screenshot({path:resolve(out,'mobile.png')});mark('Landscape mobile HUD fits viewport');await mobileContext.close();
 assert.deepEqual(errors,[]);mark('No browser JavaScript exceptions');
 const report={testedAt:new Date().toISOString(),browser:browser.version(),checks,errors};await writeFile(resolve(out,'browser-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){for(const context of browser?.contexts()||[])for(const p of context.pages()){try{console.error('Browser failure state',await p.evaluate(()=>({phase:window.__T11?.getState()?.phase,tick:window.__T11?.getState()?.tick,network:window.__T11?.getNetwork()?.status,room:window.__T11?.getNetwork()?.room?.phase,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),error:document.querySelector('#online-error')?.textContent})));}catch{}}throw error;}finally{await browser?.close();await service.close();}
