import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createGameServer} from '../server/index.js';
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0});const {port}=await service.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--enable-unsafe-swiftshader']});
const checks=[],errors=[],mark=name=>{checks.push({name,status:'passed'});console.log('PASS '+name);};
try{
 const context=await browser.newContext({viewport:{width:1366,height:900}});await context.addInitScript(()=>localStorage.setItem('t11.preferences',JSON.stringify({quality:'low',shadows:false,master:0,autoQuality:false,cameraMode:'telebroadcast'})));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Shader|WebGL/.test(m.text()))errors.push(m.text());});
 await page.goto(`http://localhost:${port}/?debug=1`);await page.waitForFunction(()=>window.__T11);
 for(const speed of [9,30]){
  await page.evaluate(speed=>{__T11.start({duration:600,humans:[true,false]});const s=__T11.getState();s.phase='playing';s.phaseTime=0;s.restart=null;s.selected=[9,20];
   for(const p of s.players)Object.assign(p,{x:-30+p.slot*2,z:p.team?28:-28,cooldown:10,vx:0,vz:0});
   Object.assign(s.players[9],{x:40.85,z:.55,facing:0});Object.assign(s.players[11],{x:52.2,z:0,cooldown:0,facing:Math.PI});
   Object.assign(s.ball,{x:51.6,z:speed===9?.65:-.65,y:1,vx:speed,vy:0,vz:0,owner:null,lastTouch:9,state:'flight',lastShot:{tick:s.tick,team:0,penalty:{x:41.5,z:0,taker:9,half:1}}});
  },speed);
  await page.waitForFunction(()=>__T11.getState().stats.saves[1]===1&&Math.abs(__T11.stats().keeperPresentation[1].lean)>.65);
  const contact=await page.evaluate(()=>{const s=__T11.getState();return {outcome:s.players[11].saveOutcome,owner:s.ball.owner,vx:s.ball.vx,stats:__T11.stats()};});
  assert.equal(contact.outcome,speed===9?'catch':'punch');assert.equal(contact.stats.cameraMode,'penalty');
  if(speed===9){assert.equal(contact.owner,11);const a=contact.stats.ballVisualPosition,b=contact.stats.keeperPresentation[1].gloveCentre;assert.ok(Math.hypot(...a.map((v,i)=>v-b[i]))<.001);}
  else{assert.equal(contact.owner,null);assert.ok(contact.vx<0);}
  await page.screenshot({path:resolve(out,speed===9?'keeper-penalty-catch.png':'keeper-penalty-punch.png')});mark(speed===9?'Penalty catch dives and keeps the ball visibly between the gloves':'Penalty punch dives the other way and sends a live rebound away from goal');
 }
 await page.evaluate(()=>{__T11.start({duration:600,humans:[true,false]});const s=__T11.getState();s.phase='playing';s.phaseTime=0;s.restart=null;s.selected=[6,20];s.ballFlightTime=1;
  for(const p of s.players)Object.assign(p,{x:-35+p.slot,z:p.team?28:-28,vx:0,vz:0,cooldown:10});
  Object.assign(s.players[6],{x:-15,z:0,facing:0,cooldown:0});Object.assign(s.ball,{x:-15.6,z:0,y:.11,vx:8,vy:0,vz:0,owner:null,lastTouch:9,state:'free',lastShot:null});
 });await page.waitForFunction(()=>__T11.getState().players[6].possessionBurst>1&&document.querySelector('#player-role').textContent.includes('BURST +30%'));
 await page.keyboard.down('KeyD');await page.waitForFunction(()=>__T11.getState().players[6].vx>7);await page.screenshot({path:resolve(out,'possession-burst.png')});await page.waitForFunction(()=>__T11.getState().players[6].possessionBurst===0);await page.keyboard.up('KeyD');
 assert.equal(await page.evaluate(()=>__T11.getState().ball.owner),6);assert.ok(!(await page.locator('#player-role').textContent()).includes('BURST'));mark('A real midfield receipt displays a 30 percent burst, retains possession, and expires during keyboard movement');
 assert.deepEqual(errors,[]);mark('No browser or shader exceptions');await writeFile(resolve(out,'keeper-burst-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),checks,errors},null,2));await context.close();
}finally{await browser.close();await service.close();}
