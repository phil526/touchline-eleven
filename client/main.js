import {isManualRestart} from '../shared/restarts.js';
import {defendingPenalty} from '../shared/keeper-control.js';
import {SKILLS} from '../shared/skills.js';
import {createShotMap} from './shot-map.js';
import {penaltyScene} from '../shared/penalties.js';
import {createMatch,stepMatch,neutralInput,getMatchClock} from '../shared/simulation.js';
import {shotType,SHOT_NAMES} from '../shared/shooting.js';
import {TEAMS} from '../shared/config.js';
import {createRenderer} from './render.js';
import {createInput} from './input.js';
import {createAdaptiveQuality} from './adaptive-quality.js';
import {createTouchLayout} from './touch-layout.js';
import {MatchAudio} from './audio.js';
import {NetworkClient} from './network.js';
import {createGoalReplay} from './replay.js';
import {createPracticeSession,PRACTICE_DRILLS} from './practice.js';
const $=id=>document.getElementById(id),query=new URLSearchParams(location.search);
const DEBUG=query.get('debug')==='1';
let mode='home',team=0,online=false,state=null,net=null,paused=false,resultShown=false,accumulator=0,lastFrame=performance.now(),hudTime=0,toastTimer,roomReady=false,lastMatchId=-1,device='keyboard';
let attract=createMatch({humans:[false,false],duration:600});
let practice=null;
const replay=createGoalReplay();
const prefs={quality:matchMedia('(pointer:coarse)').matches?'low':'medium',shadows:true,autoQuality:true,cameraMode:'broadcast',cameraHeight:.45,cameraZoom:.5,cameraFov:80,reducedMotion:false,master:.65,effects:.7,crowd:.3,touch:false,shotAssist:true,keeperAssist:false};
try{Object.assign(prefs,JSON.parse(localStorage.getItem('t11.preferences')||'{}'));}catch{}
if(prefs.cameraMode==='first-person'){prefs.cameraMode='third-person';try{localStorage.setItem('t11.preferences',JSON.stringify(prefs));}catch{}}
if(!['broadcast','telebroadcast','third-person'].includes(prefs.cameraMode))prefs.cameraMode='broadcast';
for(const [key,min,max,fallback] of [['cameraHeight',0,1,.45],['cameraZoom',0,1,.5],['cameraFov',60,100,80]])prefs[key]=Number.isFinite(prefs[key])?Math.max(min,Math.min(max,prefs[key])):fallback;
const shotMap=createShotMap();
const sound=new MatchAudio();sound.set(prefs);
const input=createInput({onPause:togglePause,onDevice:d=>{device=d;$('device-label').textContent=d.toUpperCase();if(d==='touch')document.body.classList.add('touch');const labels=d==='gamepad'?[['LB+A','One-two'],['A','Pass'],['Y','Through'],['X','Loft / slide'],['B','Shoot'],['RB','Tackle'],['LB','Switch']]:[['R','One-two'],['J','Pass'],['K','Through'],['L','Loft'],['SPACE','Shoot'],['F','Slide'],['Q','Switch']];$('quick-controls').innerHTML=labels.map(([key,label])=>`<span><kbd>${key}</kbd> ${label}</span>`).join('');}});
let renderer;
try{renderer=createRenderer($('pitch'));}catch(error){$('loading').hidden=false;$('loading').innerHTML='<strong>Your browser could not start the 3D renderer.</strong><span>Enable hardware acceleration and use a browser with WebGL 2.</span>';console.error(error);throw error;}
const adaptive=createAdaptiveQuality({targetFps:matchMedia('(pointer:coarse)').matches?30:50});
let adaptiveOptions=adaptive.sample(0,{active:false,auto:prefs.autoQuality!==false,...prefs});
const touchLayout=createTouchLayout({onClear:()=>input.clear()});
$('customize-touch').onclick=()=>touchLayout.open();
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4400);}
function syncPreferences(){
 $('keeper-assist').checked=prefs.keeperAssist===true;
 $('shot-assist').checked=prefs.shotAssist!==false;
 $('auto-quality').checked=prefs.autoQuality!==false;$('quality').value=prefs.quality;$('shadows').value=prefs.shadows?'on':'off';$('camera-mode').value=prefs.cameraMode;$('camera-height').value=prefs.cameraHeight;$('camera-zoom').value=prefs.cameraZoom;$('camera-fov').value=prefs.cameraFov;$('reduced-motion').checked=prefs.reducedMotion;$('touch-always').checked=prefs.touch;
 const thirdPerson=prefs.cameraMode==='third-person';$('camera-height-label').hidden=$('camera-zoom-label').hidden=false;$('camera-fov-label').hidden=!thirdPerson;
 $('camera-height-value').value=`${Math.round(prefs.cameraHeight*100)}%`;$('camera-zoom-value').value=`${Math.round(prefs.cameraZoom*100)}%`;$('camera-fov-value').value=`${prefs.cameraFov}°`;
 $('camera-description').textContent=thirdPerson?'Follow behind your selected player. Drag the pitch or use the right stick to orbit. Movement follows your view; height and zoom adjust the follow distance.':prefs.cameraMode==='telebroadcast'?'A lower sideline view with a tighter lens, inspired by television match coverage. Increase zoom to get closer to the action.':'An elevated sideline view that keeps your passing options in sight. Adjust height and zoom to suit your game.';
 input.setThirdPerson(thirdPerson&&mode==='match');document.body.classList.toggle('third-person',thirdPerson&&mode==='match');$('third-person-hint').hidden=!thirdPerson||mode!=='match';
 for(const key of ['master','effects','crowd'])$('volume-'+key).value=prefs[key];
 document.body.classList.toggle('touch',prefs.touch||matchMedia('(pointer:coarse)').matches);sound.set(prefs);
}
syncPreferences();
function savePreferences(){prefs.keeperAssist=$('keeper-assist').checked;prefs.shotAssist=$('shot-assist').checked;prefs.autoQuality=$('auto-quality').checked;prefs.quality=$('quality').value;prefs.shadows=$('shadows').value==='on';prefs.cameraMode=$('camera-mode').value;prefs.cameraHeight=Number($('camera-height').value);prefs.cameraZoom=Number($('camera-zoom').value);prefs.cameraFov=Number($('camera-fov').value);prefs.reducedMotion=$('reduced-motion').checked;prefs.touch=$('touch-always').checked;for(const key of ['master','effects','crowd'])prefs[key]=Number($('volume-'+key).value);try{localStorage.setItem('t11.preferences',JSON.stringify(prefs));}catch{}syncPreferences();}
$('settings-dialog').addEventListener('input',savePreferences);
function openDialog(id){skipReplay();input.clear();updateShotPower(null);sound.start();$(id).showModal();}
document.querySelectorAll('.dialog-close').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
$('settings-open').onclick=()=>openDialog('settings-dialog');$('controls-open').onclick=()=>openDialog('controls-dialog');
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',()=>input.clear()));
$('pause-dialog').addEventListener('cancel',e=>{e.preventDefault();resume();});
$('results-dialog').addEventListener('cancel',e=>e.preventDefault());
function showScreen(name){
 sound.reset();sound.update(null);mode=name;updateShotPower(null);document.body.classList.remove('playing','third-person','practising');document.body.classList.toggle('quit',name==='quit');$('hud').hidden=true;$('practice-hud').hidden=true;input.setEnabled(false);input.setThirdPerson(false);$('third-person-hint').hidden=true;
 for(const id of ['home','setup','online','quit'])$(id+'-screen').hidden=name!==id;
 if(name!=='quit'){sound.start();sound.play('menu');}
}
function endSession(){replay.reset();updateReplayHud();if(net){net.leave();net.disconnect();net=null;}practice=null;$('practice-hud').hidden=true;document.body.classList.remove('practising');online=false;state=null;paused=false;roomReady=false;lastMatchId=-1;accumulator=0;Object.assign(pendingActions,neutralInput());input.clear();for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();$('room-details').hidden=true;$('online-error').textContent='';$('online-status').textContent='Connect to create or join a room.';clearTimeout(toastTimer);$('toast').hidden=true;}
function home(){endSession();showScreen('home');}
function requestQuit(){$('quit-note').textContent=mode==='match'?(practice?'End this practice session? Your drill counters will reset.':online?'Leave this match and disconnect? Your opponent will be told you have left.':'End this exhibition? Your current match progress will be lost.'):'End your session? You can return to the title screen whenever you like.';openDialog('quit-dialog');}
$('quit-game').onclick=requestQuit;$('quit-cancel').onclick=()=>$('quit-dialog').close();$('quit-confirm').onclick=()=>{endSession();showScreen('quit');sound.suspend();$('quit-title').focus();};$('return-home').onclick=home;
$('masthead').querySelector('.brand').onclick=e=>{e.preventDefault();home();};document.querySelectorAll('[data-home]').forEach(button=>button.onclick=home);
$('play-offline').onclick=()=>showScreen('setup');
$('play-online').onclick=()=>showScreen('online');
$('play-practice').onclick=()=>openDialog('practice-dialog');
function practiceDescription(){const drill=PRACTICE_DRILLS[$('practice-drill').value];$('practice-description').textContent=drill.objective;$('practice-controls').textContent=drill.controls;}
$('practice-drill').onchange=practiceDescription;practiceDescription();
function startPractice(drill=$('practice-drill').value){endSession();team=0;practice=createPracticeSession({drill});state=practice.state;enterMatch();updateHud(state);}
function restartPractice(){if(!practice)return;state=practice.restart();enterMatch();updateHud(state);}
$('practice-start').onclick=()=>startPractice();$('practice-restart').onclick=restartPractice;$('practice-exit').onclick=home;
document.querySelectorAll('[data-team]').forEach(button=>button.onclick=()=>{team=Number(button.dataset.team);document.querySelectorAll('[data-team]').forEach(el=>{const selected=Number(el.dataset.team)===team;el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));});sound.play('menu');});
function matchOptions(){const tactics=['balanced','balanced'];tactics[team]=$('mentality').value;return {duration:Number($('duration').value),difficulty:$('difficulty').value,tactics,humans:[team===0,team===1]};}
function enterMatch(){replay.reset();updateReplayHud();mode='match';paused=false;resultShown=false;sound.reset();accumulator=0;Object.assign(pendingActions,neutralInput());input.clear();document.body.classList.remove('quit');document.body.classList.add('playing');document.body.classList.toggle('practising',!!practice);$('hud').hidden=false;$('practice-hud').hidden=!practice;$('restart').textContent=practice?'Restart drill':'Restart exhibition';$('leave-match').textContent=practice?'Exit practice':'Quit game';for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();input.setEnabled(true);syncPreferences();sound.start();$('loading').hidden=true;}
async function startOffline(options=matchOptions()){practice=null;online=false;state=createMatch(options);$('loading').hidden=false;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));enterMatch();toast(`${TEAMS[team].name} · ${team===0?'Attack to the right':'Attack to the left'} in the first half`);}
$('kickoff').onclick=()=>startOffline();
function togglePause(){if(skipReplay())return;if(mode!=='match'||state?.phase==='fulltime')return;if($('pause-dialog').open){resume();return;}paused=!online;$('pause-title').textContent=practice?'PRACTICE PAUSED':online?'MATCH MENU':'MATCH PAUSED';$('pause-note').textContent=practice?'Your drill is waiting. Resume, restart or try another session.':online?'The online match continues while this menu is open.':'Take a breath. The clock will wait.';$('restart').hidden=online;input.clear();if(online)net?.input({...neutralInput(),cancelCharge:true});openDialog('pause-dialog');}
function resume(){paused=false;$('pause-dialog').close();input.clear();}
$('pause-open').onclick=togglePause;$('resume').onclick=resume;$('restart').onclick=()=>practice?restartPractice():startOffline();$('leave-match').onclick=()=>practice?home():requestQuit();$('pause-controls').onclick=()=>openDialog('controls-dialog');$('pause-settings').onclick=()=>openDialog('settings-dialog');
window.addEventListener('blur',()=>{skipReplay();input.clear();if(online)net?.input({...neutralInput(),cancelCharge:true});else if(mode==='match'&&!paused&&state?.phase!=='fulltime')togglePause();});
for(const type of ['pointerdown','keydown'])document.addEventListener(type,()=>{if(sound.ctx?.state==='suspended'&&!document.hidden)sound.start();},{passive:true});
document.addEventListener('visibilitychange',()=>{if(document.hidden){sound.suspend();skipReplay();input.clear();if(online)net?.input({...neutralInput(),cancelCharge:true});else if(mode==='match'&&!paused&&state?.phase!=='fulltime')togglePause();}});
function showResults(){resultShown=true;input.clear();$('final-score').textContent=`${state.score[0]} – ${state.score[1]}`;let copy=state.score[0]===state.score[1]?'Honours even at Meridian Ground.':`${TEAMS[state.score[0]>state.score[1]?0:1].name} take the honours.`;if(state.result?.reason==='disconnect')copy='Exhibition ended: your opponent left or did not reconnect.';$('result-copy').textContent=copy;const stats=state.stats;$('result-stats').textContent=stats?`Shots ${stats.shots[0]} – ${stats.shots[1]}   ·   Passes ${stats.passes[0]} – ${stats.passes[1]}   ·   Saves ${stats.saves[0]} – ${stats.saves[1]}`:'';$('rematch-status').textContent='';$('rematch').disabled=state.result?.reason==='disconnect';$('rematch').textContent=online?'Request a rematch →':'Play again →';openDialog('results-dialog');}
let mapWasPaused=false;
document.querySelectorAll('[data-open-shots]').forEach(button=>button.onclick=()=>{mapWasPaused=paused;if(!online)paused=true;shotMap.show(practice?.shots||state?.shotLog||[]);openDialog('shot-map-dialog');});
$('shot-map-dialog').addEventListener('close',()=>{paused=mapWasPaused;});
$('rematch').onclick=()=>{if(online){net.rematch();$('rematch').disabled=true;$('rematch-status').textContent='Your rematch vote is in. Waiting for your opponent.';}else startOffline();};$('results-home').onclick=home;
const defaultServer=location.port==='5173'?`${location.protocol==='https:'?'wss':'ws'}://${location.hostname}:8787/ws`:location.hostname==='localhost'||/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)?`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`:'';
$('server-url').value=query.get('server')||defaultServer;$('room-code').value=query.get('room')||'';
function roomUpdate(room){
 if(!room){$('room-details').hidden=true;return;}team=room.team;$('room-details').hidden=false;$('room-display').textContent=room.code;$('online-team').value=room.settings.hostTeam;$('online-duration').value=room.settings.duration;$('online-tactic').value=room.settings.tactics?.[team]||'balanced';$('online-team').disabled=!room.host;$('online-duration').disabled=!room.host;
 const own=room.players[room.slot];roomReady=!!own?.ready;$('ready').textContent=roomReady?'Ready ✓ · click to cancel':'Ready to play →';
 $('participants').replaceChildren(...room.players.map((p,index)=>{const row=document.createElement('div');row.className='participant';const text=document.createElement('strong');text.textContent=index===room.slot?'You':p?.connected?'Opponent':'Waiting for opponent';const status=document.createElement('span');status.textContent=p?.connected?(p.ready?'READY':'CONNECTED'):p?'RECONNECTING':'OPEN SLOT';row.append(text,status);return row;}));
 $('online-status').textContent=room.players.every(p=>p?.connected)?'Both players connected. Ready up to start.':'Waiting for opponent · share the room code or invite link.';
 if(mode==='match'&&state?.phase==='fulltime'&&room.players.some(p=>p?.rematch))$('rematch-status').textContent=own?.rematch?'Your rematch vote is in. Waiting for your opponent.':'Your opponent wants a rematch. Select Play again to accept.';
}
async function ensureNetwork(){
 const url=$('server-url').value.trim();if(!url)throw new Error('Enter the WebSocket address of your multiplayer server. See README for setup.');
 if(location.protocol==='https:'&&!url.startsWith('wss://'))throw new Error('This HTTPS page requires a secure wss:// multiplayer address.');
 if(net&&net.url===new URL(url).href&&net.status==='connected')return net;
 net?.disconnect();net=new NetworkClient({onRoom:roomUpdate,onState:(next,meta)=>{state=next;online=true;team=net.team;if(meta.matchId!==lastMatchId){lastMatchId=meta.matchId;enterMatch();}else if(mode!=='match')enterMatch();},onStatus:status=>{$('online-status').textContent=status==='connecting'?'Connecting to the match server…':status==='reconnecting'?'Reconnecting… your slot is reserved for 20 seconds.':status==='disconnected'?'Disconnected. Check the server address and connection.':status;if(status==='reconnecting'||status==='disconnected'){if(mode==='match')toast(status==='reconnecting'?'Connection interrupted. Reconnecting…':'Disconnected from the match server.');}},onError:message=>{$('online-error').textContent=message;if(mode==='match')toast(message);}});
 await net.connect(url);return net;
}
async function roomAction(action){$('online-error').textContent='';$('create-room').disabled=$('join-room').disabled=true;try{const client=await ensureNetwork();action(client);}catch(error){$('online-error').textContent=error.message;}finally{$('create-room').disabled=$('join-room').disabled=false;}}
$('create-room').onclick=()=>roomAction(client=>client.create({duration:Number($('online-duration').value),hostTeam:Number($('online-team').value),difficulty:'standard',tactics:['balanced','balanced']}));$('join-room').onclick=()=>roomAction(client=>client.join($('room-code').value));$('ready').onclick=()=>net?.ready(!roomReady);
for(const id of ['online-team','online-duration','online-tactic'])$(id).onchange=()=>{if(!net?.room)return;const tactics=[...net.room.settings.tactics];tactics[team]=$('online-tactic').value;net.settings({duration:Number($('online-duration').value),hostTeam:Number($('online-team').value),tactics});};
$('copy-room').onclick=async()=>{if(!net?.room)return;const url=new URL(location.href);url.search='';url.searchParams.set('room',net.room.code);url.searchParams.set('server',net.url);try{await navigator.clipboard.writeText(url.href);toast('Invite link copied. Send it to your opponent.');}catch{toast(`Room ${net.room.code} · server ${net.url}`);}};
function drawRadar(s){const ctx=$('radar').getContext('2d'),w=240,h=156;ctx.clearRect(0,0,w,h);const xy=p=>[10+(p.x+52.5)/105*220,7+(p.z+34)/68*142];ctx.strokeStyle='#d6e5da55';ctx.lineWidth=1;ctx.strokeRect(10,7,220,142);ctx.beginPath();ctx.moveTo(120,7);ctx.lineTo(120,149);ctx.stroke();ctx.beginPath();ctx.ellipse(120,78,19,19,0,0,Math.PI*2);ctx.stroke();for(const p of s.players){const [x,z]=xy(p);ctx.fillStyle=p.team===0?'#d9e9f3':'#f5ad58';ctx.beginPath();if(p.team===0)ctx.arc(x,z,2.6,0,Math.PI*2);else ctx.rect(x-2.5,z-2.5,5,5);ctx.fill();if(p.id===s.selected[team]){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,z,5,0,Math.PI*2);ctx.stroke();}}const [x,z]=xy(s.ball);ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,z,2,0,Math.PI*2);ctx.fill();}
function updateShotPower(s,actions={}){
 const p=s?.players[s.selected[team]],passing=!!p?.passType&&p.passCharge>0&&(p.passType==='through'?actions.throughHold:actions.passHold),shot=actions.shoot&&p?.charge>0,raw=passing?p.passCharge:p?.charge,charge=Number.isFinite(raw)?Math.max(0,Math.min(1,raw)):0;
 const charging=mode==='match'&&(s?.phase==='playing'||isManualRestart(s,team))&&!replay.active&&!paused&&!document.hidden&&$('loading').hidden&&(!practice||(practice.status.phase!=='feedback'&&!practice.status.releaseRequired))&&(!online||net?.status==='connected')&&!document.querySelector('dialog[open]')&&(passing||shot)&&s.ball.owner===p?.id&&charge>0;
 const power=charging?charge:0,percent=Math.round(power*100);
 $('charge-title').textContent=passing?(p.passType==='through'?'THROUGH BALL':'PASS POWER'):SHOT_NAMES[shotType(actions)];$('charge-hint').textContent=passing?'RELEASE TO PASS · MOVE TO AIM':shotType(actions)==='chip'?'RELEASE TO CHIP · LIFT OVER THE KEEPER':shotType(actions)==='finesse'?'RELEASE TO CURL · MOVE TO AIM':'RELEASE TO SHOOT · MOVE TO AIM';
 if(isManualRestart(s,team)){const throwing=s.restart.type==='throwIn';if(throwing)$('charge-title').textContent='THROW POWER';$('charge-hint').textContent='RELEASE TO '+(throwing?'THROW':passing?'PASS':'SHOOT')+' · MOVE TO AIM';}
 $('charge-wrap').hidden=!charging;$('charge-wrap').dataset.level=power>=.8?'high':power>=.45?'medium':'low';
 $('charge-fill').style.width=`${power*100}%`;$('charge-value').textContent=`${percent}%`;$('charge-meter').setAttribute('aria-valuenow',String(percent));
}
function updatePracticeHud(){if(!practice)return;const info=practice.status;$('practice-title').textContent=info.title;$('practice-objective').textContent=info.objective;$('practice-attempts').textContent=info.attempts;$('practice-successes').textContent=info.successes;$('practice-feedback').textContent=info.releaseRequired?'Release action buttons to begin the next attempt.':info.result||info.controls;$('practice-hud').dataset.phase=info.phase;$('practice-hud').dataset.result=info.resultCode||'';}
function updateHud(s){
 updatePracticeHud();
 const keeperContext=defendingPenalty(s,team),keeping=!!keeperContext&&!replay.active;
 document.body.classList.toggle('keeper-penalty',keeping);$('keeper-controls').hidden=!keeping;
 const k=s.penaltyKeeper,assisted=prefs.keeperAssist===true,waiting=practice?.drill==='keeperPenalties'&&practice.status.phase==='ready';
 $('keeper-status').textContent=waiting?'READY WHEN YOU ARE':assisted?'ASSISTED PENALTY SAVE':k?.committed?'DIVE COMMITTED':s.phase==='restart'?'CHOOSE YOUR SIDE · WATCH THE TAKER':'SHOT TAKEN · DIVE NOW';
 $('keeper-help').textContent=assisted?'The goalkeeper chooses and times the save.':device==='gamepad'?'STICK: SIDE / CENTRE · B / ○: DIVE · A / ✕: READY':device==='touch'?'Choose left, centre or right, then tap Dive at the strike.':'A / D: SIDE · W / S: CENTRE · SPACE: DIVE · J: READY';
 for(const [name,choice] of [['keeperLeft',-1],['keeperCentre',0],['keeperRight',1]]){const b=document.querySelector('[data-action='+name+']');b.setAttribute('aria-pressed',String((k?.choice??0)===choice));b.disabled=assisted||!!k?.committed;}
 document.querySelector('[data-action=keeperDive]').disabled=assisted||waiting||!!k?.committed;document.querySelector('[data-action=keeperReady]').hidden=!waiting;

 document.body.classList.toggle('penalty-view',!replay.active&&!!penaltyScene(s));
 const airborne=s.ball.owner===null&&s.ball.y>.32;document.body.classList.toggle('aerial-ball',airborne);const actor=s.players[s.selected[team]],nearAir=airborne&&Math.hypot(actor.x-s.ball.x,actor.z-s.ball.z)<5; $('aerial-hint').hidden=!nearAir||s.phase!=='playing';$('aerial-hint').textContent=actor.aerial?'TIMING WINDOW · '+actor.aerial.kind.toUpperCase():'TAP SHOOT TO '+(s.ball.y>1.45?'HEAD':'VOLLEY')+' · CLEAR TO DEFEND';document.querySelector('[data-action=lob]').textContent=airborne?'Clear':'Loft';const possessor=s.players[s.ball.owner??s.ball.lastTouch];const defending=!isManualRestart(s,team)&&!!possessor&&possessor.team!==team;document.body.classList.toggle('defending',defending);document.querySelector('[data-action=pass]').textContent=defending?'Tackle':visualInput.jockey&&!isManualRestart(s,team)&&s.ball.owner===actor.id?'1–2':'Pass';document.querySelector('[data-action=shoot]').textContent=defending&&!airborne?'Switch':airborne?(s.ball.y>1.45?'Head':'Volley'):'Shoot';if(defending)document.querySelector('[data-action=lob]').textContent='Clear';
 if(isManualRestart(s,team)&&s.restart.type==='throwIn'){document.querySelector('[data-action=pass]').textContent='Throw';document.querySelector('[data-action=shoot]').textContent='Long throw';document.querySelector('[data-action=lob]').textContent='Loft throw';}
 $('score').textContent=`${s.score[0]} – ${s.score[1]}`;$('clock').textContent=getMatchClock(s);$('half').textContent=s.half===1?'1ST HALF':'2ND HALF';$('match-network').textContent=online?net.status==='connected'?`${Math.round(net.latency)} MS`:net.status.toUpperCase():'OFFLINE';
 const p=s.players[s.selected[team]];if(p){$('player-name').textContent=p.name;$('player-role').textContent=`${String(p.number).padStart(2,'0')} / ${p.role} · ${p.skill?SKILLS[p.skill.kind].name:p.skillCooldown>0?'SKILL RECOVERING':p.possessionBurst>0?'BURST +30%':p.firstTime?'FIRST-TIME READY':s.runs?.[team]?.receiver===p.id?'ONE-TWO · RETURN PASS':p.shielding?'SHIELDING':TEAMS[team].abbr}`;$('stamina-fill').style.width=`${p.stamina*100}%`;}
 document.querySelector('[data-action=jockey]').textContent=s.ball.owner===p?.id?(p.shielding?'Shielding':'Control'):'Jockey';
 const show=!practice&&!replay.active&&['kickoff','halftime','goal','restart'].includes(s.phase);$('match-banner').hidden=!show;
 const explained=s.phase==='restart'&&!!s.restart?.reason&&['foul','offside'].includes(s.restart.reasonCode);
 if(show){$('banner-top').textContent=s.phase==='goal'?'MERIDIAN GROUND ERUPTS':s.phase==='halftime'?'A MOMENT TO REGROUP':'EXHIBITION FOOTBALL';$('banner-title').textContent=s.phase==='kickoff'?'KICK-OFF':s.phase==='halftime'?'HALF-TIME':s.phase==='goal'?'GOAL!':s.restart?.reasonCode==='offside'?'OFFSIDE':({throwIn:'THROW-IN',goalKick:'GOAL KICK',corner:'CORNER',freeKick:'FREE KICK',penalty:'PENALTY'})[s.restart?.type]||'RESTART';$('banner-bottom').textContent=s.phase==='halftime'?'Teams change ends for the second half':s.phase==='kickoff'?`${TEAMS[team].name} · ${team===(s.half===1?0:1)?'attacking right':'attacking left'}`:explained?'':s.restart?.reason||s.event?.text||'';
  // Foul and offside explanations get their own line so restart aiming help never replaces them.
  if(explained&&s.restart.reasonCode==='foul')$('banner-title').textContent+=` — ${s.restart.team===team?'YOUR BALL':`${TEAMS[s.restart.team].abbr} BALL`}`;}
 $('banner-reason').hidden=!show||!explained;$('banner-reason').textContent=show&&explained?s.restart.reason:'';
 document.body.classList.toggle('manual-restart',isManualRestart(s,team));
 document.body.classList.toggle('manual-penalty',isManualRestart(s,team)&&s.restart.type==='penalty');
 if(isManualRestart(s,team)){$('banner-top').textContent=s.phaseTime<2?'GETTING READY':s.restart.armed?'YOUR BALL · TAKE YOUR TIME':'RELEASE ACTION BUTTONS TO BEGIN';$('banner-bottom').textContent=s.restart.type==='penalty'?(device==='keyboard'?'WASD / ARROWS: AIM · HOLD & RELEASE SPACE':device==='gamepad'?'LEFT STICK: AIM · HOLD & RELEASE B':'STICK: AIM · HOLD & RELEASE SHOOT'):s.restart.type==='throwIn'?'MOVE / STICK TO AIM · HOLD & RELEASE PASS OR SHOOT TO THROW':'MOVE / STICK TO AIM · HOLD & RELEASE PASS OR SHOOT · LOFT TO CROSS';}
 else if(s.phase==='restart'&&s.restart?.type==='penalty'){$('banner-top').textContent='OPPONENT PENALTY';$('banner-bottom').textContent='Choose your save direction below, then time the dive';}
 drawRadar(s);if(!practice&&s.phase==='fulltime'&&!resultShown)showResults();
 if(DEBUG){$('debug').hidden=false;const r=renderer.stats();$('debug').textContent=`DEV · F2 overlay / AI ${query.has('autoplay')?'on':'off'}\n${Math.round(r.fps)} fps · ${r.frameMs?.toFixed(1)} ms · ${r.drawCalls} draws\n${online?'server':'local'} tick ${s.tick} · ${online?Math.round(net.latency):0} ms RTT\nBall ${s.ball.state} · owner ${s.ball.owner??'none'}\n${s.phase} · controlled ${s.selected[team]}\n${r.width} × ${r.height} · ${prefs.quality}`;}
}
function updateReplayHud(){
 const active=replay.active;$('goal-replay').hidden=!active;document.body.classList.toggle('replaying',active);
 $('replay-progress').style.width=`${replay.progress*100}%`;
 if(active)$('replay-team').textContent=TEAMS[replay.scoringTeam]?.name||'';
}
function clearReplayInput(){input.clear({preserveGamepad:true});Object.assign(pendingActions,neutralInput());visualInput=neutralInput();if(online)net?.input({...neutralInput(),cancelCharge:true});}
function skipReplay(){if(!replay.active)return false;replay.skip();clearReplayInput();updateReplayHud();return true;}
$('skip-replay').onclick=skipReplay;
let debugShapes=false;window.addEventListener('keydown',e=>{if(replay.active&&!e.repeat&&['Enter','Space'].includes(e.code)){e.preventDefault();skipReplay();}if(DEBUG&&e.code==='F2'){e.preventDefault();debugShapes=!debugShapes;}});
const pendingActions=neutralInput();
let visualInput=neutralInput();
let replaySkipButtonDown=false;
function frame(now){const rawFrameSeconds=(now-lastFrame)/1000;const dt=Math.min(.1,Math.max(0,rawFrameSeconds));lastFrame=now;let renderState=attract;
 if(mode==='quit'||mode==='home'){sound.update(null,{hidden:document.hidden});requestAnimationFrame(frame);return;}
 if(mode==='match'&&state){
  const wasReplaying=replay.active,sampled=input.sample(dt),skipButton=sampled.shoot||sampled.passHold||sampled.pass,skipPressed=skipButton&&!replaySkipButtonDown;
  replaySkipButtonDown=skipButton;
  if(wasReplaying&&device==='gamepad'&&skipPressed)skipReplay();
  const actions=wasReplaying?neutralInput():renderer.prepareInput({...sampled,shotAssist:prefs.shotAssist!==false,keeperAssist:prefs.keeperAssist===true},state,{dt,team,...prefs,menu:false});visualInput=actions;
  if(online){net.input(actions);renderState=net.sampleState()||state;}
  else{accumulator+=paused?0:dt;for(const k of ['pass','through','lob','strike','clear','tackle','slide','switch','oneTwo','ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','cancelCharge'])pendingActions[k]||=actions[k];let first=true;while(accumulator>=1/60){const inputs=[null,null];if(state.options.humans[team])inputs[team]={...actions,...Object.fromEntries(['pass','through','lob','strike','clear','tackle','slide','switch','oneTwo','ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','cancelCharge'].map(k=>[k,first&&pendingActions[k]]))};if(practice){const round=practice.status.round;state=practice.step(inputs[team],1/60);if(practice.status.round!==round){input.clear({preserveGamepad:true});Object.assign(pendingActions,neutralInput());visualInput=neutralInput();}}else stepMatch(state,inputs,1/60);if(first)for(const k of ['pass','through','lob','strike','clear','tackle','slide','switch','oneTwo','ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','cancelCharge'])pendingActions[k]=false;first=false;accumulator-=1/60;}renderState=state;}
  if(online&&net.status!=='connected')replay.skip();
  else if(!practice&&replay.record(state)){if(paused||document.hidden||document.querySelector('dialog[open]'))replay.skip();clearReplayInput();clearTimeout(toastTimer);$('toast').hidden=true;}
  const beforeUpdate=replay.active;replay.update(paused?0:dt);
  if(beforeUpdate&&!replay.active)clearReplayInput();
  renderState=replay.sample()||renderState;
  updateReplayHud();
  hudTime+=dt;if(hudTime>.08){updateHud(state);hudTime=0;}
 }else{accumulator+=dt;while(accumulator>=1/60){stepMatch(attract,[null,null],1/60);accumulator-=1/60;}if(attract.phase==='fulltime')attract=createMatch({humans:[false,false],duration:600});}
 updateShotPower(mode==='match'?state:null,visualInput);
 adaptiveOptions=adaptive.sample(rawFrameSeconds,{active:mode==='match'&&!paused&&!document.hidden&&!replay.active&&!document.querySelector('dialog[open]'),auto:prefs.autoQuality!==false,quality:prefs.quality,shadows:prefs.shadows});
 $('adaptive-status').textContent=prefs.autoQuality!==false?`Automatic: ${adaptiveOptions.quality} · ${Math.round(adaptiveOptions.resolutionScale*100)}% resolution`:'Automatic adjustment is off.';
 sound.update(state,{active:mode==='match',paused,hidden:document.hidden,menu:!!document.querySelector('dialog[open]'),camera:renderer.audioView()});
 renderer.render(renderState,{dt,team,...prefs,...adaptiveOptions,...(replay.active?{cameraMode:'telebroadcast',cameraHeight:.55,cameraZoom:.35}:{}),input:visualInput,replay:replay.active,guidesHidden:paused||document.hidden||!!document.querySelector('dialog[open]')||!!practice&&(practice.status.phase==='feedback'||practice.status.releaseRequired),debug:DEBUG&&debugShapes,menu:mode!=='match'});requestAnimationFrame(frame);
}
if(DEBUG)window.__T11={audio:sound,getState:()=>state,getAttract:()=>attract,stats:()=>({...renderer.stats(),adaptive:{...adaptiveOptions}}),touchLayout,feedPerformance:seconds=>adaptive.sample(seconds,{active:true,auto:prefs.autoQuality!==false,quality:prefs.quality,shadows:prefs.shadows}),getNetwork:()=>net,getPractice:()=>practice?.status??null,getReplay:()=>({active:replay.active,progress:replay.progress,scoringTeam:replay.scoringTeam,frameCount:replay.frameCount}),start:(options={})=>startOffline({...matchOptions(),...options}),startPractice,advance:seconds=>{if(!online&&state){for(let i=0;i<seconds*60;i++){if(practice)state=practice.step(neutralInput(),1/60);else stepMatch(state,[null,null],1/60);}updateHud(state);}},input,preferences:prefs};
if(query.has('room'))showScreen('online');
requestAnimationFrame(frame);
if(DEBUG&&query.get('autoplay')==='1')startOffline({humans:[false,false],duration:60,difficulty:'standard',tactics:['balanced','balanced']});
