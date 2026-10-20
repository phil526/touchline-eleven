import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createGameServer} from '../server/index.js';
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0}),address=await service.listen(),origin=`http://127.0.0.1:${address.port}`;
const checks=[],errors=[];let browser;
const mark=(name,data={})=>{checks.push({name,status:'passed',...data});console.log('PASS '+name);};
async function fixture(page){await page.evaluate(()=>{
  __T11.input.clear();const s=__T11.getState();
  Object.assign(s,{phase:'playing',phaseTime:0,time:10,half:1,score:[0,0],restart:null,offside:null,passFrom:null,passTeam:null,receiver:[null,null],pendingSwitch:[null,null],selected:[9,20],previous:[{shoot:false},{shoot:false}]});
  s.stats.shots=[0,0];
  for(const p of s.players)Object.assign(p,{x:-35+p.slot*2,z:p.team?-27:27,vx:0,vz:0,cooldown:10,aiTime:10,charge:0,shotType:null,passCharge:0,passType:null,shotLatch:false,actionTime:0,anim:'idle',touchTime:0,receiveTime:0});
  Object.assign(s.players[9],{x:33,z:2,facing:0,cooldown:0});s.players[9].attrs.shooting=100;
  Object.assign(s.ball,{x:33.55,y:.11,z:2,vx:0,vy:0,vz:0,curl:0,owner:9,lastTouch:9,state:'controlled'});
});}
async function shotCheck(page,kind){
  await page.waitForFunction(kind=>__T11.stats().shotAimKind===kind&&__T11.getState().players[9].charge>.2,kind);
  assert.equal(await page.locator('#charge-title').textContent(),kind==='normal'?'SHOT POWER':kind==='finesse'?'FINESSE SHOT':'CHIP SHOT');
  const path=await page.evaluate(()=>__T11.stats().shotAimPath);assert.ok(path.length>8);assert.ok(path.every(p=>Object.values(p).every(Number.isFinite)));
}
async function capture(page,name){
  await page.evaluate(()=>{const original=requestAnimationFrame;window.__qaNext=null;window.requestAnimationFrame=fn=>{window.__qaNext=fn;return 0;};window.__qaResume=()=>{requestAnimationFrame=original;if(__qaNext)original(__qaNext);};});
  await page.waitForTimeout(60);await page.screenshot({path:resolve(out,name+'.png')});await page.evaluate(()=>__qaResume());
}
async function released(page,kind){await page.waitForFunction(kind=>__T11.getState().stats.shots[0]===1&&__T11.getState().ball.shotKind===kind,kind);await page.waitForFunction(()=>!__T11.stats().shotAimVisible&&document.getElementById('charge-wrap').hidden);}
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1280,height:800}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  context.setDefaultTimeout(20000);page.on('pageerror',e=>console.log('ERROR '+e.message));
  await page.addInitScript(()=>{localStorage.setItem('t11.preferences',JSON.stringify({quality:'low',shadows:false}));window.__pad={connected:true,mapping:'standard',index:0,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[__pad]});});
  await page.goto(origin+'/?debug=1');await page.waitForFunction(()=>window.__T11);await page.evaluate(()=>__T11.start({duration:360,humans:[true,false]}));await page.waitForFunction(()=>__T11.getState()?.phase==='playing');
  for(const [kind,key] of [['finesse','KeyZ'],['chip','KeyX'],['normal',null]]){
    await fixture(page);if(key)await page.keyboard.down(key);await page.keyboard.down('Space');await shotCheck(page,kind);
    if(kind!=='normal')await capture(page,kind+'-guide');
    // Both key-up events can precede the next simulation frame.
    await page.keyboard.up('Space');if(key)await page.keyboard.up(key);await released(page,kind);mark('Keyboard '+kind+' charge, guide and single release (idle controller connected)');
  }
  for(const [kind,modifier] of [['finesse',5],['chip',6]]){
    await fixture(page);await page.evaluate(modifier=>{__pad.buttons[modifier]={pressed:true,value:1};__pad.buttons[1]={pressed:true,value:1};},modifier);await shotCheck(page,kind);
    assert.equal(await page.evaluate(()=>__T11.getState().selected[0]),9);
    await page.evaluate(()=>{__pad.buttons=__pad.buttons.map(()=>({pressed:false,value:0}));});await released(page,kind);mark('Controller '+kind+' modifier charges and releases without switching or tackling');
  }
  await context.close();
  for(const [width,height] of [[844,390],[568,320]]){
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    context.setDefaultTimeout(20000);
    await page.addInitScript(()=>localStorage.setItem('t11.preferences',JSON.stringify({quality:'low',shadows:false,touch:true})));
    await page.goto(origin+'/?debug=1');await page.waitForFunction(()=>window.__T11);await page.evaluate(()=>__T11.start({duration:360,humans:[true,false]}));await page.waitForFunction(()=>__T11.getState()?.phase==='playing');
    const cdp=await context.newCDPSession(page);
    for(const kind of ['finesse','chip','normal']){
      await fixture(page);await page.locator(`[data-shot-type=${kind}]`).tap();assert.equal(await page.locator(`[data-shot-type=${kind}]`).getAttribute('aria-pressed'),'true');
      const box=await page.locator('[data-action=shoot]').boundingBox();await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width/2,y:box.y+box.height/2,id:1}]});await shotCheck(page,kind);
      if(kind==='chip')await capture(page,`chip-touch-${width}`);
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await released(page,kind);
    }
    const layout=await page.evaluate(()=>{const radar=document.querySelector('#radar').getBoundingClientRect(),buttons=[...document.querySelectorAll('.touch-actions button')];return {overflow:document.documentElement.scrollWidth>innerWidth,covered:buttons.filter(b=>{const r=b.getBoundingClientRect();return r.left<radar.right&&r.right>radar.left&&r.top<radar.bottom&&r.bottom>radar.top;}).map(b=>b.textContent),offscreen:buttons.filter(b=>{const r=b.getBoundingClientRect();return r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight;}).map(b=>b.textContent)};});
    assert.equal(layout.overflow,false);assert.deepEqual(layout.covered,[]);assert.deepEqual(layout.offscreen,[]);mark(`Touch selection, charge and release at ${width}×${height}; no radar overlap`,layout);await context.close();
  }
  assert.deepEqual(errors,[]);mark('No browser JavaScript errors');
}catch(error){await writeFile(resolve(out,'shots-browser-report.json'),JSON.stringify({checks,errors,failure:error.stack},null,2));throw error;}
finally{await browser?.close();await service.close();}
await writeFile(resolve(out,'shots-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),checks,errors},null,2));
