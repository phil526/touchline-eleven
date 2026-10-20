import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';
import {chromium} from 'playwright';
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0});const {port}=await service.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--enable-unsafe-swiftshader']});
const checks=[],errors=[],mark=name=>{checks.push({name,status:'passed'});console.log('PASS '+name);};
try{
 const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://localhost:${port}/?debug=1`);await page.waitForFunction(()=>window.__T11);
 await page.evaluate(()=>__T11.start({duration:600,humans:[true,true]}));await page.waitForFunction(()=>__T11.getState().phase==='playing');
 async function fixture(){
  await page.evaluate(()=>{
   __T11.input.clear();const s=__T11.getState();Object.assign(s,{phase:'restart',phaseTime:2.1,time:10,offside:null,receiver:[null,null],pendingSwitch:[null,null],runs:[null,null],passFrom:null,passTeam:null});s.options.humans=[true,true];s.stats.passes=[0,0];s.stats.shots=[0,0];s.selected=[9,20];
   for(const p of s.players)Object.assign(p,{x:p.team?40:-40,z:0,vx:0,vz:0,cooldown:100,actionTime:0,charge:0,passCharge:0,passType:null,shotType:null,shotLatch:false,aerial:null,anim:'idle'});
   s.restart={type:'throwIn',team:0,taker:9,x:0,z:-34};Object.assign(s.ball,{x:0,z:-34,y:.11,vx:0,vy:0,vz:0,owner:null,state:'dead',lastTouch:20});Object.assign(s.players[7],{x:4,z:-22});
   __T11.preferences.cameraMode='telebroadcast';__T11.preferences.cameraZoom=1;__T11.preferences.cameraHeight=0;window.__fixtureTick=s.tick;
  });
  await page.waitForFunction(()=>{const s=__T11.getState();return s.tick>__fixtureTick+3&&s.restart?.armed&&!s.previous[0].cancelCharge;});
 }
 await fixture();await page.screenshot({path:resolve(out,'throw-in-ready.png')});
 assert.deepEqual(await page.evaluate(()=>({phase:__T11.getState().phase,y:__T11.getState().ball.y,passes:__T11.getState().stats.passes[0]})),{phase:'restart',y:1.8,passes:0});mark('Human throw-in waits with the ball overhead');
 await page.evaluate(()=>{
  window.__throwSamples=[];const s=__T11.getState();s.options.humans[0]=false;s.phaseTime=1.95;
  const sample=()=>{const s=__T11.getState(),p=s.players[9];if(p.anim==='throw'&&s.phase==='playing')__throwSamples.push({y:s.ball.y,vz:s.ball.vz,anim:p.anim,event:s.event.type,passes:s.stats.passes[0],offside:s.offside});if(__throwSamples.length<12)requestAnimationFrame(sample);};requestAnimationFrame(sample);
 });
 await page.waitForFunction(()=>__throwSamples.length>=4);const samples=await page.evaluate(()=>__throwSamples);
 assert.ok(samples.every(s=>s.anim==='throw'&&s.y>1.7&&s.vz>0&&s.passes===1&&s.offside===null));assert.equal(samples[0].event,'throw');mark('AI automatically releases one elevated infield throw with no offside or kick action');
 await fixture();await page.keyboard.down('Space');await page.waitForFunction(()=>__T11.getState().players[9].charge>.2);assert.equal(await page.evaluate(()=>__T11.getState().phase),'restart');
 await page.keyboard.up('Space');await page.waitForFunction(()=>__T11.getState().stats.passes[0]===1);assert.equal(await page.evaluate(()=>__T11.getState().stats.shots[0]),0);assert.equal(await page.evaluate(()=>__T11.getState().event.type),'throw');mark('Keyboard Shoot charges then releases a long throw, never a shot');
 assert.deepEqual(errors,[]);mark('No browser JavaScript exceptions');
 await writeFile(resolve(out,'throw-in-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),checks,errors},null,2));
}finally{await browser.close();await service.close();}
