import test from 'node:test';
import assert from 'node:assert/strict';
import {createPracticeSession, PRACTICE_DRILLS} from '../client/practice.js';
import {neutralInput, createMatch} from '../shared/simulation.js';
import {TEAMS} from '../shared/config.js';

function tick(session, frames, actions=neutralInput()) {for(let i=0;i<frames;i++)session.step(actions,1/60);}
function untilFeedback(session) {for(let i=0;i<1000&&session.status.phase!=='feedback';i++)session.step(neutralInput());assert.equal(session.status.phase,'feedback');}

test('practice builds an isolated full roster and preserves clubs and other matches',()=>{
  const clubs=JSON.stringify(TEAMS),match=createMatch(),before=JSON.stringify(match);
  const shooting=createPracticeSession(),slide=createPracticeSession({drill:'slide'});
  assert.equal(shooting.state.players.length,22);assert.equal(slide.state.players.length,22);
  assert.equal(shooting.state.phase,'playing');assert.equal(shooting.state.ball.owner,9);assert.equal(slide.state.ball.owner,20);
  assert.deepEqual(shooting.state.score,[0,0]);assert.equal(shooting.status.attempts,0);assert.equal(shooting.status.successes,0);
  assert.ok(PRACTICE_DRILLS.shooting.objective.includes('Hold Shoot'));
  tick(shooting,30,{...neutralInput(),shoot:true});tick(slide,20);
  assert.equal(JSON.stringify(TEAMS),clubs);assert.equal(JSON.stringify(match),before);
});

test('shooting counts actual releases and goals, not held charge or invented results',()=>{
  const session=createPracticeSession();
  // An open goal isolates scoring from goalkeeper tuning; the real input and
  // fixed-step shot, flight, goal-line crossing and score code remain unchanged.
  Object.assign(session.state.players[11],{x:-35,z:20});
  tick(session,25,{...neutralInput(),shoot:true});
  assert.ok(session.state.players[9].charge>0);assert.equal(session.status.attempts,0);assert.equal(session.state.stats.shots[0],0);
  session.step(neutralInput());assert.equal(session.status.attempts,1);assert.equal(session.state.stats.shots[0],1);
  untilFeedback(session);assert.equal(session.status.resultCode,'goal');assert.equal(session.status.successes,1);
  assert.equal(session.state.phase,'goal');assert.deepEqual(session.state.score,[1,0]);
  const tickAtFinish=session.state.tick;tick(session,20);
  assert.equal(session.state.tick,tickAtFinish);assert.equal(session.status.attempts,1);assert.equal(session.status.successes,1);
});

test('automatic setup preserves counters, clears prior score and requires a held action to release',()=>{
  const session=createPracticeSession();Object.assign(session.state.players[11],{x:-35,z:20});
  tick(session,20,{...neutralInput(),shoot:true});session.step(neutralInput());untilFeedback(session);
  const old=session.state;tick(session,82,{...neutralInput(),shoot:true});
  assert.equal(session.status.round,2);assert.notEqual(session.state,old);assert.equal(session.status.attempts,1);
  assert.deepEqual(session.state.score,[0,0]);assert.equal(session.state.stats.shots[0],0);assert.equal(session.status.releaseRequired,true);
  tick(session,80,{...neutralInput(),shoot:true});assert.equal(session.state.players[9].charge,0);assert.equal(session.status.attempts,1);
  session.step(neutralInput());tick(session,10,{...neutralInput(),shoot:true});assert.ok(session.state.players[9].charge>0);
});

test('timed sliding challenge records a real clean ball-first win',()=>{
  const session=createPracticeSession({drill:'slide'});tick(session,30);
  session.step({...neutralInput(),slide:true});assert.equal(session.status.attempts,1);
  untilFeedback(session);assert.equal(session.status.resultCode,'clean');assert.equal(session.status.successes,1);
  assert.equal(session.state.stats.tackles[0],1);assert.equal(session.state.stats.fouls[0],0);assert.equal(session.state.ball.lastTouch,9);
});

test('early slides miss and body-first slides fail with a genuine foul',()=>{
  const early=createPracticeSession({drill:'slide'});early.step({...neutralInput(),slide:true});untilFeedback(early);
  assert.equal(early.status.resultCode,'missed');assert.equal(early.status.successes,0);assert.equal(early.state.stats.tackles[0],0);
  const behind=createPracticeSession({drill:'slide'});Object.assign(behind.state.players[9],{x:18,z:0,facing:0});
  behind.step({...neutralInput(),slide:true,mx:1});untilFeedback(behind);
  assert.equal(behind.status.attempts,1);assert.equal(behind.status.resultCode,'foul');assert.equal(behind.status.successes,0);
  assert.equal(behind.state.stats.fouls[0],1);assert.equal(behind.state.restart.reasonCode,'foul');
});

test('restart clears drill counters and keeps the selected exercise without old action latches',()=>{
  const session=createPracticeSession({drill:'slide'});tick(session,30);session.step({...neutralInput(),slide:true});untilFeedback(session);
  const old=session.state;session.restart();assert.notEqual(session.state,old);
  assert.equal(session.drill,'slide');assert.equal(session.status.round,1);assert.equal(session.status.attempts,0);assert.equal(session.status.successes,0);
  assert.equal(session.state.players[9].slideTime,0);assert.equal(session.state.ball.owner,20);assert.equal(session.state.previous[0].slide,false);
});

test('idle and wrong-action resets do not fabricate attempts, goals or successes',()=>{
  const idle=createPracticeSession({drill:'slide'});untilFeedback(idle);
  assert.equal(idle.status.attempts,0);assert.equal(idle.status.successes,0);assert.deepEqual(idle.state.score,[0,0]);
  const wrong=createPracticeSession();wrong.step({...neutralInput(),pass:true});
  assert.equal(wrong.status.resultCode,'instruction');assert.equal(wrong.status.attempts,0);assert.equal(wrong.status.successes,0);
  assert.equal(wrong.state.stats.passes[0],1);assert.equal(wrong.state.stats.shots[0],0);
});

test('practice keeps its training actor selected and ignores invalid elapsed time',()=>{
  const session=createPracticeSession(),before=JSON.stringify(session.state);
  for(const dt of [0,-1,NaN,Infinity])session.step({...neutralInput(),shoot:true},dt);
  assert.equal(JSON.stringify(session.state),before);
  session.step({...neutralInput(),switch:true});assert.equal(session.state.selected[0],9);
  assert.throws(()=>createPracticeSession({drill:'career'}),/shooting, penalties or slide/);
});
