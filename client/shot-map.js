import {shotFeedback} from '../shared/shot-log.js';
import {TEAMS} from '../shared/config.js';
export const OUTCOMES={goal:['●','Goal'],saved:['○','Saved'],missed:['×','Missed'],blocked:['■','Blocked'],woodwork:['◆','Woodwork'],flight:['·','In flight']};
export function mapShotPosition(shot){return {x:Math.max(0,Math.min(100,(shot.x*shot.dir+52.5)/105*100)),y:Math.max(0,Math.min(100,(shot.z*shot.dir+34)/68*100))};}
export function createShotMap(){
 const $=id=>document.getElementById(id);let entries=[],filter='all',selected=null;
 function select(q){
  selected=q.id;
  $('shot-detail').textContent=`${TEAMS[q.team].abbr} · ${q.name} · ${q.kind} · ${Math.round(q.power*100)}% power · ${OUTCOMES[q.outcome]?.[1]||'Missed'}. ${shotFeedback(q)}`;
  document.querySelectorAll('[data-shot-id]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shotId===String(q.id))));
 }
 function draw(){
  const shots=entries.filter(q=>filter==='all'||q.team===Number(filter));
  const goals=shots.filter(q=>q.outcome==='goal').length;
  $('shot-map-count').textContent=shots.length?`${shots.length} ${shots.length===1?'attempt':'attempts'} · ${goals} ${goals===1?'goal':'goals'} · ${shots.filter(q=>q.outcome==='saved').length} saved`:'No shots yet. Your attempts will appear here.';
  $('shot-markers').replaceChildren();$('shot-list').replaceChildren();
  shots.forEach((q,index)=>{
   const [symbol,label]=OUTCOMES[q.outcome]||OUTCOMES.missed,pos=mapShotPosition(q),dot=document.createElement('button');
   dot.className=`shot-dot shot-${q.outcome}`;dot.textContent=symbol;dot.dataset.shotId=q.id;dot.style.left=pos.x+'%';dot.style.top=pos.y+'%';
   dot.setAttribute('aria-label',`${TEAMS[q.team].abbr}, ${q.name}, ${label}, shot ${index+1}`);dot.onclick=()=>select(q);$('shot-markers').append(dot);
   const row=document.createElement('button');row.className=`shot-list-item shot-${q.outcome}`;row.dataset.shotId=q.id;row.textContent=`${index+1}. ${symbol} ${TEAMS[q.team].abbr} · ${q.name} · ${label}`;row.onclick=()=>select(q);$('shot-list').prepend(row);
  });
  document.querySelectorAll('[data-shot-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shotFilter===filter)));
  const q=shots.find(q=>q.id===selected)||shots.at(-1);if(q)select(q);else $('shot-detail').textContent='Select a marker or an attempt below for details.';
 }
 document.querySelectorAll('[data-shot-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.shotFilter;draw();});
 return {show(shots){entries=structuredClone(shots||[]);selected=null;draw();}};
}
