import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createGameServer} from '../server/index.js';
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0}),{port}=await service.listen(),origin=`http://127.0.0.1:${port}`;
const checks=[],errors=[];let browser,page;
const mark=(name,data={})=>{checks.push({name,status:'passed',...data});console.log('PASS '+name);};
async function freeze(p){await p.evaluate(()=>{const original=requestAnimationFrame;window.__qaNext=null;requestAnimationFrame=fn=>{__qaNext=fn;return 0;};window.__qaResume=()=>{requestAnimationFrame=original;if(__qaNext)original(__qaNext);};});await p.waitForTimeout(60);}
async function fixture(p,kind){await freeze(p);await p.evaluate(kind=>{
 __T11.input.clear();const s=__T11.getState();Object.assign(s,{phase:'playing',phaseTime:0,time:10,half:1,score:[0,0],restart:null,offside:null,receiver:[null,null],pendingSwitch:[null,null],selected:[9,20],previous:[{shoot:false},{shoot:false}],ballFlightTime:1});
 for(const p of s.players)Object.assign(p,{x:-40+p.slot,z:p.team?28:-28,vx:0,vz:0,cooldown:20,aiTime:20,actionTime:0,charge:0,passCharge:0,passType:null,aerial:null,shotLatch:false});
 Object.assign(s.players[9],{x:33,z:0,facing:0,cooldown:0});Object.assign(s.ball,{owner:null,state:'flight',lastTouch:8,x:31,y:kind==='header'?2.55:1.2,z:0,vx:8,vy:-.4,vz:0,curl:0});s.stats.shots=[0,0];s.stats.headers=[0,0];s.stats.volleys=[0,0];s.stats.clearances=[0,0];
 document.body.classList.add('aerial-ball');document.body.classList.remove('defending');
 },kind);}
async function settings(p){await p.locator('#pause-open').click();await p.locator('#pause-settings').click();}
async function resume(p){await p.locator('#settings-dialog .dialog-close').click();await p.locator('#resume').click();}
async function drag(p,selector,x,y){const b=await p.locator(selector).boundingBox(),sx=b.x+b.width/2,sy=b.y+b.height/2,cdp=await p.context().newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy,id:5}]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx+(x-sx)*i/10,y:sy+(y-sy)*i/10,id:5}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:800}});context.setDefaultTimeout(15000);page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('t11.preferences',JSON.stringify({quality:'low',shadows:false,autoQuality:false})));
 await page.goto(origin+'/?debug=1');await page.waitForFunction(()=>window.__T11);await page.evaluate(()=>__T11.start({duration:360,humans:[true,false]}));await page.waitForFunction(()=>__T11.getState()?.phase==='playing');
 for(const kind of ['header','volley']){
  await fixture(page,kind);await page.keyboard.press('Space');await page.evaluate(()=>__qaResume());await page.waitForFunction(kind=>__T11.getState().stats[kind==='header'?'headers':'volleys'][0]===1,kind);assert.equal(await page.evaluate(()=>__T11.getState().stats.shots[0]),1);mark('Keyboard timed '+kind+' records one real shot');
 }
 await fixture(page,'header');await page.keyboard.press('KeyC');await page.evaluate(()=>__qaResume());await page.waitForFunction(()=>__T11.getState().stats.clearances[0]===1);assert.equal(await page.evaluate(()=>__T11.getState().stats.shots[0]),0);mark('Keyboard C heads clear upfield without adding a shot');
 await page.evaluate(()=>{window.__pad={connected:true,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[__pad]});});
 for(const [button,clear] of [[1,false],[11,true]]){await fixture(page,'header');await page.evaluate(button=>{__pad.buttons[button]={pressed:true,value:1};__qaResume();},button);await page.waitForFunction(clear=>clear?__T11.getState().stats.clearances[0]===1:__T11.getState().stats.headers[0]===1,clear);await page.evaluate(()=>{__pad.buttons=__pad.buttons.map(()=>({pressed:false,value:0}));});mark(clear?'Controller R3 performs a headed clearance':'Controller B performs a timed header');}
 await settings(page);await page.locator('#auto-quality').check();await page.locator('#quality').selectOption('high');await resume(page);
 await page.evaluate(()=>{for(let i=0;i<800;i++)__T11.feedPerformance(.05);});await page.waitForFunction(()=>__T11.stats().resolutionScale===.65);
 const reduced=await page.evaluate(()=>({stats:__T11.stats(),players:__T11.getState().players.length,quality:__T11.preferences.quality}));assert.equal(reduced.players,22);assert.equal(reduced.quality,'high');assert.equal(reduced.stats.quality,'low');assert.ok(reduced.stats.pixelRatio<.6);mark('Sustained slow-frame samples lower the actual canvas resolution while retaining all 22 players',{pixelRatio:reduced.stats.pixelRatio});
 await settings(page);await page.locator('#auto-quality').uncheck();await resume(page);await page.waitForFunction(()=>__T11.stats().quality==='high'&&__T11.stats().resolutionScale===1);mark('Turning automatic adjustment off restores chosen graphics');await context.close();
 const mobile=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true});mobile.setDefaultTimeout(15000);page=await mobile.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/?debug=1');await page.waitForFunction(()=>window.__T11);await page.locator('#settings-open').click();await page.locator('#customize-touch').click();
 assert.equal(await page.locator('#layout-save').isEnabled(),true);
 await drag(page,'[data-control=stick]',150,190);await page.locator('#layout-size').fill('1.2');await page.locator('#layout-size').dispatchEvent('input');assert.equal(await page.locator('#layout-save').isEnabled(),true);
 await page.screenshot({path:resolve(out,'touch-layout-editor.png')});await page.locator('#layout-save').click();
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('t11.touch-layout.v1')));assert.equal(saved.landscape.stick.scale,1.2);assert.ok(Math.abs(saved.landscape.stick.x-150/844)<.02);
 await page.locator('#customize-touch').click();await page.locator('#layout-reset').click();await page.locator('#layout-cancel').click();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('t11.touch-layout.v1'))),saved);mark('Touch layout drag/resize saves locally; Cancel preserves the saved layout');
 await page.locator('#customize-touch').click();const shoot=await page.locator('[data-control=shoot]').boundingBox();await drag(page,'[data-control=pass]',shoot.x+shoot.width/2,shoot.y+shoot.height/2);assert.equal(await page.locator('#layout-save').isEnabled(),false);await page.locator('#layout-cancel').click();mark('Overlapping controls cannot accidentally be saved');
 await page.reload();await page.waitForFunction(()=>window.__T11);assert.deepEqual(await page.evaluate(()=>__T11.touchLayout.saved),saved);
 await page.evaluate(()=>__T11.start({duration:360,humans:[true,false]}));await page.waitForFunction(()=>__T11.getState()?.phase==='playing');const stick=await page.locator('#touch-stick').boundingBox();assert.ok(Math.abs(stick.width-114)<1);assert.ok(Math.abs(stick.x+stick.width/2-150)<2);mark('Saved control sizes and positions survive reload and apply to live controls');
 const cdp=await mobile.newCDPSession(page);
 for(const [kind,action] of [['header','shoot'],['volley','shoot'],['header','lob']]){
  await fixture(page,kind);const b=await page.locator(`[data-action=${action}]`).boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.evaluate(()=>__qaResume());await page.waitForFunction(clear=>clear?__T11.getState().stats.clearances[0]===1:__T11.getState().stats.shots[0]===1,action==='lob');
 }mark('Repositioned touch controls perform headers, volleys and aerial clearances');
 await page.setViewportSize({width:568,height:320});await page.waitForFunction(()=>[...document.querySelectorAll('#touch-controls [data-action],#touch-stick,.shot-selector')].every(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
 const bounds=await page.locator('#touch-controls [data-action],#touch-stick,.shot-selector').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {id:el.id||el.dataset.action||'shots',x:r.x,y:r.y,right:r.right,bottom:r.bottom,style:el.getAttribute('style')};}));assert.ok(bounds.every(r=>r.x>=0&&r.y>=0&&r.right<=568&&r.bottom<=320),JSON.stringify(bounds));await page.screenshot({path:resolve(out,'custom-controls-small-phone.png')});mark('Saved layout adapts safely to a smaller phone viewport');
 await settings(page);await page.locator('#customize-touch').click();await page.locator('#layout-reset').click();assert.equal(await page.locator('#layout-save').isEnabled(),true);await page.screenshot({path:resolve(out,'touch-layout-small-phone.png')});await page.locator('#layout-save').click();mark('Reset creates a usable compact phone layout');
 await mobile.close();assert.deepEqual(errors,[]);mark('No browser JavaScript errors');
}catch(error){if(page&&!page.isClosed())await page.screenshot({path:resolve(out,'failure.png')}).catch(()=>{});await writeFile(resolve(out,'aerial-mobile-browser-report.json'),JSON.stringify({checks,errors,failure:error.stack},null,2));throw error;}
finally{await browser?.close();await service.close();}
await writeFile(resolve(out,'aerial-mobile-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),checks,errors},null,2));
