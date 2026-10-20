import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';
import {chromium} from 'playwright';
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0});const {port}=await service.listen();
const checks=[],errors=[],mark=(name)=>{checks.push({name,status:'passed'});console.log('PASS '+name);};
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--enable-unsafe-swiftshader']});
async function fixture(page,type='freeKick'){
 await page.evaluate(type=>{
  __T11.input.clear();const s=__T11.getState();s.phase='restart';s.phaseTime=0;s.offside=null;s.pendingSwitch=[null,null];s.receiver=[null,null];s.passFrom=s.passTeam=null;s.stats.passes=[0,0];s.stats.shots=[0,0];
  const x=type==='corner'?52.5:type==='goalKick'?-47:20,z=['corner','throwIn'].includes(type)?-34:0,taker=type==='goalKick'?0:8;
  for(const p of s.players)Object.assign(p,{charge:0,passCharge:0,passType:null,shotType:null,actionTime:0,aerial:null,vx:0,vz:0});
  s.restart={type,team:0,x,z,taker};Object.assign(s.ball,{x,z,y:.11,owner:null,vx:0,vy:0,vz:0,state:'dead'});s.selected[0]=taker;
 },type);
 await page.waitForFunction(()=>__T11.getState().phaseTime>2.1&&__T11.getState().restart?.armed);
}
async function boot(context){const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://localhost:${port}/?debug=1`);await page.waitForFunction(()=>window.__T11);await page.evaluate(()=>__T11.start({duration:360,humans:[true,false]}));await page.waitForFunction(()=>__T11.getState()?.phase==='playing');return page;}
try{
 const context=await browser.newContext({viewport:{width:1366,height:900}}),page=await boot(context);
 for(const type of ['freeKick','throwIn','goalKick','corner']){
  await fixture(page,type);const before=await page.evaluate(()=>({ball:{...__T11.getState().ball},time:__T11.getState().time}));await page.waitForTimeout(500);
  assert.equal(await page.evaluate(()=>__T11.getState().phase),'restart');assert.equal(await page.evaluate(()=>__T11.getState().time),before.time);
  await page.keyboard.down('KeyS');await page.waitForTimeout(150);await page.keyboard.up('KeyS');
  const aiming=await page.evaluate(()=>({r:__T11.getState().restart,guide:__T11.stats().passAimTarget}));assert.ok(aiming.r.aimZ>.99);assert.ok(aiming.guide.z>before.ball.z);
  assert.equal(await page.evaluate(()=>__T11.getState().ball.z),before.ball.z);
  await page.keyboard.down('KeyJ');await page.waitForFunction(()=>Number(document.querySelector('#charge-meter').getAttribute('aria-valuenow'))===100);await page.waitForTimeout(250);
  assert.equal(await page.evaluate(()=>__T11.getState().phase),'restart');assert.ok(await page.locator('#charge-wrap').isVisible());
  if(type==='freeKick')await page.screenshot({path:resolve(out,'free-kick-pass.png')});
  await page.keyboard.up('KeyJ');await page.waitForFunction(()=>__T11.getState().stats.passes[0]===1);assert.ok(await page.evaluate(()=>__T11.getState().ball.vz)>0);
  mark(`${type}: waits, retains aimed direction, holds full power and passes on keyboard release`);
 }
 await fixture(page);await page.keyboard.down('KeyD');await page.keyboard.down('Space');await page.waitForFunction(()=>__T11.stats().shotAimVisible&&__T11.getState().players[8].charge>.3);
 assert.equal(await page.evaluate(()=>__T11.stats().passAimTarget),null);await page.screenshot({path:resolve(out,'free-kick-shot.png')});
 await page.keyboard.press('Escape');assert.ok(await page.locator('#pause-dialog').isVisible());await page.keyboard.up('Space');await page.keyboard.up('KeyD');await page.locator('#resume').click();await page.waitForTimeout(400);
 assert.equal(await page.evaluate(()=>__T11.getState().phase),'restart');assert.equal(await page.evaluate(()=>__T11.getState().stats.shots[0]),0);
 await page.keyboard.down('Space');await page.waitForFunction(()=>__T11.getState().players[8].charge===1);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>__T11.getState().phase),'restart');await page.keyboard.up('Space');await page.waitForFunction(()=>__T11.getState().stats.shots[0]===1);mark('Shot guide and capped charge work; pause/resume cancels without kicking');
 await fixture(page,'goalKick');await page.evaluate(()=>{window.__pad={id:'test',index:0,connected:true,mapping:'standard',axes:[0,1,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[__pad]});__pad.buttons[1]={pressed:true,value:1};});
 await page.waitForFunction(()=>__T11.getState().players[0].charge>.25);await page.evaluate(()=>__pad.buttons[1]={pressed:false,value:0});await page.waitForFunction(()=>__T11.getState().stats.shots[0]===1);assert.ok(await page.evaluate(()=>__T11.getState().ball.vz)>0);mark('Emulated controller stick and B charge/release a directional goal kick');
 await page.evaluate(()=>__pad.connected=false);await page.keyboard.press('Escape');await page.locator('#pause-settings').click();await page.locator('#camera-mode').selectOption('third-person');await page.locator('#settings-dialog .dialog-close').click();await page.locator('#resume').click();
 await fixture(page);await page.keyboard.down('Space');await page.waitForFunction(()=>__T11.stats().shotAimVisible);const banner=await page.locator('#match-banner').boundingBox(),power=await page.locator('#charge-wrap').boundingBox();assert.ok(banner.y+banner.height<power.y);await page.screenshot({path:resolve(out,'third-person-restart.png')});await page.keyboard.up('Space');mark('Third-person restart guide and power bar stay separate from the instructions');
 await context.close();
 const mobileContext=await browser.newContext({viewport:{width:844,height:390},deviceScaleFactor:1,isMobile:true,hasTouch:true}),mobile=await boot(mobileContext);await fixture(mobile,'throwIn');
 assert.equal(await mobile.locator('[data-action=shoot]').textContent(),'Long throw');assert.equal(await mobile.locator('[data-action=pass]').textContent(),'Throw');
 const stick=await mobile.locator('#touch-stick').boundingBox(),shoot=await mobile.locator('[data-action=shoot]').boundingBox(),cdp=await mobileContext.newCDPSession(mobile);
 const points=[{x:stick.x+stick.width*.5,y:stick.y+stick.height*.8,id:1},{x:shoot.x+shoot.width*.5,y:shoot.y+shoot.height*.5,id:2}];await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
 await mobile.waitForFunction(()=>__T11.getState().players[8].charge===1);assert.equal(await mobile.locator('#charge-title').textContent(),'THROW POWER');assert.equal(await mobile.evaluate(()=>__T11.getState().phase),'restart');
 assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await mobile.screenshot({path:resolve(out,'throw-in-touch.png')});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await mobile.waitForFunction(()=>__T11.getState().stats.passes[0]===1);assert.equal(await mobile.evaluate(()=>__T11.getState().stats.shots[0]),0);assert.ok(await mobile.evaluate(()=>__T11.getState().ball.vy)>0);mark('Landscape touch joystick and Long throw charge/release with correct labels and flight');
 await fixture(mobile,'throwIn');await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});await mobile.waitForFunction(()=>__T11.getState().players[8].charge>.2);await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});await mobile.waitForTimeout(300);assert.equal(await mobile.evaluate(()=>__T11.getState().phase),'restart');assert.equal(await mobile.evaluate(()=>__T11.getState().stats.passes[0]),0);mark('Cancelled touch gestures clear charge without taking the restart');
 await mobile.setViewportSize({width:568,height:320});await fixture(mobile,'corner');assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const smallBanner=await mobile.locator('#match-banner').boundingBox(),radar=await mobile.locator('#radar').boundingBox(),score=await mobile.locator('.scorebug').boundingBox();assert.ok(smallBanner.x>=score.x+score.width&&smallBanner.x+smallBanner.width<=radar.x);
 await mobile.screenshot({path:resolve(out,'corner-small-touch.png')});mark('Compact landscape corner instructions fit between scoreboard and radar');
 await mobileContext.close();assert.deepEqual(errors,[]);mark('No browser JavaScript exceptions');await writeFile(resolve(out,'restart-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),checks,errors},null,2));
}finally{await browser.close();await service.close();}
