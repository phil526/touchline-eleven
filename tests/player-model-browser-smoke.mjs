import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {createGameServer} from '../server/index.js';

const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0});const {port}=await service.listen();
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--enable-unsafe-swiftshader']});
const checks=[],errors=[],mark=(name,details)=>{checks.push({name,status:'passed',details});console.log('PASS '+name);};
try {
  const context=await browser.newContext({viewport:{width:1366,height:900}});
  await context.addInitScript(()=>localStorage.setItem('t11.preferences',JSON.stringify({quality:'high',shadows:true,autoQuality:false,cameraMode:'third-person',master:0})));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error'&&/Shader|WebGL|VALIDATE_STATUS/.test(message.text()))errors.push(message.text());});
  await page.goto(`http://localhost:${port}/?debug=1`);await page.waitForFunction(()=>window.__T11);
  await page.evaluate(()=>__T11.startPractice('penalties'));await page.waitForFunction(()=>__T11.stats().cameraMode==='penalty'&&__T11.getState().restart?.armed);
  const penalty=await page.evaluate(()=>__T11.stats());assert.ok(penalty.nearPlayerModels>=2);assert.ok(penalty.playerTriangles<130000);
  await page.screenshot({path:resolve(out,'models-penalty.png')});mark('Penalty taker and goalkeeper use detailed models with a bounded mesh budget',penalty);
  await page.locator('#practice-exit').click();
  await page.evaluate(()=>{__T11.start({duration:600,humans:[true,false]});const s=__T11.getState();s.phase='playing';s.restart=null;s.selected[0]=9;
    for(const p of s.players)Object.assign(p,{x:-30+p.slot*3,z:p.team===0?-23:23,vx:0,vz:0,cooldown:8});
    Object.assign(s.players[9],{x:0,z:0,facing:0,cooldown:0});Object.assign(s.ball,{x:.5,y:.11,z:0,owner:9,state:'controlled',lastShot:null});
  });await page.waitForFunction(()=>__T11.stats().cameraMode==='third-person');
  const start=await page.evaluate(()=>__T11.getState().players[9].x);
  await page.keyboard.down('KeyW');await page.waitForFunction(x=>__T11.getState().players[9].x>x+2,start);await page.screenshot({path:resolve(out,'models-gameplay-running.png')});await page.keyboard.up('KeyW');
  const close=await page.evaluate(()=>__T11.stats());assert.equal(await page.evaluate(()=>__T11.getState().players.length),22);assert.ok(close.nearPlayerModels>0);mark('Full match uses the same detailed rig while the controlled player runs',close);
  await page.evaluate(()=>__T11.preferences.cameraMode='telebroadcast');await page.waitForFunction(()=>__T11.stats().cameraMode==='telebroadcast'&&__T11.stats().nearPlayerModels===0);
  const broadcast=await page.evaluate(()=>__T11.stats());assert.ok(broadcast.playerTriangles<penalty.playerTriangles);assert.ok(broadcast.playerTriangles<60000);
  await page.screenshot({path:resolve(out,'models-gameplay-broadcast.png')});mark('Broadcast distance reduces geometry while retaining all 22 players',broadcast);
  // Art inspection stage uses the actual production geometry and rig. It is
  // confined to this QA page, and is not an alternate in-game model.
  await page.goto(`http://localhost:${port}/`);await page.waitForFunction(()=>document.querySelector('#home-screen'));
  const inventory=await page.evaluate(async()=>{
    const THREE=await import('three'),{createFootballer,animateFootballer}=await import('/client/animation.js'),{createPlayerGeometries,createPlayerTextures,bendShortsMaterial}=await import('/client/player-model.js');
    document.body.innerHTML='<canvas id="inspection"></canvas>';Object.assign(document.body.style,{margin:'0',background:'#17252d'});
    const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('#inspection'),antialias:true,preserveDrawingBuffer:true});renderer.setSize(1366,900);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;
    const scene=new THREE.Scene();scene.background=new THREE.Color('#17252d');scene.add(new THREE.HemisphereLight(0xdceaff,0x354131,2));
    const key=new THREE.DirectionalLight(0xffe9d0,2.6);key.position.set(-3,6,5);scene.add(key);const fill=new THREE.DirectionalLight(0x9bc4ff,.8);fill.position.set(4,3,-2);scene.add(fill);
    const shapes=createPlayerGeometries(),maps=createPlayerTextures((w,h,draw)=>{const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;});
    const mat=(roughness,map)=>new THREE.MeshStandardMaterial({roughness,map,vertexColors:true});const materials={cloth:mat(.84,maps.fabric),skin:mat(.74),head:mat(.79,maps.face),hair:mat(.95),boot:mat(.62)};
    const rigs=[];
    for(let i=0;i<5;i++){
      const rig=createFootballer([9,15,0,8,20][i],i===1||i===4?1:0,i===2),p={id:i,team:0,x:(i-2)*.9,z:0,vx:0,vz:0,facing:Math.PI/2+(i===3?Math.PI:i===4?-.6:0),anim:'idle',actionTime:0};
      animateFootballer(rig,p,1/60,0,{phase:'playing',ball:{x:0,z:2,y:.11,owner:null}});
      for(const part of rig.parts){const material=part.shape==='head'?materials.head:/crop|sweep|curls/.test(part.shape)?materials.hair:part.shape==='boot'?materials.boot:/round|upperArm|forearm|hand|thigh/.test(part.shape)?materials.skin:materials.cloth;
        const geometry=part.shape==='shorts'?shapes.shorts.clone():shapes[part.shape];
        const mesh=new THREE.Mesh(geometry,material.clone());
        if(part.shape==='shorts'){
          bendShortsMaterial(mesh.material);
          for(const [leg,side] of ['Left','Right'].entries()){
            const q=rig.legs[leg].upper.quaternion.toArray(),values=[];
            for(let j=0;j<geometry.attributes.position.count;j++)values.push(...q);
            geometry.setAttribute(`leg${side}Quaternion`,new THREE.Float32BufferAttribute(values,4));
          }
        }
        mesh.material.color.setHex(part.colour);mesh.matrixAutoUpdate=false;mesh.matrix.copy(part.node.matrixWorld);scene.add(mesh);
      }rigs.push(rig);
    }
    const camera=new THREE.PerspectiveCamera(34,1366/900,.1,100);camera.position.set(0,1.7,7);camera.lookAt(0,.92,0);renderer.render(scene,camera);
    window.__inspection={renderer,scene,camera,rigs,shapes};return {shapes:Object.keys(shapes),players:rigs.length};
  });await page.screenshot({path:resolve(out,'models-lineup.png')});mark('Front, back and three-quarter inspection covers both kits and keeper',inventory);
  assert.deepEqual(errors,[]);mark('No browser JavaScript exceptions');await writeFile(resolve(out,'player-model-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),checks,errors},null,2));await context.close();
} finally {await browser.close();await service.close();}
