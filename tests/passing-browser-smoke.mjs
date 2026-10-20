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
let browser, page, activePage;
const mark = (name, data = {}) => {checks.push({name, status: 'passed', ...data}); console.log('PASS ' + name);};

async function newPage(mobile = false) {
  const context = await browser.newContext(mobile ? {viewport: {width: 844, height: 390}, isMobile: true, hasTouch: true} : {viewport: {width: 1280, height: 800}});
  contexts.push(context);
  await context.addInitScript(() => {
    localStorage.setItem('t11.preferences', JSON.stringify({quality: 'low', shadows: false, cameraMode: 'broadcast', master: 0}));
  });
  const target = await context.newPage(); target.setDefaultTimeout(15_000);
  target.on('pageerror', error => errors.push(error.message));
  await target.goto(origin + '/?debug=1'); await target.waitForFunction(() => window.__T11);
  await target.evaluate(() => __T11.start({duration: 360, humans: [true, false]}));
  await target.waitForFunction(() => __T11.getState()?.phase === 'playing');
  return {target, context};
}

// Only establish possession and clear prior action state. Every charge / release
// below comes from keyboard events, navigator.getGamepads, or real touch events.
async function fixture(target) {
  await target.evaluate(() => {
    if (window.__passingPad) for (const button of __passingPad.buttons) {button.pressed = false; button.value = 0;}
    __T11.input.clear();
    const s = __T11.getState();
    Object.assign(s, {phase: 'playing', phaseTime: 0, time: 10, half: 1, restart: null, offside: null,
      passFrom: null, passTeam: null, ballFlightTime: 0, receiver: [null, null], pendingSwitch: [null, null], passHoldLatch: [false, false], selected: [1, 20]});
    s.stats.passes = [0, 0]; s.stats.completedPasses = [0, 0];
    s.previous = [0, 1].map(() => ({mx: 0, mz: 0, pass: false, through: false, passHold: false, throughHold: false, shoot: false, slide: false}));
    for (const p of s.players) Object.assign(p, {x: -38 + p.slot * 2, z: p.team === 0 ? -27 : 27,
      vx: 0, vz: 0, cooldown: 100, aiTime: 100, charge: 0, shotLatch: false, passCharge: 0, passType: null, passLatch: false,
      actionTime: 0, actionDuration: 0, slideTime: 0, slideHit: false, anim: 'idle', touchTime: 0, receiveTime: 0, stamina: 1});
    const p = s.players[1]; Object.assign(p, {x: -8, z: 0, facing: 0, cooldown: 0}); p.attrs.passing = 100;
    Object.assign(s.players[8], {x: 9, z: -5}); Object.assign(s.players[9], {x: 25, z: 7});
    Object.assign(s.ball, {x: -7.45, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0, owner: p.id, lastTouch: p.id, state: 'controlled'});
  });
  await target.waitForFunction(() => !document.body.classList.contains('defending') && __T11.stats().passTargetId !== null);
}

async function armChargeCapture(target, kind, {minimum = 0.12, rise = 0} = {}) {
  await target.evaluate(({kind, minimum, rise}) => {
    if (window.__passingResume) throw new Error('The previous captured frame has not resumed');
    const original = window.requestAnimationFrame;
    let early = null; window.__passingCapture = null;
    window.requestAnimationFrame = callback => {
      // main.js schedules its named frame only after simulation, HUD and renderer
      // have finished. Capture there, before another frame or host round trip can
      // cross the .75s auto-release cap. Other RAF users (including test polling)
      // must keep their own callbacks and cannot become the resumed game loop.
      if (callback.name === 'frame') {
        const s = __T11.getState(), p = s?.players[s.selected[0]], meter = document.getElementById('charge-wrap');
        if (s?.phase === 'playing' && s.ball.owner === p?.id && p.passType === kind && p.passCharge >= 0.08 && !meter.hidden) {
          const sample = {charge: p.passCharge, title: document.getElementById('charge-title').textContent,
            percent: Number(document.getElementById('charge-meter').getAttribute('aria-valuenow')), receiver: __T11.stats().passTargetId};
          early ||= sample;
          if (p.passCharge >= Math.max(minimum, early.charge + rise)) {
            window.__passingCapture = {early, later: sample, owner: s.ball.owner, passes: s.stats.passes[0]};
            window.__passingResume = () => {window.requestAnimationFrame = original; delete window.__passingResume; original(callback);};
            return 0;
          }
        }
      }
      return original(callback);
    };
  }, {kind, minimum, rise});
}
async function capturedCharge(target) {return (await target.waitForFunction(() => window.__passingCapture, null, {polling: 50})).jsonValue();}
async function resumeFrame(target) {await target.evaluate(() => window.__passingResume?.());}
async function waitOnePass(target, previous = 0) {
  await target.waitForFunction(previous => __T11.getState().stats.passes[0] === previous + 1, previous);
  await target.waitForFunction(() => document.getElementById('charge-wrap').hidden);
  const count = await target.evaluate(() => __T11.getState().stats.passes[0]); assert.equal(count, previous + 1);
}
async function report(failure) {
  const diagnostics = failure && activePage && !activePage.isClosed() ? await activePage.evaluate(() => {
    const s = window.__T11?.getState(), p = s?.players[s.selected[0]];
    return {phase: s?.phase, owner: s?.ball.owner, selected: p?.id, charge: p?.passCharge, type: p?.passType,
      passes: s?.stats.passes[0], captured: window.__passingCapture, meterHidden: document.getElementById('charge-wrap')?.hidden,
      guide: window.__T11?.stats().passAimTarget};
  }).catch(() => null) : undefined;
  await writeFile(resolve(out, 'passing-browser-report.json'), JSON.stringify({testedAt: new Date().toISOString(), browser: browser?.version(), checks, errors,
    ...(failure ? {failure: String(failure.stack || failure), diagnostics} : {})}, null, 2));
}

try {
  browser = await chromium.launch({headless: true, ...(process.env.BROWSER_EXECUTABLE ? {executablePath: process.env.BROWSER_EXECUTABLE} : {}), args: ['--enable-unsafe-swiftshader']});
  ({target: page} = await newPage()); activePage = page;

  await fixture(page); await page.keyboard.press('KeyJ', {delay: 0}); await waitOnePass(page);
  await page.waitForTimeout(140); assert.equal(await page.evaluate(() => __T11.getState().stats.passes[0]), 1);
  mark('A quick keyboard tap releases exactly one pass, including the fallback pulse');

  await fixture(page); await armChargeCapture(page, 'pass', {minimum: 0.28, rise: 0.16}); await page.keyboard.down('KeyJ');
  const {early, later, passes: heldPasses} = await capturedCharge(page);
  assert.equal(heldPasses, 0, 'The held frame must precede auto-release');
  assert.equal(later.title, 'PASS POWER'); assert.ok(later.percent > early.percent); assert.ok(later.receiver !== null);
  const held = await page.evaluate(async () => {
    const {passPreview} = await import('./shared/passing.js'), s = __T11.getState(), p = s.players[s.selected[0]], stats = __T11.stats();
    const preview = passPreview(s, p, {mx: 0, mz: 0, passHold: true}, 'pass', p.passCharge);
    return {guide: stats.passAimTarget, expected: preview.target, receiver: stats.passTargetId, expectedReceiver: preview.receiverId,
      receiverName: stats.passTargetName, charge: stats.passCharge, authoritativeCharge: p.passCharge, passes: s.stats.passes[0]};
  });
  assert.deepEqual(held.guide, held.expected); assert.equal(held.receiver, held.expectedReceiver); assert.ok(held.receiverName);
  assert.ok(Math.abs(held.charge - held.authoritativeCharge) < 1e-8); assert.equal(held.passes, 0);
  await page.screenshot({path: resolve(out, 'charged-pass-desktop.png')});
  await page.keyboard.up('KeyJ'); await resumeFrame(page); await waitOnePass(page);
  assert.equal(await page.evaluate(() => __T11.getState().receiver[0]), held.receiver);
  mark('Holding J raises pass power and shows the shared receiver target; release uses that receiver once', {early: early.percent, later: later.percent, receiver: held.receiverName});

  await fixture(page); await armChargeCapture(page, 'through', {minimum: 0.28}); await page.keyboard.down('KeyK'); await capturedCharge(page);
  const through = await page.evaluate(async () => {
    const {passPreview} = await import('./shared/passing.js'), s = __T11.getState(), p = s.players[s.selected[0]], r = __T11.stats();
    const intended = passPreview(s, p, {mx: 0, mz: 0, throughHold: true}, 'through', p.passCharge), receiver = s.players[intended.receiverId];
    return {title: document.getElementById('charge-title').textContent, target: r.passAimTarget, expected: intended.target,
      lead: intended.target.x - receiver.x, receiver: r.passTargetId};
  });
  assert.equal(through.title, 'THROUGH BALL'); assert.deepEqual(through.target, through.expected); assert.ok(through.lead > 2.5, 'Through target stays ahead of the receiver, including the receiver\'s current movement');
  await page.screenshot({path: resolve(out, 'charged-through-desktop.png')});
  await page.keyboard.up('KeyK'); await resumeFrame(page); await waitOnePass(page);
  assert.equal(await page.evaluate(() => __T11.getState().event.type), 'through');
  mark('Holding K shows a charged through-ball landing point ahead of the receiver', {leadMetres: through.lead});

  await fixture(page); await page.keyboard.down('KeyJ'); await page.waitForFunction(() => __T11.getState().stats.passes[0] === 1 && __T11.getState().passHoldLatch[0]);
  const cappedReceiver = await page.evaluate(() => {
    const s = __T11.getState(), p = s.players[s.receiver[0] ?? 8]; s.selected[0] = p.id; s.pendingSwitch[0] = null; s.offside = null;
    Object.assign(p, {cooldown: 0, actionTime: 0, vx: 0, vz: 0});
    Object.assign(s.ball, {owner: p.id, lastTouch: p.id, state: 'controlled', x: p.x + Math.cos(p.facing) * 0.55, y: 0.11, z: p.z, vx: 0, vy: 0, vz: 0});
    return p.id;
  });
  await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(id => ({passes: __T11.getState().stats.passes[0], charge: __T11.getState().players[id].passCharge}), cappedReceiver), {passes: 1, charge: 0});
  await page.keyboard.up('KeyJ'); await page.waitForFunction(() => !__T11.getState().passHoldLatch[0]);
  assert.equal(await page.evaluate(() => __T11.getState().stats.passes[0]), 1);
  mark('Maximum charge auto-releases once and stays latched across a receiver switch and button-up');

  await fixture(page); await armChargeCapture(page, 'pass'); await page.keyboard.down('KeyJ'); await capturedCharge(page);
  await page.evaluate(() => {const s = __T11.getState(); Object.assign(s.ball, {owner: null, state: 'free', x: 35, z: 18, vx: 0, vy: 0, vz: 0});});
  await resumeFrame(page);
  await page.waitForFunction(() => document.getElementById('charge-wrap').hidden && __T11.stats().passAimTarget === null);
  await page.keyboard.up('KeyJ'); assert.equal(await page.evaluate(() => __T11.getState().stats.passes[0]), 0);
  mark('Losing possession clears pass power and receiver guide without releasing the abandoned pass');

  await fixture(page); await armChargeCapture(page, 'pass'); await page.keyboard.down('KeyJ'); await capturedCharge(page); await page.locator('#pause-open').click();
  assert.equal(await page.locator('#charge-wrap').isVisible(), false); await page.keyboard.up('KeyJ');
  await resumeFrame(page);
  await page.locator('#leave-match').click(); await page.locator('#quit-confirm').click(); await page.locator('#return-home').click();
  await page.waitForFunction(() => __T11.getState() === null && !document.getElementById('home-screen').hidden && document.getElementById('hud').hidden && document.getElementById('charge-wrap').hidden);
  mark('Pause hides the power meter and returning to the title screen clears the match and gameplay HUD');

  await page.evaluate(() => __T11.start({duration: 360, humans: [true, false]})); await page.waitForFunction(() => __T11.getState()?.phase === 'playing');
  await page.evaluate(() => {
    window.__passingPad = {id: 'Passing QA standard controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 17}, () => ({pressed: false, touched: false, value: 0}))};
    Object.defineProperty(navigator, 'getGamepads', {configurable: true, value: () => [window.__passingPad]});
  });
  for (const [button, kind] of [[0, 'pass'], [3, 'through']]) {
    await fixture(page); await armChargeCapture(page, kind); await page.evaluate(index => Object.assign(__passingPad.buttons[index], {pressed: true, value: 1}), button);
    await capturedCharge(page); assert.equal(await page.locator('#device-label').textContent(), 'GAMEPAD');
    await page.evaluate(index => Object.assign(__passingPad.buttons[index], {pressed: false, value: 0}), button); await resumeFrame(page); await waitOnePass(page);
    assert.equal(await page.evaluate(() => __T11.getState().event.type), kind);
  }
  await page.evaluate(() => {window.__passingPad.connected = false; __T11.input.clear();});
  mark('Standard controller A and Y hold/release through the actual gamepad polling path');

  const mobile = await newPage(true); activePage = mobile.target;
  const cdp = await mobile.context.newCDPSession(mobile.target);
  for (const kind of ['pass', 'through']) {
    await fixture(mobile.target); await armChargeCapture(mobile.target, kind); const button = await mobile.target.locator(`[data-action=${kind}]`).boundingBox(); assert.ok(button);
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x: button.x + button.width / 2, y: button.y + button.height / 2, id: 1}]});
    await capturedCharge(mobile.target);
    if (kind === 'pass') await mobile.target.screenshot({path: resolve(out, 'charged-pass-touch.png')});
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []}); await resumeFrame(mobile.target); await waitOnePass(mobile.target);
    assert.equal(await mobile.target.evaluate(() => __T11.getState().event.type), kind);
  }
  assert.equal(await mobile.target.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  mark('Touch Pass and Through hold/release through real pointer events without horizontal overflow');

  assert.deepEqual(errors, []); mark('No browser JavaScript errors'); await report();
} catch (error) {
  if (activePage && !activePage.isClosed()) await activePage.screenshot({path: resolve(out, 'passing-browser-failure.png')}).catch(() => {});
  await report(error); throw error;
} finally {
  for (const context of contexts) await context.close().catch(() => {});
  await browser?.close(); await service.close();
}
