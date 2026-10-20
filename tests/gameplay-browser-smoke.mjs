import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0});const address=await service.listen();
const origin=`http://127.0.0.1:${address.port}`;
const checks=[],errors=[];let browser,page;
const mark=(name,data={})=>{checks.push({name,status:'passed',...data});console.log('PASS '+name);};
async function report(failure){
  const result={testedAt:new Date().toISOString(),browser:browser?.version(),checks,errors,...(failure?{failure:String(failure.stack||failure)}:{})};
  await writeFile(resolve(out,'gameplay-browser-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
async function rangeKeys(id,edge,steps,direction='ArrowRight'){
  const slider=page.locator('#'+id);await slider.focus();await slider.press(edge);
  for(let i=0;i<steps;i++)await slider.press(direction);
  return slider.inputValue();
}
async function fixture({facing=0}={}){
  await page.evaluate(facing=>{
    __T11.input.clear();const s=__T11.getState();
    Object.assign(s,{phase:'playing',phaseTime:0,time:1,half:1,score:[0,0],restart:null,offside:null,receiver:[null,null],pendingSwitch:[null,null],passFrom:null,passTeam:null,ballFlightTime:1});
    s.selected=[6,20];s.options.humans=[true,false];
    for(const p of s.players){
      Object.assign(p,{x:p.team===0?-42+p.slot*.8:35+(p.slot%2)*3,z:p.team===0?23+p.slot*.4:-30+p.slot*6,vx:0,vz:0,facing:p.team===0?0:Math.PI,stamina:1,charge:0,actionTime:0,cooldown:10,touchTime:0,aiTime:10,holdTime:0,shotLatch:false,anim:'idle'});
    }
    Object.assign(s.players[6],{x:-10,z:0,facing,cooldown:0});
    Object.assign(s.players[8],{x:8,z:0,cooldown:0});
    Object.assign(s.players[7],{x:-10,z:-16,cooldown:0});
    Object.assign(s.ball,{x:-10+Math.cos(facing)*.65,z:Math.sin(facing)*.65,y:.11,vx:0,vz:0,vy:0,owner:6,lastTouch:6,state:'controlled'});
    s.previous=[{mx:0,mz:0},{mx:0,mz:0}];
    window.__qaFixture={time:s.time,passes:s.stats.passes[0],completed:s.stats.completedPasses[0]};
  },facing);
}
async function observePass(){
  await page.evaluate(()=>{
    window.__qaPass=null;const count=__T11.getState().stats.passes[0];let frames=0;
    const watch=()=>{const s=__T11.getState();if(s.stats.passes[0]>count){window.__qaPass={receiver:s.receiver[0],time:s.time,vx:s.ball.vx,vz:s.ball.vz,owner:s.ball.owner};return;}if(++frames<600)requestAnimationFrame(watch);};requestAnimationFrame(watch);
  });
}

try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:900}});page=await context.newPage();page.setDefaultTimeout(20_000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/?debug=1');await page.waitForFunction(()=>window.__T11);
  await page.locator('#settings-open').click();await page.locator('#camera-mode').selectOption('telebroadcast');
  const saved={mode:'telebroadcast',height:await rangeKeys('camera-height','End',7,'ArrowLeft'),zoom:await rangeKeys('camera-zoom','Home',6)};
  await page.locator('#camera-mode').selectOption('third-person');saved.fov=await rangeKeys('camera-fov','Home',5);await page.locator('#camera-mode').selectOption(saved.mode);
  await page.locator('#settings-dialog .dialog-close').click();await page.reload();await page.waitForFunction(()=>window.__T11);await page.locator('#settings-open').click();
  for(const [id,value] of [['camera-mode',saved.mode],['camera-height',saved.height],['camera-zoom',saved.zoom],['camera-fov',saved.fov]])assert.equal(await page.locator('#'+id).inputValue(),value);
  await page.locator('#settings-dialog .dialog-close').click();
  await page.locator('#play-offline').click();await page.locator('#duration').selectOption('60');await page.locator('#kickoff').click();await page.waitForFunction(()=>__T11.getState()?.phase==='playing');
  await page.waitForFunction(()=>__T11.stats().cameraMode==='telebroadcast');
  mark('Saved camera mode, height, zoom and third-person FOV survive gameplay reload',{saved});

  // Deterministic open-lane setup; the live renderer and real keyboard drive aim.
  await fixture();await page.keyboard.down('KeyD');
  await page.waitForFunction(()=>__T11.stats().passTargetId===8);const rightTarget=await page.evaluate(()=>__T11.stats().passTargetId);
  await page.screenshot({path:resolve(out,'aimed-receiver.png')});await page.keyboard.up('KeyD');
  await fixture();await page.keyboard.down('KeyW');await page.waitForFunction(()=>__T11.stats().passTargetId===7);
  const upTarget=await page.evaluate(()=>__T11.stats().passTargetId);assert.notEqual(rightTarget,upTarget);await page.keyboard.up('KeyW');
  mark('Live receiver marker changes to the team-mate in the aimed direction',{rightTarget,upTarget});

  await fixture();await page.keyboard.down('KeyD');await page.waitForFunction(()=>__T11.stats().passTargetId===8);
  const previewTarget=await page.evaluate(()=>__T11.stats().passTargetId);await observePass();
  await page.keyboard.press('KeyJ');await page.keyboard.up('KeyD');await page.waitForFunction(()=>window.__qaPass!==null);
  const pass=await page.evaluate(()=>__qaPass);assert.equal(pass.receiver,previewTarget);assert.ok(pass.vx>0);
  mark('The actual short pass agrees with the live receiver preview',pass);
  await page.waitForFunction(id=>__T11.getState().ball.owner===id,previewTarget);
  const received=await page.evaluate(()=>{const s=__T11.getState(),p=s.players[s.ball.owner];return {elapsed:s.time-__qaPass.time,completed:s.stats.completedPasses[0]-__qaFixture.completed,gap:Math.hypot(s.ball.x-p.x,s.ball.z-p.z)};});
  assert.ok(received.elapsed<4,'An unopposed 18 metre ground pass should reach its receiver promptly');assert.ok(received.completed>=1);assert.ok(received.gap<1.5);
  mark('An unopposed weighted ground pass reaches its intended receiver',received);

  await fixture({facing:-Math.PI/2});
  await page.evaluate(()=>{
    window.__qaCloseSamples=[];window.__qaCloseStart={x:__T11.getState().players[6].x,z:__T11.getState().players[6].z};
    const until=performance.now()+900;
    const watch=()=>{const s=__T11.getState(),p=s.players[6];__qaCloseSamples.push({owner:s.ball.owner,gap:Math.hypot(s.ball.x-p.x,s.ball.z-p.z)});if(performance.now()<until)requestAnimationFrame(watch);};requestAnimationFrame(watch);
  });
  await page.keyboard.down('ControlLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(800);
  const close=await page.evaluate(()=>{const p=__T11.getState().players[6];return {actions:__T11.input.sample(),travel:Math.hypot(p.x-__qaCloseStart.x,p.z-__qaCloseStart.z),maxGap:Math.max(...__qaCloseSamples.map(sample=>sample.gap)),keptBall:__qaCloseSamples.every(sample=>sample.owner===6)};});
  assert.equal(close.actions.jockey,true);assert.ok(close.actions.mz<0);assert.ok(close.travel>.35,'Close control must still allow useful movement');assert.ok(close.maxGap<1.6);assert.equal(close.keptBall,true);
  await page.screenshot({path:resolve(out,'close-control.png')});await page.keyboard.up('KeyW');await page.keyboard.up('ControlLeft');
  const releasedControl=await page.evaluate(()=>__T11.input.sample());assert.equal(releasedControl.jockey,false);assert.equal(releasedControl.mz,0);
  mark('Ctrl plus movement keeps the ball close without disabling movement',{travel:close.travel,maxGap:close.maxGap});

  await fixture({facing:-Math.PI/2});await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');
  await page.waitForFunction(()=>__T11.getState().players[6].stamina<.98);
  const sprint=await page.evaluate(()=>{const p=__T11.getState().players[6];return {speed:Math.hypot(p.vx,p.vz),stamina:p.stamina,actions:__T11.input.sample()};});
  assert.equal(sprint.actions.sprint,true);assert.ok(sprint.speed>.5);await page.keyboard.up('ShiftLeft');
  const shiftReleased=await page.evaluate(()=>__T11.input.sample());assert.equal(shiftReleased.sprint,false);assert.ok(shiftReleased.mz<0,'Releasing sprint must retain held movement');
  await page.keyboard.up('KeyW');const allReleased=await page.evaluate(()=>__T11.input.sample());assert.equal(allReleased.mx,0);assert.equal(allReleased.mz,0);assert.equal(allReleased.sprint,false);assert.equal(allReleased.jockey,false);
  await page.waitForFunction(()=>Math.hypot(__T11.getState().players[6].vx,__T11.getState().players[6].vz)<.15);
  mark('Sprint drains stamina and releasing modifiers/movement clears the right controls',{speed:sprint.speed,stamina:sprint.stamina});

  await fixture();await page.evaluate(()=>{const s=__T11.getState(),opponent=s.players[17];s.ball.owner=opponent.id;s.ball.lastTouch=opponent.id;s.ball.x=opponent.x;s.ball.z=opponent.z;});
  await page.waitForFunction(()=>__T11.stats().passTargetId===null);mark('Receiver preview disappears when the opponent owns the ball');
  await page.locator('#pause-open').click();await page.locator('#pause-settings').click();await page.locator('#camera-mode').selectOption('third-person');
  assert.equal(await page.locator('#camera-fov').inputValue(),saved.fov);await page.locator('#settings-dialog .dialog-close').click();await page.locator('#resume').click();
  await page.waitForFunction(fov=>{const camera=__T11.stats(),s=__T11.getState(),p=s.players[s.selected[0]],f=camera.cameraForward;return camera.cameraMode==='third-person'&&camera.hiddenPlayerId===null&&Math.abs(camera.cameraFov-fov)<.5&&camera.cameraPosition.y>1.8&&(p.x-camera.cameraPosition.x)*f.x+(p.z-camera.cameraPosition.z)*f.z>2;},Number(saved.fov));
  mark('Third-person camera retains saved FOV and follows behind the visible selected player after gameplay');
  assert.deepEqual(errors,[]);mark('No browser JavaScript exceptions');await report();await context.close();
}catch(error){
  if(page&&!page.isClosed())await page.screenshot({path:resolve(out,'gameplay-failure.png')}).catch(()=>{});
  await report(error);throw error;
}finally{await browser?.close();await service.close();}
