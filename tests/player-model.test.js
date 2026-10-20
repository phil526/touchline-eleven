import test from 'node:test';
import assert from 'node:assert/strict';
import {createFootballer} from '../client/animation.js';
import {createPlayerGeometries} from '../client/player-model.js';

test('both model detail levels provide finite, bounded surfaces for every articulated part',()=>{
  const counts=[];
  for(const detail of ['near','far']){
    const shapes=createPlayerGeometries(detail);
    for(const [name,geometry] of Object.entries(shapes)){
      const {position,normal,color,uv}=geometry.attributes;
      for(const attribute of [position,normal,color,uv])assert.ok(attribute.array.every(Number.isFinite),`${name} has finite surface data`);
      assert.equal(normal.count,position.count);assert.equal(color.count,position.count);assert.equal(uv.count,position.count);
      assert.ok(geometry.index.array.every(index=>index<position.count));
      geometry.computeBoundingBox();
      if(/head|crop|sweep|curls/.test(name)){
        const box=geometry.boundingBox;
        assert.ok(box.max.y<.2&&box.min.y>-.15&&box.max.x<.14&&box.min.x>-.14,`${name} stays on the head without spikes`);
      }
    }
    const shorts=shapes.shorts.attributes;
    assert.equal(shorts.legWeight.count,shorts.position.count);
    assert.ok(shorts.legWeight.array.every(w=>w>=0&&w<=1));
    for(let i=0;i<shorts.position.count;i++)if(shorts.position.getY(i)>.004)assert.equal(shorts.legWeight.getX(i),0,'Waist stays attached to the body');
    let triangles=0;
    for(let i=0;i<22;i++)for(const p of createFootballer(i,i<11?0:1,i%11===0).parts){
      assert.ok(shapes[p.shape],`Renderer provides ${p.shape}`);
      if(detail==='near'||!p.detail)triangles+=shapes[p.shape].index.count/3;
    }
    counts.push(triangles);Object.values(shapes).forEach(g=>g.dispose());
  }
  assert.ok(counts[1]<counts[0]*.55,'Distance detail substantially reduces geometry');
  assert.ok(counts[1]<60000,'All 22 distant models fit the mobile mesh budget');
});
