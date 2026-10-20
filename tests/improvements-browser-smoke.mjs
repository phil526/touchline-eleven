import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createGameServer} from '../server/index.js';
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0});const {port}=await service.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--enable-unsafe-swiftshader']});
const checks=[],errors=[],mark=name=>{checks.push(name);console.log('PASS '+name);};
async function boot(options){
 const context=await browser.newContext(options);await context.addInitScript(()=>localStorage.setItem('t11.preferences',JSON.stringify({quality:'low',shadows:false,master:0,keeperAssist:false,touch:true})));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://localhost:${port}/?debug=1`);await page.waitForFunction(()=>window.__T11);return {context,page};
}
async function skillSetup(page){await page.evaluate(async()=>{
 await __T11.start({duration:600,humans:[true,true]});const s=__T11.getState();s.phase='playing';s.restart=null;s.selected=[9,20];
 for(const p of s.players)Object.assign(p,{x:-30+p.slot,z:28,cooldown:100});
 Object.assign(s.players[9],{x:25,z:0,facing:0,cooldown:0,vx:0,vz:0,skill:null,skillCooldown:0});
 Object.assign(s.ball,{owner:9,x:25.4,y:.11,z:0,state:'controlled',lastTouch:9,vx:0,vy:0,vz:0});
 });await page.waitForFunction(()=>__T11.getState().phase==='playing'&&__T11.getState().players[9].charge===0);}
try{
 const {page,context}=await boot({viewport:{width:1366,height:900}});
 await skillSetup(page);
 for(const [key,kind] of [['KeyV','ballRoll'],['KeyB','bodyFeint'],['KeyN','fakeShot']]){
  await page.waitForFunction(()=>__T11.getState().players[9].skillCooldown<=0);
  await page.keyboard.down(key);await page.waitForFunction(kind=>__T11.getState().players[9].skill?.kind===kind,kind);
  if(kind==='bodyFeint')await page.screenshot({path:resolve(out,'skills-desktop.png')});
  await page.keyboard.up(key);
 }
 assert.equal(await page.evaluate(()=>__T11.getState().stats.shots[0]),0);mark('Real keyboard triggers three distinct skill moves without shooting');
 await page.evaluate(()=>__T11.startPractice('keeperPenalties'));await page.waitForFunction(()=>__T11.getPractice().phase==='ready');
 await page.keyboard.down('KeyD');await page.waitForFunction(()=>__T11.getState().penaltyKeeper?.choice===1);await page.keyboard.up('KeyD');
 await page.waitForFunction(()=>document.querySelector('[data-action=keeperRight]').getAttribute('aria-pressed')==='true');assert.equal(await page.evaluate(()=>__T11.stats().cameraMode),'penalty');
 await page.screenshot({path:resolve(out,'keeper-practice-desktop.png')});
 await page.keyboard.press('KeyJ');await page.waitForFunction(()=>__T11.getPractice().phase==='action');await page.keyboard.down('Space');await page.waitForFunction(()=>__T11.getState().penaltyKeeper?.committed);await page.keyboard.up('Space');
 await page.waitForFunction(()=>__T11.getPractice().phase==='feedback');assert.equal(await page.evaluate(()=>__T11.getPractice().attempts),1);mark('Goalkeeper practice waits for Ready and accepts keyboard direction and timed dive');
 await page.locator('#practice-hud [data-open-shots]').click();await page.locator('#shot-map-dialog').waitFor({state:'visible'});
 assert.equal(await page.locator('#shot-markers .shot-dot').count(),1);assert.match(await page.locator('#shot-map-count').textContent(),/1 attempt/);
 await page.locator('[data-shot-filter="0"]').click();assert.equal(await page.locator('#shot-markers .shot-dot').count(),0);
 await page.locator('[data-shot-filter="1"]').click();assert.equal(await page.locator('#shot-markers .shot-dot').count(),1);
 await page.locator('.shot-list-item').click();assert.match(await page.locator('#shot-detail').textContent(),/EMB/);await page.screenshot({path:resolve(out,'shot-map-desktop.png')});mark('Shot map displays the actual attempt, supports filters and selectable feedback');
 await page.locator('#shot-map-dialog .dialog-close').click();await page.locator('#pause-open').click();await page.locator('#pause-settings').click();
 await page.locator('#keeper-assist').check();assert.equal(await page.evaluate(()=>__T11.preferences.keeperAssist),true);await page.locator('#settings-dialog .dialog-close').click();await page.locator('#resume').click();
 await page.waitForFunction(()=>__T11.getPractice().phase==='ready');assert.equal(await page.locator('[data-action=keeperDive]').isDisabled(),true);mark('Assisted penalty setting is persisted and disables manual dive controls');
 await context.close();
 for(const viewport of [{width:844,height:390},{width:568,height:320}]){
  const mobile=await boot({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1}),p=mobile.page;
  await skillSetup(p);const cdp=await mobile.context.newCDPSession(p),b=await p.locator('[data-action=ballRoll]').boundingBox();
  assert.ok(b.y>=0&&b.x+b.width<=viewport.width&&b.y+b.height<=viewport.height);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:1}]});await p.waitForFunction(()=>__T11.getState().players[9].skill?.kind==='ballRoll');await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await p.screenshot({path:resolve(out,`skills-phone-${viewport.width}.png`)});
  await p.evaluate(()=>__T11.startPractice('keeperPenalties'));await p.waitForFunction(()=>__T11.getPractice()?.phase==='ready');
  await p.locator('[data-action=keeperLeft]').tap();await p.waitForFunction(()=>__T11.getState().penaltyKeeper?.choice===-1);
  await p.screenshot({path:resolve(out,`keeper-phone-${viewport.width}.png`)});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.locator('[data-action=keeperReady]').tap();await p.waitForFunction(()=>__T11.getPractice().phase==='action');await p.locator('[data-action=keeperDive]').tap();
  await p.waitForFunction(()=>__T11.getPractice().phase==='feedback');assert.equal(await p.evaluate(()=>__T11.getPractice().attempts),1);
  await p.locator('#practice-hud [data-open-shots]').tap();await p.screenshot({path:resolve(out,`shot-map-phone-${viewport.width}.png`)});
  assert.equal(await p.locator('#shot-markers .shot-dot').count(),1);mark(`Emulated ${viewport.width}×${viewport.height} phone supports skills, penalty selection/dive and shot map`);await mobile.context.close();
 }
 assert.deepEqual(errors,[]);mark('No browser JavaScript exceptions');await writeFile(resolve(out,'improvements-browser-report.json'),JSON.stringify({checks,errors},null,2));
}finally{await browser.close();await service.close();}
