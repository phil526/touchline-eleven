import {createKeeperPractice} from './keeper-practice.js';
import {shotFeedback,finishShot} from '../shared/shot-log.js';
import {createMatch, stepMatch, neutralInput} from '../shared/simulation.js';

export const PRACTICE_DRILLS = Object.freeze({
  shooting: Object.freeze({title: 'Shooting & aim', objective: 'Beat the goalkeeper. Hold Shoot, aim, then release. Try a finesse shot into a corner or a chip over the keeper.',
    controls: 'Shoot: SPACE / B / Circle. Finesse: Z / RB / R1 + Shoot. Chip: X / LT / L2 + Shoot. Touch: select a shot, then hold Shoot.'}),
  penalties: Object.freeze({title: 'Penalty Practice', objective: 'Move the target left/right and up/down. Hold Shoot for power, then release to beat the goalkeeper.',
    controls: 'Aim: WASD / arrows or stick. Hold and release Shoot (SPACE / B / Circle).'}),
  keeperPenalties:Object.freeze({title:'Penalty saves',objective:'Choose left, centre or right. Press Ready, watch the taker, then time your dive as the shot is struck.',controls:'A/D or stick: side · W/S: centre · SPACE / B / Circle: dive · J / A / Cross: ready. Assistance is optional in Settings.'}),
  slide: Object.freeze({title: 'Slide tackle timing', objective: 'Win the ball before the player. Wait for the carrier to approach, then slide towards the ball.',
    controls: 'F / X / Square while defending / Slide · An early slide can miss; contact from behind can foul.'})
});

const actionHeld = input => ['shoot', 'passHold', 'throughHold', 'pass', 'through', 'lob', 'tackle', 'slide', 'oneTwo'].some(key => input?.[key] === true);

/** A private offline drill state; all shots/challenges still use stepMatch. */
export function createPracticeSession({drill = 'shooting', seed = 4242} = {}) {
  if (!Object.hasOwn(PRACTICE_DRILLS, drill)) throw new Error('Choose a shooting, penalties or slide drill.');
  if(drill==='keeperPenalties')return createKeeperPractice({seed,info:PRACTICE_DRILLS[drill]});
  const shootingDrill=drill!=='slide';
  let history=[];
  let state, round = 0, attempts = 0, successes = 0, phase = 'ready', result = '', resultCode = null;
  let roundTime = 0, attemptTime = 0, feedbackTime = 0, releaseRequired = false;
  const shooter = 9, carrier = 20, keeper = 11;

  function parkOthers() {
    const active = shootingDrill ? [shooter, keeper] : [shooter, carrier];
    for (const player of state.players) if (!active.includes(player.id)) {
      Object.assign(player, {x: -45 + player.slot * 1.5, z: player.team ? 30 : -30,
        vx: 0, vz: 0, cooldown: 10, actionTime: 0, charge: 0, passCharge: 0, passType: null,
        slideTime: 0, receiveTime: 0, aiTime: 10, anim: 'idle'});
    }
  }
  function nextRound(requireRelease = false) {
    if(state)history.push(...state.shotLog.map(q=>({...q,id:(round-1)*10000+q.id})));history=history.slice(-500);
    round++;
    state = createMatch({duration: 3600, humans: [true, true], difficulty: 'standard', seed: seed + round});
    Object.assign(state, {phase: 'playing', phaseTime: 0, time: 0, selected: [shooter, carrier],
      restart: null, offside: null, receiver: [null, null], pendingSwitch: [null, null], ballFlightTime: 1});
    parkOthers();
    if(drill==='penalties'){
      Object.assign(state,{phase:'restart',phaseTime:2.1,restart:{type:'penalty',team:0,taker:shooter,x:41.5,z:0,aimGoalZ:0,aimGoalY:.95}});
      Object.assign(state.players[shooter],{x:40.85,z:0,facing:0,cooldown:0});
      Object.assign(state.players[keeper],{x:52.2,z:0,facing:Math.PI,cooldown:0});
      Object.assign(state.ball,{x:41.5,y:.11,z:0,vx:0,vy:0,vz:0,owner:null,lastTouch:shooter,state:'dead'});
    } else if (drill === 'shooting') {
      const z = [0, -4, 4][(round - 1) % 3];
      Object.assign(state.players[shooter], {x: 33, z, facing: Math.atan2(-z, 19.5), cooldown: 0});
      Object.assign(state.players[keeper], {x: 49, z: 0, facing: Math.PI, cooldown: 0});
      Object.assign(state.ball, {x: 33.6, y: .11, z, vx: 0, vy: 0, vz: 0, owner: shooter, lastTouch: shooter, state: 'controlled'});
    } else {
      Object.assign(state.players[shooter], {x: 26, z: 0, facing: Math.PI, cooldown: 0});
      Object.assign(state.players[carrier], {x: 20, z: 0, facing: 0, cooldown: 10});
      Object.assign(state.ball, {x: 20.7, y: .11, z: 0, vx: 0, vy: 0, vz: 0, owner: carrier, lastTouch: carrier, state: 'controlled'});
    }
    phase = 'ready'; result = ''; resultCode = null;
    roundTime = attemptTime = feedbackTime = 0; releaseRequired = requireRelease;
    return state;
  }
  function finish(success, code, message) {
    if (phase === 'feedback') return;
    if (success) successes++;
    if(shootingDrill&&['goal','saved','missed'].includes(code)){if(code==='missed')finishShot(state,'missed');message=shotFeedback(state.shotLog.at(-1));}
    phase = 'feedback'; resultCode = code; result = message; feedbackTime = 0;
  }
  function step(input = neutralInput(), dt = 1 / 60) {
    if (!Number.isFinite(dt) || dt <= 0) return state;
    dt = Math.min(.05, dt);
    if (phase === 'feedback') {
      feedbackTime += dt;
      // Let the saved ball and keeper's landing/hold finish on screen. Inputs
      // stay neutral and the completed attempt cannot award extra counters.
      if(resultCode==='saved'&&feedbackTime<1.25){stepMatch(state,[neutralInput(),neutralInput()],dt);parkOthers();state.selected=[shooter,carrier];}
      if (feedbackTime >= 1.35) nextRound(true);
      return state;
    }
    const actions = {...neutralInput(), ...input, switch: false};
    if (releaseRequired) {
      if (actionHeld(input)) return state;
      releaseRequired = false;
    }
    roundTime += dt;
    parkOthers();
    state.selected = [shooter, carrier];
    const shotsBefore = state.stats.shots[0], passesBefore = state.stats.passes[0];
    const actor=state.players[shooter],startsSlide=actions.slide===true&&!state.previous[0].slide&&actor.cooldown<=dt&&actor.actionTime<=dt&&state.ball.owner!==shooter;
    const opponent = drill === 'slide' ? {...neutralInput(), mx: .48} : neutralInput();
    stepMatch(state, [actions, opponent], dt);
    parkOthers();
    state.selected = [shooter, carrier];
    const player = state.players[shooter];
    if (phase === 'ready' && (shootingDrill ? state.stats.shots[0] > shotsBefore : startsSlide && (player.anim === 'slide' || state.stats.fouls[0] > 0 || state.stats.tackles[0] > 0))) {
      attempts++; phase = 'action'; attemptTime = 0;
    }
    if (phase === 'action') {
      attemptTime += dt;
      if (shootingDrill) {
        if (state.score[0] > 0) finish(true, 'goal', drill==='penalties'?'Penalty scored. Pick another corner on your next kick.':'Goal. Good finish — try the next angle.');
        else if (state.ball.owner === keeper||state.stats.saves[1]>0) finish(false, 'saved', 'Saved. Aim away from the keeper and vary your power.');
        else if (state.phase === 'restart') finish(false, 'missed', 'Off target. Use the aiming guide and a controlled release.');
        else if (attemptTime >= 4.5 || (attemptTime > .6 && state.ball.owner === shooter)) finish(false, 'missed', 'Shot complete. Try a different corner or power.');
      } else {
        if (state.stats.fouls[0] > 0) finish(false, 'foul', 'Foul — player before ball. Approach from the front or side.');
        else if (state.stats.tackles[0] > 0 && state.ball.lastTouch === shooter) finish(true, 'clean', 'Clean challenge. You reached the ball first.');
        else if (player.actionTime <= 0 || attemptTime > 1.1) finish(false, 'missed', 'Missed. Let the carrier come closer, then aim your slide.');
      }
    } else if (shootingDrill && state.stats.passes[0] > passesBefore) finish(false, 'instruction', 'Use Shoot for this drill. Hold to build power, then release.');
    else if (drill === 'slide' && state.stats.tackles[0] > 0) finish(false, 'instruction', 'That was a standing tackle. Try F / X / Square / Slide.');
    else if (drill!=='penalties'&&(state.phase !== 'playing' || roundTime > 15 || (drill === 'slide' && state.players[carrier].x > player.x + 2.5))) finish(false, 'reset', 'A fresh setup is coming. Use the objective above for your next try.');
    return state;
  }
  function restart() {state=null;history=[];attempts = successes = round = 0; return nextRound(true);}
  nextRound();
  return {step, restart, drill,
    get state() {return state;},
    get shots(){return [...history,...state.shotLog.map(q=>({...q,id:(round-1)*10000+q.id}))];},
    get status() {return {drill, ...PRACTICE_DRILLS[drill], round, attempts, successes, phase, result, resultCode, releaseRequired};}
  };
}
