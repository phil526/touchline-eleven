import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve(process.env.QA_OUTPUT||'qa-output');
await mkdir(out,{recursive:true});
const service=createGameServer({port:0});
const address=await service.listen();
const origin=`http://127.0.0.1:${address.port}`;
const modes=['broadcast','telebroadcast','third-person'];
const ranges=['camera-height','camera-zoom','camera-fov'];
const checks=[],errors=[];
let browser,page;
const mark=(name,data={})=>{checks.push({name,status:'passed',...data});console.log('PASS '+name);};
const observeErrors=(target,label)=>target.on('pageerror',error=>errors.push(`${label}: ${error.message}`));
async function waitForDebug(target){await target.waitForFunction(()=>window.__T11);}
async function closeSettings(target){await target.locator('#settings-dialog .dialog-close').click();await target.waitForFunction(()=>!document.getElementById('settings-dialog').open);}
async function assertNeutral(target){
  const actions=await target.evaluate(()=>__T11.input.sample());
  for(const key of ['mx','mz'])assert.equal(actions[key],0,`${key} must be neutral`);
  for(const key of ['sprint','jockey','pass','through','lob','shoot','tackle','slide','switch'])assert.equal(actions[key],false,`${key} must be released`);
}
async function assertQuitScreen(target){
  await target.locator('#quit-screen').waitFor({state:'visible'});
  assert.equal(await target.evaluate(()=>__T11.getState()),null,'Quit must release the active match');
  assert.equal(await target.evaluate(()=>__T11.getNetwork()),null,'Quit must detach the online client');
  assert.equal(await target.locator('dialog[open]').count(),0,'Quit must dismiss all dialogs');
  assert.equal(await target.locator('#home-screen').isVisible(),false);
  await assertNeutral(target);
}
async function report(failure){
  const result={testedAt:new Date().toISOString(),browser:browser?.version(),checks,errors,...(failure?{failure:String(failure.stack||failure)}:{})};
  await writeFile(resolve(out,'camera-menu-report.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}

try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  page=await context.newPage();page.setDefaultTimeout(20_000);observeErrors(page,'host');
  await page.goto(origin+'/?debug=1');await waitForDebug(page);
  await page.evaluate(()=>localStorage.setItem('t11.preferences',JSON.stringify({...__T11.preferences,cameraMode:'first-person'})));
  await page.reload();await waitForDebug(page);
  assert.equal(await page.evaluate(()=>__T11.preferences.cameraMode),'third-person');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('t11.preferences')).cameraMode),'third-person');
  mark('Stored first-person preferences migrate to third-person');
  assert.equal(await page.locator('h1').innerText(),'FIND THE SPACE.\nOWN THE\nMOMENT.');
  await page.locator('#settings-open').click();
  assert.deepEqual(await page.locator('#camera-mode option').evaluateAll(options=>options.map(option=>option.value)),modes);
  for(const id of ranges)assert.equal(await page.locator('#'+id).getAttribute('type'),'range');
  for(const mode of modes){await page.locator('#camera-mode').selectOption(mode);assert.equal(await page.locator('#camera-mode').inputValue(),mode);}
  // Use native keyboard range interaction so the actual input/save handlers run.
  await page.locator('#camera-mode').selectOption('broadcast');
  const saved={};
  for(const [index,id] of ranges.entries()){
    await page.locator('#camera-mode').selectOption(id==='camera-fov'?'third-person':'broadcast');
    assert.ok(await page.locator('#'+id).isVisible());
    const slider=page.locator('#'+id);await slider.focus();await slider.press('End');
    for(let step=0;step<index+2;step++)await slider.press('ArrowLeft');
    saved[id]=await slider.inputValue();
    const bounds=await slider.evaluate(element=>({min:Number(element.min),max:Number(element.max),value:Number(element.value)}));
    assert.ok(bounds.value>=bounds.min&&bounds.value<=bounds.max);
  }
  await page.locator('#camera-mode').selectOption('third-person');saved['camera-mode']='third-person';
  await closeSettings(page);await page.reload();await waitForDebug(page);await page.locator('#settings-open').click();
  for(const [id,value] of Object.entries(saved))assert.equal(await page.locator('#'+id).inputValue(),value,`${id} must survive reload`);
  await page.screenshot({path:resolve(out,'camera-settings.png')});
  mark('All three camera modes and height/zoom/FOV controls persist after reload',{saved});
  await closeSettings(page);

  await page.locator('#play-offline').click();await page.locator('#duration').selectOption('60');await page.locator('#kickoff').click();
  await page.waitForFunction(()=>__T11.getState()?.phase==='playing');
  await page.keyboard.down('KeyD');await page.locator('#pause-open').click();await page.keyboard.up('KeyD');
  await page.locator('#pause-dialog').waitFor({state:'visible'});
  const settingsPause=await page.evaluate(()=>{window.__qaMatchRef=__T11.getState();return __qaMatchRef.time;});
  await assertNeutral(page);await page.locator('#pause-settings').click();await page.locator('#settings-dialog').waitFor({state:'visible'});
  await page.locator('#reduced-motion').check();
  await page.locator('#camera-mode').selectOption('broadcast');await page.waitForFunction(()=>__T11.stats().cameraMode==='broadcast');
  await page.locator('#camera-height').focus();await page.locator('#camera-height').press('Home');await page.waitForTimeout(1000);
  const lowHeight=await page.evaluate(()=>__T11.stats().cameraPosition.y);
  await page.locator('#camera-height').press('End');await page.waitForFunction(height=>__T11.stats().cameraPosition.y>height+4,lowHeight);
  const highHeight=await page.evaluate(()=>__T11.stats().cameraPosition.y);
  await page.locator('#camera-zoom').focus();await page.locator('#camera-zoom').press('Home');await page.waitForTimeout(500);
  const wideFov=await page.evaluate(()=>__T11.stats().cameraFov);
  await page.locator('#camera-zoom').press('End');await page.waitForFunction(fov=>__T11.stats().cameraFov<fov-5,wideFov);
  const closeFov=await page.evaluate(()=>__T11.stats().cameraFov);
  await page.locator('#camera-mode').selectOption('telebroadcast');await page.waitForFunction(()=>__T11.stats().cameraMode==='telebroadcast');
  mark('Broadcast height raises the view and TV zoom narrows the lens',{lowHeight,highHeight,wideFov,closeFov});
  await page.locator('#camera-mode').selectOption('third-person');await page.locator('#camera-fov').focus();await page.locator('#camera-fov').press('Home');
  const narrowThirdPerson=Number(await page.locator('#camera-fov').inputValue());
  await page.waitForFunction(fov=>Math.abs(__T11.stats().cameraFov-fov)<.5,narrowThirdPerson);
  await page.locator('#camera-fov').press('End');const wideThirdPerson=Number(await page.locator('#camera-fov').inputValue());
  await page.waitForFunction(fov=>Math.abs(__T11.stats().cameraFov-fov)<.5,wideThirdPerson);
  assert.ok(wideThirdPerson>narrowThirdPerson);
  assert.equal(await page.evaluate(()=>__T11.getState().time),settingsPause,'Offline settings must preserve pause');
  await closeSettings(page);assert.ok(await page.locator('#pause-dialog').isVisible());
  assert.equal(await page.evaluate(()=>__T11.getState()===__qaMatchRef),true);
  mark('Camera settings open from pause and return to the same paused match');

  await page.locator('#resume').click();
  await page.waitForFunction(()=>{const camera=__T11.stats(),s=__T11.getState(),p=s.players[s.selected[0]],f=camera.cameraForward;return camera.cameraMode==='third-person'&&camera.hiddenPlayerId===null&&camera.cameraPosition.y>1.8&&(p.x-camera.cameraPosition.x)*f.x+(p.z-camera.cameraPosition.z)*f.z>2;});
  const beforeLook=await page.evaluate(()=>__T11.stats().cameraYaw);
  const canvas=await page.locator('#pitch').boundingBox();assert.ok(canvas);
  await page.mouse.move(canvas.x+canvas.width*.43,canvas.y+canvas.height*.5);await page.mouse.down();
  await page.mouse.move(canvas.x+canvas.width*.65,canvas.y+canvas.height*.54,{steps:12});await page.mouse.up();
  await page.waitForFunction(yaw=>Math.abs(Math.atan2(Math.sin(__T11.stats().cameraYaw-yaw),Math.cos(__T11.stats().cameraYaw-yaw)))>.15,beforeLook);
  const beforeMove=await page.evaluate(()=>{const s=__T11.getState(),p=s.players[s.selected[0]],camera=__T11.stats();return {id:p.id,x:p.x,z:p.z,forward:camera.cameraForward,yaw:camera.cameraYaw};});
  await page.keyboard.down('KeyW');await page.waitForTimeout(450);await page.keyboard.up('KeyW');
  const afterMove=await page.evaluate(id=>{const p=__T11.getState().players[id];return {x:p.x,z:p.z};},beforeMove.id);
  const dx=afterMove.x-beforeMove.x,dz=afterMove.z-beforeMove.z,travel=Math.hypot(dx,dz);
  assert.ok(travel>.15,'Forward movement must move the selected player');
  const alignment=(dx*beforeMove.forward.x+dz*beforeMove.forward.z)/travel;
  assert.ok(alignment>.65,'Forward movement must follow the visible camera direction after looking');
  await page.screenshot({path:resolve(out,'third-person-match.png')});
  mark('Third-person drag orbits the visible avatar and forward movement follows that view',{travel,alignment,yawBefore:beforeLook,yawAfter:beforeMove.yaw});
  // Place selection on a distant defender, then exercise the actual switch key.
  // No movement, camera or switch implementation is replaced by this fixture.
  await page.evaluate(()=>{__T11.getState().selected[0]=2;});
  await page.waitForFunction(()=>{const camera=__T11.stats(),p=__T11.getState().players[2],f=camera.cameraForward;return camera.hiddenPlayerId===null&&Math.hypot(camera.cameraTarget.x-p.x-f.x*2.4,camera.cameraTarget.z-p.z-f.z*2.4)<1;});await page.keyboard.press('KeyQ');
  await page.waitForFunction(()=>{const camera=__T11.stats(),s=__T11.getState(),p=s.players[s.selected[0]],f=camera.cameraForward;return s.selected[0]!==2&&camera.hiddenPlayerId===null&&(p.x-camera.cameraPosition.x)*f.x+(p.z-camera.cameraPosition.z)*f.z>2&&Math.hypot(camera.cameraTarget.x-p.x-f.x*2.4,camera.cameraTarget.z-p.z-f.z*2.4)<1;});
  const switchedId=await page.evaluate(()=>__T11.getState().selected[0]);
  mark('Third-person retains the visible avatar and follows behind the new selection after switching',{switchedId});
  await page.locator('#pause-open').click();await page.locator('#pause-dialog').waitFor({state:'visible'});
  const paused=await page.evaluate(()=>{window.__qaMatchRef=__T11.getState();return {time:__qaMatchRef.time,tick:__qaMatchRef.tick,score:[...__qaMatchRef.score]};});

  assert.match((await page.locator('#leave-match').innerText()).trim(),/^Quit game(?:\s*[↗→])?$/i);
  await page.locator('#leave-match').click();await page.locator('#quit-dialog').waitFor({state:'visible'});
  await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>__T11.getState().time),paused.time);
  await page.locator('#quit-cancel').click();await page.locator('#pause-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#quit-dialog').isVisible(),false);
  assert.equal(await page.evaluate(()=>__T11.getState()===__qaMatchRef),true);
  assert.deepEqual(await page.evaluate(()=>({time:__T11.getState().time,tick:__T11.getState().tick,score:__T11.getState().score})),paused);
  await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>__T11.getState().time),paused.time);
  await page.locator('#resume').click();await page.waitForFunction(time=>__T11.getState().time>time,paused.time);
  mark('Cancel quit preserves match identity, score and paused clock, then resumes');

  await page.locator('#pause-open').click();await page.locator('#leave-match').click();await page.locator('#quit-confirm').click();
  await assertQuitScreen(page);await page.keyboard.down('KeyD');await page.keyboard.down('Space');await assertNeutral(page);await page.keyboard.up('Space');await page.keyboard.up('KeyD');
  await page.screenshot({path:resolve(out,'quit-screen.png')});
  await page.locator('#return-home').click();await page.locator('#home-screen').waitFor({state:'visible'});
  assert.equal(await page.locator('#quit-screen').isVisible(),false);assert.equal(await page.evaluate(()=>__T11.getState()),null);
  mark('Confirm quit clears offline state/input and the quit screen returns home');

  assert.match((await page.locator('#quit-game').innerText()).trim(),/^Quit game(?:\s*[↗→])?$/i);
  await page.locator('#quit-game').click();await page.locator('#quit-dialog').waitFor({state:'visible'});await page.locator('#quit-cancel').click();
  assert.ok(await page.locator('#home-screen').isVisible());assert.equal(await page.locator('#quit-dialog').isVisible(),false);
  await page.locator('#quit-game').click();await page.locator('#quit-confirm').click();await assertQuitScreen(page);
  await page.locator('#return-home').click();await page.locator('#home-screen').waitFor({state:'visible'});
  mark('Main-menu Quit game uses the same cancellable confirmation');

  // Exercise real transport teardown, not a mocked socket or offline-only path.
  await page.locator('#play-online').click();await page.locator('#server-url').fill(origin.replace('http','ws')+'/ws');await page.locator('#create-room').click();
  await page.waitForFunction(()=>__T11.getNetwork()?.room);const code=await page.locator('#room-display').textContent();
  const guestContext=await browser.newContext({viewport:{width:1280,height:800}});const guest=await guestContext.newPage();guest.setDefaultTimeout(20_000);observeErrors(guest,'guest');
  await guest.goto(origin+'/?debug=1');await waitForDebug(guest);await guest.locator('#play-online').click();await guest.locator('#server-url').fill(origin.replace('http','ws')+'/ws');
  await guest.locator('#room-code').fill(code);await guest.locator('#join-room').click();await guest.waitForFunction(()=>__T11.getNetwork()?.room);
  await page.locator('#online-duration').selectOption('60');await guest.waitForFunction(()=>document.getElementById('online-duration').value==='60');
  await page.locator('#ready').click();await guest.locator('#ready').click();await page.waitForFunction(()=>__T11.getState()?.phase==='playing');await guest.waitForFunction(()=>__T11.getState()?.phase==='playing');
  await page.evaluate(()=>{window.__qaNetworkRef=__T11.getNetwork();});
  await page.locator('#pause-open').click();await page.locator('#leave-match').click();const tick=await page.evaluate(()=>__T11.getState().tick);
  await page.waitForTimeout(250);assert.ok(await page.evaluate(()=>__T11.getState().tick)>tick,'Online authority must continue during quit confirmation');
  await page.locator('#quit-cancel').click();assert.ok(await page.locator('#pause-dialog').isVisible());
  assert.equal(await page.evaluate(()=>__T11.getNetwork()===__qaNetworkRef&&__qaNetworkRef.socket?.readyState===WebSocket.OPEN),true);
  mark('Cancel online quit preserves the live connection while authority continues');
  await page.locator('#leave-match').click();await page.locator('#quit-confirm').click();await assertQuitScreen(page);
  const detached=await page.evaluate(()=>({closedByUser:__qaNetworkRef.closedByUser,status:__qaNetworkRef.status,socketDetached:__qaNetworkRef.socket===null,room:__qaNetworkRef.room,token:__qaNetworkRef.token}));
  assert.deepEqual(detached,{closedByUser:true,status:'disconnected',socketDetached:true,room:null,token:null});
  await page.waitForTimeout(500);await assertQuitScreen(page);
  await page.locator('#return-home').click();await page.locator('#home-screen').waitFor({state:'visible'});
  mark('Confirm online quit releases transport and cannot resurrect the match');
  await guestContext.close();await context.close();
  assert.deepEqual(errors,[]);mark('No browser JavaScript exceptions');await report();
}catch(error){
  if(page&&!page.isClosed())await page.screenshot({path:resolve(out,'camera-menu-failure.png')}).catch(()=>{});
  await report(error);throw error;
}finally{await browser?.close();await service.close();}
