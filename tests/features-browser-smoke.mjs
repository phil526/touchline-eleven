import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0}),address=await service.listen(),origin=`http://127.0.0.1:${address.port}`;
let browser,page;const checks=[],errors=[];const mark=(name,data={})=>{checks.push({name,status:'passed',...data});console.log('PASS '+name);};
const options={viewport:{width:1280,height:800}};
async function fixture(target,ownership='ours'){
 await target.evaluate(ownership=>{
  __T11.input.clear();const s=__T11.getState();s.phase='playing';s.phaseTime=0;s.restart=null;s.offside=null;s.passFrom=s.passTeam=null;s.receiver=[null,null];s.pendingSwitch=[null,null];s.selected[0]=9;s.previous=[{shoot:false},{shoot:false}];
  for(const p of s.players)Object.assign(p,{x:-35+p.slot*2,z:p.team===0?-25:25,vx:0,vz:0,cooldown:3,charge:0,shotLatch:false,actionTime:0,actionDuration:0,slideTime:0,anim:'idle',touchTime:0,receiveTime:0});
  Object.assign(s.players[9],{x:15,z:0,facing:0,cooldown:0,stamina:1});Object.assign(s.players[20],{x:35,z:0,facing:Math.PI,cooldown:3});
  Object.assign(s.ball,{x:ownership==='ours'?15.55:35,y:.11,z:0,vx:0,vy:0,vz:0,owner:ownership==='ours'?9:20,lastTouch:ownership==='ours'?9:20,state:'controlled'});
 },ownership);
}
async function camera(target,mode){await target.locator('#pause-open').click();await target.locator('#pause-settings').click();await target.locator('#camera-mode').selectOption(mode);await target.locator('#settings-dialog .dialog-close').click();await target.locator('#resume').click();await target.waitForFunction(mode=>__T11.stats().cameraMode===mode,mode);}
async function goal(target){
 await fixture(target);await target.waitForTimeout(1000);
 const before=await target.evaluate(()=>{const s=__T11.getState();for(const p of s.players){p.z=25;p.cooldown=3;}Object.assign(s.ball,{owner:null,state:'flight',x:51.9,y:.4,z:0,vx:30,vy:0,vz:0,lastTouch:9});return [...s.score];});
 await target.waitForFunction(()=>__T11.getReplay().active);return before;
}
async function freezeFrame(target){await target.evaluate(()=>{const original=requestAnimationFrame;window.__qaNext=null;window.requestAnimationFrame=fn=>{window.__qaNext=fn;return 0;};window.__qaResume=()=>{requestAnimationFrame=original;if(__qaNext)original(__qaNext);};});}
async function report(error){await writeFile(resolve(out,'features-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),browser:browser?.version(),checks,errors,...(error?{failure:String(error.stack||error)}:{})},null,2));}
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext(options);page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{if(!localStorage.getItem('t11.preferences'))localStorage.setItem('t11.preferences',JSON.stringify({cameraMode:'first-person',quality:'low',shadows:false}));});
 await page.goto(origin+'/?debug=1');await page.waitForFunction(()=>window.__T11);
 assert.deepEqual(await page.locator('#camera-mode option').evaluateAll(o=>o.map(e=>e.value)),['broadcast','telebroadcast','third-person']);assert.equal(await page.evaluate(()=>__T11.preferences.cameraMode),'third-person');await page.reload();await page.waitForFunction(()=>window.__T11);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('t11.preferences')).cameraMode),'third-person');
 await page.evaluate(()=>__T11.start({duration:360,humans:[true,false]}));await page.waitForFunction(()=>__T11.getState()?.phase==='playing');
 const follow=await page.evaluate(()=>{const s=__T11.getState(),r=__T11.stats(),p=s.players[s.selected[0]];return {mode:r.cameraMode,hidden:r.hiddenPlayerId,distance:Math.hypot(r.cameraPosition.x-p.x,r.cameraPosition.z-p.z),height:r.cameraPosition.y};});
 assert.equal(follow.mode,'third-person');assert.equal(follow.hidden,null);assert.ok(follow.distance>3);assert.ok(follow.height>2);await page.screenshot({path:resolve(out,'third-person.png')});mark('Legacy camera preference migrates to visible third-person follow camera',follow);
 await camera(page,'broadcast');await fixture(page,'opponents');const startX=await page.evaluate(()=>__T11.getState().players[9].x);await page.keyboard.press('KeyF');
 const slide=await(await page.waitForFunction(()=>{const p=__T11.getState().players[9];return p.anim==='slide'&&p.actionTime>0?{duration:p.actionDuration,stamina:p.stamina}:false;})).jsonValue();assert.ok(slide.duration>.5);await page.waitForFunction(()=>__T11.getState().players[9].actionTime<=0);assert.ok(await page.evaluate(x=>__T11.getState().players[9].x>x+.5,startX));assert.equal(await page.evaluate(()=>__T11.getState().phase),'playing');mark('F performs a committed slide with recovery; an empty challenge causes no foul',slide);
 const targets=[];
 for(const key of ['KeyW','KeyS']){
  await fixture(page);await page.keyboard.down(key);await page.keyboard.down('Space');
  const aim=await(await page.waitForFunction(()=>{const r=__T11.stats();return r.shotAimTarget?{target:r.shotAimTarget,passTarget:r.passTargetId,power:__T11.getState().players[9].charge}:false;})).jsonValue();targets.push(aim.target.z);assert.equal(aim.passTarget,null);assert.ok(aim.power>0);
  if(key==='KeyW'){await freezeFrame(page);await page.screenshot({path:resolve(out,'shot-aim.png')});await page.evaluate(()=>__qaResume());}
  await page.keyboard.up('Space');await page.keyboard.up(key);await page.waitForFunction(()=>__T11.stats().shotAimTarget===null&&document.getElementById('charge-wrap').hidden);
 }
 assert.ok(targets[0]<-1&&targets[1]>1);mark('Charging shows a directional shot target and hides the passing preview; release clears both guide and power',{targets});
 await fixture(page);await page.evaluate(()=>{const s=__T11.getState(),p=s.players[9];s.offside={team:0,candidates:[9]};Object.assign(s.ball,{owner:null,state:'free',x:p.x,y:.11,z:p.z,vx:0,vy:0,vz:0,lastTouch:6});s.ballFlightTime=1;});await page.waitForFunction(()=>__T11.getState().restart?.reasonCode==='offside');await page.waitForFunction(()=>document.getElementById('banner-title').textContent==='OFFSIDE');assert.match(await page.locator('#banner-bottom').textContent(),/Offside/i);mark('Offside free kicks display their actual reason');
 let before=await goal(page);assert.deepEqual(await page.evaluate(()=>__T11.getState().score),[before[0]+1,before[1]]);await page.locator('#skip-replay').click();await page.waitForFunction(()=>!__T11.getReplay().active);assert.deepEqual(await page.evaluate(()=>__T11.getState().score),[before[0]+1,before[1]]);assert.equal(await page.locator('#goal-replay').isVisible(),false);mark('A scored goal starts one replay; Skip preserves the authoritative score');
 before=await goal(page);await freezeFrame(page);await page.screenshot({path:resolve(out,'goal-replay.png')});await page.evaluate(()=>__qaResume());await page.keyboard.press('Space');await page.waitForFunction(()=>!__T11.getReplay().active);assert.deepEqual(await page.evaluate(()=>__T11.getState().score),[before[0]+1,before[1]]);mark('Keyboard skips goal replay without creating another shot or score');
 await goal(page);await page.waitForFunction(()=>!__T11.getReplay().active);assert.equal(await page.locator('#goal-replay').isVisible(),false);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>__T11.getReplay().active),false);mark('Replay ends automatically without retriggering');
 await page.locator('#pause-open').click();await page.locator('#leave-match').click();await page.locator('#quit-confirm').click();await page.locator('#return-home').click();assert.equal(await page.evaluate(()=>__T11.getReplay().frameCount),0);mark('Leaving the match clears replay history');
 await context.close();
 const mobileContext=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});const mobile=await mobileContext.newPage();mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(origin+'/?debug=1');await mobile.evaluate(()=>__T11.start({duration:360,humans:[true,false]}));await mobile.waitForFunction(()=>__T11.getState()?.phase==='playing');await fixture(mobile,'opponents');
 const slideButton=await mobile.locator('[data-action=slide]').boundingBox(),cdp=await mobileContext.newCDPSession(mobile);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:slideButton.x+slideButton.width/2,y:slideButton.y+slideButton.height/2,id:1}]});await mobile.waitForFunction(()=>__T11.getState().players[9].anim==='slide');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.equal(await mobile.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);mark('Touch Slide starts the action and landscape controls fit');
 await goal(mobile);await mobile.locator('#skip-replay').tap();await mobile.waitForFunction(()=>!__T11.getReplay().active);mark('Touch can skip the automatic goal replay');await mobileContext.close();
 assert.deepEqual(errors,[]);mark('No browser JavaScript errors');await report();
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:resolve(out,'features-failure.png')}).catch(()=>{});await report(error);throw error;}finally{await browser?.close();await service.close();}
