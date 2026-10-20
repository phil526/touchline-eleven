export const CONTROL_IDS=['stick','switch','sprint','jockey','lob','through','slide','pass','shoot','shots','skills'];
const labels={stick:'Move / aim',switch:'Switch',sprint:'Sprint',jockey:'Control',lob:'Loft / clear',through:'Through',slide:'Slide',pass:'Pass',shoot:'Shoot',shots:'Normal · Finesse · Chip',skills:'Roll · Feint · Fake'};
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function defaultLayout(w,h){
  const compact=h<=360&&w>h,small=h<=480&&w>h,columns=compact?4:3,bw=compact?48:small?52:64,bh=compact?36:small?37:48,gap=6;
  const groupW=columns*bw+(columns-1)*gap,right=Math.max(16,w*.04),bottom=small?15:25,left=w-right-groupW;
  const rows=compact?2:3,groupH=rows*bh+(rows-1)*gap,top=h-bottom-groupH,layout={};
  CONTROL_IDS.slice(1,9).forEach((id,i)=>{const span=id==='shoot'&&!compact?2:1,col=i%columns,row=Math.floor(i/columns);layout[id]={x:(left+col*(bw+gap)+(bw*span+gap*(span-1))/2)/w,y:(top+row*(bh+gap)+bh/2)/h,scale:1};});
  layout.stick={x:(right+(small?95:130)/2)/w,y:(h-25-(small?95:130)/2)/h,scale:1};
  layout.shots={x:(left+groupW/2)/w,y:(top-6-(small?38:46)/2)/h,scale:1};layout.skills={x:layout.shots.x,y:layout.shots.y-(small?44:52)/h,scale:1};return layout;
}
export function sanitizeLayout(data){
  if(!data||typeof data!=='object')return null;const result={};
  for(const id of CONTROL_IDS){const p=data[id]||(id==='skills'&&data.shots?{...data.shots,y:Math.max(.08,data.shots.y-.14)}:null);if(!p||![p.x,p.y,p.scale].every(Number.isFinite))return null;result[id]={x:clamp(p.x,0,1),y:clamp(p.y,0,1),scale:clamp(p.scale,.8,1.5)};}
  return result;
}
export function controlRect(id,p,w,h,minY=8){
  const compact=h<=360&&w>h,small=h<=480&&w>h,bw=compact?48:small?52:64,bh=compact?36:small?37:48;
  const baseW=id==='stick'?(small?95:130):['shots','skills'].includes(id)?(compact?210:small?168:204):id==='shoot'&&!compact?bw*2+6:bw;
  const baseH=id==='stick'?(small?95:130):['shots','skills'].includes(id)?(small?38:46):bh;
  const width=Math.min(w-16,Math.max(id==='stick'?72:36,baseW*p.scale)),height=Math.min(h-minY-8,Math.max(32,baseH*p.scale));
  return {x:clamp(p.x*w-width/2,8,w-width-8),y:clamp(p.y*h-height/2,minY,h-height-8),width,height};
}
export function overlaps(rects){const hits=new Set();for(let i=0;i<CONTROL_IDS.length;i++)for(let j=i+1;j<CONTROL_IDS.length;j++){const a=rects[CONTROL_IDS[i]],b=rects[CONTROL_IDS[j]];if(a.x<b.x+b.width-1&&a.x+a.width>b.x+1&&a.y<b.y+b.height-1&&a.y+a.height>b.y+1){hits.add(CONTROL_IDS[i]);hits.add(CONTROL_IDS[j]);}}return [...hits];}

export function createTouchLayout({onClear=()=>{}}={}){
  const $=id=>document.getElementById(id),key='t11.touch-layout.v1',dialog=$('touch-layout-dialog'),surface=$('layout-surface');
  let saved={},draft=null,selected='shoot',drag=null;
  try{const raw=JSON.parse(localStorage.getItem(key)||'{}');for(const mode of ['landscape','portrait']){const clean=sanitizeLayout(raw[mode]);if(clean)saved[mode]=clean;}}catch{}
  const mode=()=>innerWidth>innerHeight?'landscape':'portrait';
  const targets=Object.fromEntries(CONTROL_IDS.map(id=>[id,id==='stick'?$('touch-stick'):id==='skills'?document.querySelector('.skill-selector'):id==='shots'?document.querySelector('.shot-selector'):document.querySelector(`[data-action=${id}]`)]));
  const rects=(layout,minY=8)=>Object.fromEntries(CONTROL_IDS.map(id=>[id,controlRect(id,layout[id],innerWidth,innerHeight,minY)]));
  function position(el,r){Object.assign(el.style,{position:'fixed',left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px',right:'auto',bottom:'auto',margin:'0',gridColumn:'auto'});}
  function apply(){
    const layout=saved[mode()];$('touch-controls').classList.toggle('custom-layout',!!layout);
    if(!layout){for(const el of Object.values(targets))el.removeAttribute('style');return;}
    let boxes=rects(layout);if(overlaps(boxes).length)boxes=rects(defaultLayout(innerWidth,innerHeight));
    for(const id of CONTROL_IDS)position(targets[id],boxes[id]);
  }
  function draw(){
    const top=$('layout-toolbar').getBoundingClientRect().bottom+8,boxes=rects(draft,top),hits=overlaps(boxes);
    for(const id of CONTROL_IDS){const el=surface.querySelector(`[data-control=${id}]`);position(el,boxes[id]);el.classList.toggle('selected',id===selected);el.classList.toggle('overlap',hits.includes(id));el.setAttribute('aria-pressed',String(id===selected));}
    $('layout-size').value=draft[selected].scale;$('layout-size-value').textContent=Math.round(draft[selected].scale*100)+'%';$('layout-selected').textContent=labels[selected];
    $('layout-save').disabled=hits.length>0;$('layout-message').textContent=hits.length?'Move the outlined controls apart before saving.':'Drag controls. Select one to resize it, or use arrow keys to move it.';
  }
  for(const id of CONTROL_IDS){
    const button=document.createElement('button');button.type='button';button.dataset.control=id;button.className='layout-control';button.textContent=labels[id];button.setAttribute('aria-label','Position '+labels[id]);surface.append(button);
    button.addEventListener('pointerdown',e=>{e.preventDefault();selected=id;const r=button.getBoundingClientRect();drag={id,pointer:e.pointerId,dx:e.clientX-(r.x+r.width/2),dy:e.clientY-(r.y+r.height/2)};button.setPointerCapture(e.pointerId);draw();});
    button.addEventListener('pointermove',e=>{if(drag?.pointer!==e.pointerId)return;draft[id].x=(e.clientX-drag.dx)/innerWidth;draft[id].y=(e.clientY-drag.dy)/innerHeight;draw();});
    const release=e=>{if(drag?.pointer===e.pointerId)drag=null;};for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,release);
    button.addEventListener('click',()=>{selected=id;draw();});
    button.addEventListener('keydown',e=>{const dx={ArrowLeft:-4,ArrowRight:4}[e.key]||0,dy={ArrowUp:-4,ArrowDown:4}[e.key]||0;if(dx||dy){e.preventDefault();selected=id;draft[id].x+=dx/innerWidth;draft[id].y+=dy/innerHeight;draw();}});
  }
  $('layout-size').addEventListener('input',()=>{draft[selected].scale=Number($('layout-size').value);draw();});
  $('layout-reset').onclick=()=>{draft=defaultLayout(innerWidth,innerHeight);draw();};
  $('layout-cancel').onclick=()=>dialog.close();
  $('layout-save').onclick=()=>{
    const boxes=rects(draft,$('layout-toolbar').getBoundingClientRect().bottom+8);if(overlaps(boxes).length)return;
    for(const id of CONTROL_IDS){draft[id].x=(boxes[id].x+boxes[id].width/2)/innerWidth;draft[id].y=(boxes[id].y+boxes[id].height/2)/innerHeight;}
    saved[mode()]=sanitizeLayout(draft);try{localStorage.setItem(key,JSON.stringify(saved));}catch{}
    apply();dialog.close();
  };
  dialog.addEventListener('close',()=>{draft=null;drag=null;onClear();});
  window.addEventListener('resize',()=>{onClear();apply();if(draft)draw();});apply();
  return {open(){onClear();draft=structuredClone(saved[mode()]||defaultLayout(innerWidth,innerHeight));dialog.showModal();draw();},apply,get saved(){return structuredClone(saved);}};
}
