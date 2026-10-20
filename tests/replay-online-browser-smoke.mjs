import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createGameServer} from '../server/index.js';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = resolve(process.env.QA_OUTPUT || 'qa-output');
await mkdir(out, {recursive: true});
const service = createGameServer({port: 0});
const address = await service.listen(), origin = `http://127.0.0.1:${address.port}`;
const checks = [], errors = [], contexts = [];
let browser, host, guest, controllerPage;
const mark = (name, data = {}) => {checks.push({name, status: 'passed', ...data}); console.log('PASS ' + name);};

async function report(failure) {
  const result = {testedAt: new Date().toISOString(), browser: browser?.version(), checks, errors,
    ...(failure ? {failure: String(failure.stack || failure)} : {})};
  await writeFile(resolve(out, 'replay-online-browser-report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

async function newPage(label) {
  const context = await browser.newContext({viewport: {width: 1100, height: 720}});
  contexts.push(context);
  await context.addInitScript(() => {
    localStorage.setItem('t11.preferences', JSON.stringify({quality: 'low', shadows: false, cameraMode: 'broadcast', master: 0}));
  });
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  await page.goto(origin + '/?debug=1'); await page.waitForFunction(() => window.__T11);
  return page;
}

async function watchReplay(page) {
  await page.evaluate(() => {
    window.__replayQA = {started: false, ended: false, lastActive: false, unsafePlayableFrames: 0, log: []};
    const watch = () => {
      const state = __T11.getState(), replay = __T11.getReplay(), qa = __replayQA;
      if (state) {
        if (replay.active) qa.started = true;
        if (qa.lastActive && !replay.active) {qa.ended = true; qa.endPhase = state.phase; qa.endTick = state.tick;}
        if (replay.active && state.phase !== 'goal') qa.unsafePlayableFrames++;
        qa.lastActive = replay.active;
        qa.log.push({tick: state.tick, phase: state.phase, active: replay.active, progress: replay.progress, score: [...state.score]});
        if (qa.log.length > 600) qa.log.shift();
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
}

// Only the precondition is arranged. Normal fixed-step goal detection, score
// changes, snapshots, browser replay detection and skipping remain unmodified.
function placeGoalAttempt(state) {
  Object.assign(state, {phase: 'playing', phaseTime: 0, restart: null, offside: null,
    receiver: [null, null], pendingSwitch: [null, null], passFrom: null, passTeam: null, ballFlightTime: 1});
  for (const player of state.players) {
    Object.assign(player, {x: -25 + player.slot * 2, z: player.team === 0 ? -22 : 22,
      vx: 0, vz: 0, cooldown: 5, actionTime: 0, actionDuration: 0, charge: 0,
      receiveTime: 0, touchTime: 0, slideTime: 0, anim: 'idle'});
  }
  Object.assign(state.ball, {x: 52, y: .45, z: 0, vx: 36, vy: 0, vz: 0,
    owner: null, lastTouch: 9, state: 'free'});
}

async function afterFrames(page, count = 2) {
  await page.evaluate(count => new Promise(resolve => {
    const step = () => --count <= 0 ? resolve() : requestAnimationFrame(step);
    requestAnimationFrame(step);
  }), count);
}

async function collectHistory(page) {
  await page.waitForFunction(() => __T11.getState()?.phase === 'playing' && __T11.getReplay().frameCount >= 2);
  const tick = await page.evaluate(() => __T11.getState().tick);
  await page.waitForFunction(tick => __T11.getState().tick >= tick + 180 && __T11.getReplay().frameCount >= 2, tick);
}

async function freezeReplayEndpoint(page) {
  await page.evaluate(() => {
    const original = requestAnimationFrame, queued = [];
    window.__replayCapture = null;
    window.requestAnimationFrame = callback => {
      const replay = __T11.getReplay();
      if (!__replayCapture && replay.active && replay.progress >= .955) {
        __replayCapture = {progress: replay.progress, camera: __T11.stats(), score: [...__T11.getState().score]};
      }
      if (__replayCapture) {queued.push(callback); return 0;}
      return original(callback);
    };
    window.__resumeReplayCapture = () => {window.requestAnimationFrame = original; queued.splice(0).forEach(callback => original(callback));};
  });
  await page.waitForFunction(() => window.__replayCapture !== null, null, {polling: 25});
}

try {
  browser = await chromium.launch({headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {}),
    args: ['--enable-unsafe-swiftshader']});
  host = await newPage('host'); guest = await newPage('guest');
  await host.locator('#play-online').click();
  await host.locator('#server-url').fill(origin.replace('http', 'ws') + '/ws');
  await host.locator('#create-room').click(); await host.waitForFunction(() => __T11.getNetwork()?.room);
  const code = await host.evaluate(() => __T11.getNetwork().room.code);
  await guest.locator('#play-online').click();
  await guest.locator('#server-url').fill(origin.replace('http', 'ws') + '/ws');
  await guest.locator('#room-code').fill(code); await guest.locator('#join-room').click();
  await guest.waitForFunction(() => __T11.getNetwork()?.room);
  await host.locator('#ready').click(); await guest.locator('#ready').click();
  await Promise.all([host, guest].map(collectHistory));
  await Promise.all([host, guest].map(watchReplay));
  const room = service.rooms.get(code), scoreBefore = [...room.state.score];
  placeGoalAttempt(room.state);
  await Promise.all([host, guest].map(page => page.waitForFunction(() => __T11.getReplay().active)));
  const expectedScore = [scoreBefore[0] + 1, scoreBefore[1]];
  assert.deepEqual(room.state.score, expectedScore);
  const atStart = await Promise.all([host, guest].map(page => page.evaluate(() => ({
    score: [...__T11.getState().score], replay: __T11.getReplay(), camera: __T11.stats().cameraMode
  }))));
  for (const state of atStart) {
    assert.deepEqual(state.score, expectedScore); assert.equal(state.replay.active, true);
    assert.equal(state.replay.scoringTeam, 0); assert.equal(state.camera, 'telebroadcast');
  }
  mark('Two isolated online clients automatically replay the same authoritative goal', {code, score: expectedScore});

  const authorityTick = room.state.tick, goalEvent = room.state.event.id;
  await host.locator('#skip-replay').click();
  await host.waitForFunction(() => !__T11.getReplay().active);
  assert.equal(await guest.evaluate(() => __T11.getReplay().active), true, 'one player skipping must not skip the other player');
  assert.deepEqual(room.state.score, expectedScore); assert.equal(room.state.event.id, goalEvent);
  await host.waitForTimeout(120);
  assert.ok(room.state.tick > authorityTick, 'replay/skip cannot stop server ticks');
  assert.equal(room.state.phase, 'goal');
  assert.deepEqual(await host.evaluate(() => __T11.getState().score), expectedScore);
  assert.deepEqual(await guest.evaluate(() => __T11.getState().score), expectedScore);
  mark('Skipping is local while server ticks and the authoritative score remain intact', {tickBefore: authorityTick, tickAfter: room.state.tick});

  await Promise.all([host, guest].map(page => page.waitForFunction(() => __replayQA.started && __replayQA.ended && __T11.getState().phase === 'playing')));
  const observations = await Promise.all([host, guest].map(page => page.evaluate(() => ({
    unsafePlayableFrames: __replayQA.unsafePlayableFrames, endPhase: __replayQA.endPhase,
    active: __T11.getReplay().active, score: [...__T11.getState().score]
  }))));
  for (const observation of observations) {
    assert.equal(observation.unsafePlayableFrames, 0);
    assert.ok(['goal', 'kickoff'].includes(observation.endPhase), 'replay ends before the next playable phase');
    assert.equal(observation.active, false); assert.deepEqual(observation.score, expectedScore);
  }
  mark('Both online replays end before playable kick-off without hiding live play', {observations});
  await host.screenshot({path: resolve(out, 'online-replay-return.png')});
  // Close the two online rendering contexts before the independent input case.
  await host.context().close(); await guest.context().close();

  controllerPage = await newPage('controller');
  await controllerPage.evaluate(() => {
    window.__replayPad = {id: 'Replay regression standard pad', index: 0, connected: true, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({length: 17}, () => ({pressed: false, value: 0}))};
    Object.defineProperty(navigator, 'getGamepads', {configurable: true, value: () => [__replayPad]});
    const event = new Event('gamepadconnected'); event.gamepad = __replayPad; window.dispatchEvent(event);
  });
  for (const [button, name] of [[1, 'B / Circle'], [0, 'A / Cross']]) {
    await controllerPage.evaluate(() => {
      for (const button of __replayPad.buttons) {button.pressed = false; button.value = 0;}
      __T11.start({duration: 60, humans: [true, false]});
    });
    await collectHistory(controllerPage);
    await controllerPage.evaluate(button => {__replayPad.buttons[button] = {pressed: true, value: 1};}, button);
    await afterFrames(controllerPage, 3);
    // Arrange the same goal precondition without replacing input, replay or simulation methods.
    await controllerPage.evaluate(() => {
      const state = __T11.getState();
      Object.assign(state, {phase: 'playing', phaseTime: 0, restart: null, offside: null,
        receiver: [null, null], pendingSwitch: [null, null], passFrom: null, passTeam: null, ballFlightTime: 1});
      for (const player of state.players) Object.assign(player, {x: -25 + player.slot * 2,
        z: player.team === 0 ? -22 : 22, vx: 0, vz: 0, cooldown: 5, actionTime: 0, actionDuration: 0,
        charge: 0, receiveTime: 0, touchTime: 0, slideTime: 0, anim: 'idle'});
      Object.assign(state.ball, {x: 52, y: .45, z: 0, vx: 36, vy: 0, vz: 0, owner: null, lastTouch: 9, state: 'free'});
    });
    await controllerPage.waitForFunction(() => __T11.getReplay().active);
    await controllerPage.waitForTimeout(300);
    const held = await controllerPage.evaluate(() => ({replay: __T11.getReplay(), score: [...__T11.getState().score]}));
    assert.equal(held.replay.active, true, `holding ${name} before the goal must not skip the replay`);
    assert.ok(held.replay.progress < .8, 'fresh input must be tested before the natural replay end');
    await controllerPage.evaluate(button => {__replayPad.buttons[button] = {pressed: false, value: 0};}, button);
    await afterFrames(controllerPage, 3);
    await controllerPage.evaluate(button => {__replayPad.buttons[button] = {pressed: true, value: 1};}, button);
    await controllerPage.waitForFunction(() => !__T11.getReplay().active, null, {timeout: 1000});
    const skipped = await controllerPage.evaluate(() => ({phase: __T11.getState().phase, score: [...__T11.getState().score]}));
    assert.equal(skipped.phase, 'goal'); assert.deepEqual(skipped.score, held.score);
    await controllerPage.evaluate(button => {__replayPad.buttons[button] = {pressed: false, value: 0};}, button);
    mark(`Emulated held ${name} survives the goal transition; release and fresh press skips`, {progressBeforeFreshPress: held.replay.progress, score: skipped.score});
  }
  // Capture the actual recorded goal endpoint in a separate offline replay, so
  // screenshot timing cannot interfere with the live online lifecycle assertions.
  await controllerPage.evaluate(() => __T11.start({duration: 60, humans: [true, false]}));
  await collectHistory(controllerPage);
  await controllerPage.evaluate(() => {
    const state = __T11.getState();
    state.phase = 'playing'; state.phaseTime = 0; state.restart = null;
    state.offside = null; state.passFrom = state.passTeam = null; state.receiver = [null, null]; state.ballFlightTime = 1;
    for (const player of state.players) {player.x = -25 + player.slot * 2; player.z = player.team === 0 ? -22 : 22; player.cooldown = 5;}
    Object.assign(state.ball, {x: 52, y: .45, z: 0, vx: 36, vy: 0, vz: 0, owner: null, lastTouch: 9, state: 'free'});
  });
  await controllerPage.waitForFunction(() => __T11.getReplay().active);
  await freezeReplayEndpoint(controllerPage);
  await controllerPage.screenshot({path: resolve(out, 'goal-replay-endpoint.png')});
  const capture = await controllerPage.evaluate(() => __replayCapture);
  assert.equal(capture.camera.cameraMode, 'telebroadcast'); assert.ok(capture.progress >= .955 && capture.progress < 1);
  await controllerPage.evaluate(() => __resumeReplayCapture());
  mark('Goal endpoint captured for goal-mouth framing review', {progress: capture.progress, cameraPosition: capture.camera.cameraPosition, cameraTarget: capture.camera.cameraTarget});
  assert.deepEqual(errors, []); mark('No browser JavaScript exceptions');
  await report();
} catch (error) {
  for (const [name, page] of [['host', host], ['guest', guest], ['controller', controllerPage]]) {
    if (page && !page.isClosed()) await page.screenshot({path: resolve(out, `replay-online-failure-${name}.png`)}).catch(() => {});
  }
  await report(error); throw error;
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close(); await service.close();
}
