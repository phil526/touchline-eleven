import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=resolve(process.env.QA_OUTPUT||'qa-output');await mkdir(out,{recursive:true});
const service=createGameServer({port:0}),address=await service.listen(),origin=`http://127.0.0.1:${address.port}`;
const checks=[],errors=[];let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--enable-unsafe-swiftshader']});
 for(const [width,height] of [[1440,900],[1280,720],[390,844],[844,390],[320,568]]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>document.fonts.check('700 20px "Barlow Condensed"'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const heading=await page.locator('h1').boundingBox(),panel=await page.locator('.matchup-panel').boundingBox(),header=await page.locator('#masthead').boundingBox();
  assert.ok(heading.y>=header.y+header.height-1);assert.ok(panel.y>=heading.y+heading.height);assert.ok(panel.x>=0&&panel.x+panel.width<=width);
  for(const id of ['play-offline','play-practice','play-online']){await page.locator('#'+id).scrollIntoViewIfNeeded();const box=await page.locator('#'+id).boundingBox();assert.ok(box.width>=100&&box.height>=37&&box.x>=0&&box.x+box.width<=width);}
  await page.locator('#home-screen').evaluate(e=>e.scrollTop=0);await page.screenshot({path:resolve(out,`title-${width}x${height}.png`)});
  checks.push({name:`Title typography and actions fit ${width}x${height}`,status:'passed'});console.log(`PASS title ${width}x${height}`);await context.close();
 }
 assert.deepEqual(errors,[]);await writeFile(resolve(out,'title-browser-report.json'),JSON.stringify({testedAt:new Date().toISOString(),browser:browser.version(),checks,errors},null,2));
}finally{await browser?.close();await service.close();}
