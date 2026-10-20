import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveQuality} from '../client/adaptive-quality.js';
import {CONTROL_IDS,defaultLayout,sanitizeLayout,controlRect,overlaps} from '../client/touch-layout.js';
function feed(a,seconds,dt,options={}){let last;for(let t=0;t<seconds;t+=dt)last=a.sample(dt,{quality:'high',...options});return last;}
test('sustained slow frames reduce detail then resolution and remain bounded',()=>{const a=createAdaptiveQuality();const r=feed(a,40,.05);assert.equal(r.quality,'low');assert.equal(r.resolutionScale,.65);assert.equal(r.shadows,false);assert.equal(a.tier,4);});
test('a fast phone stays at the chosen maximum, and recovery has hysteresis',()=>{const a=createAdaptiveQuality();assert.equal(feed(a,30,1/60,{quality:'low'}).tier,2);feed(a,8,.05,{quality:'low'});const low=a.tier;assert.ok(low>2);feed(a,8,1/60,{quality:'low'});assert.ok(a.tier>=low,'brief recovery must not raise detail');const recovered=feed(a,80,1/60,{quality:'low'});assert.equal(recovered.tier,2);});
test('menus, background gaps and invalid samples do not reduce quality',()=>{const a=createAdaptiveQuality();feed(a,40,.1,{active:false});for(const dt of [NaN,Infinity,-1,2])a.sample(dt,{quality:'high'});assert.equal(a.tier,0);assert.equal(feed(a,20,.05,{auto:false,quality:'medium'}).tier,1);});
test('manual quality changes reset the ceiling without persisting adaptive degradation',()=>{const a=createAdaptiveQuality();feed(a,35,.05);const r=a.sample(.016,{quality:'medium',auto:false,shadows:false});assert.equal(r.quality,'medium');assert.equal(r.resolutionScale,1);assert.equal(r.shadows,false);});
test('a stable 60 Hz desktop can recover to its selected quality ceiling',()=>{const a=createAdaptiveQuality({targetFps:50});feed(a,35,.05);assert.equal(a.tier,4);assert.equal(feed(a,100,1/60).tier,0);});
test('default touch presets fit landscape and portrait without overlapping controls',()=>{
 for(const [w,h] of [[568,320],[844,390],[1280,800],[390,844]]){const d=defaultLayout(w,h),rects=Object.fromEntries(CONTROL_IDS.map(id=>[id,controlRect(id,d[id],w,h)]));assert.deepEqual(overlaps(rects),[],`${w}x${h}`);for(const r of Object.values(rects)){assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=w&&r.y+r.height<=h);}}
});
test('saved layout validation rejects corruption and bounds sizes and positions',()=>{
 assert.equal(sanitizeLayout(null),null);assert.equal(sanitizeLayout({shoot:{x:0,y:0,scale:1}}),null);const d=defaultLayout(844,390);d.shoot={x:-20,y:20,scale:999};const clean=sanitizeLayout(d);assert.deepEqual(clean.shoot,{x:0,y:1,scale:1.5});const r=controlRect('shoot',clean.shoot,568,320);assert.ok(r.x>=8&&r.y+r.height<=312);d.pass.x=NaN;assert.equal(sanitizeLayout(d),null);
});
