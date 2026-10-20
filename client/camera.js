// Camera policy is independent of Three.js so movement and switching can be tested.
import {penaltyScene} from '../shared/penalties.js';
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const wrap = value => Math.atan2(Math.sin(value), Math.cos(value));
const mix = (a, b, amount) => a + (b - a) * amount;
const buttons = ['sprint', 'jockey', 'pass', 'through', 'passHold', 'throughHold', 'lob', 'shoot', 'finesse', 'chip', 'strike', 'clear', 'tackle', 'slide', 'switch', 'oneTwo','ballRoll','bodyFeint','fakeShot','keeperLeft','keeperRight','keeperCentre','keeperDive','keeperReady','cancelCharge'];

export function cameraSettings(options = {}) {
  return {
    mode: options.cameraMode === 'first-person' ? 'third-person' : ['broadcast', 'telebroadcast', 'third-person'].includes(options.cameraMode) ? options.cameraMode : 'broadcast',
    height: clamp(finite(options.cameraHeight, 0.45), 0, 1),
    zoom: clamp(finite(options.cameraZoom, 0.5), 0, 1),
    fov: clamp(finite(options.cameraFov, 80), 60, 100)
  };
}

export function viewRelativeMovement(mx, mz, yaw) {
  // Forward is -mz. World heading yaw=0 points to +x; positive yaw turns right.
  const forward = -mz, right = mx;
  return {mx: forward * Math.cos(yaw) - right * Math.sin(yaw), mz: forward * Math.sin(yaw) + right * Math.cos(yaw)};
}

export function createCameraController() {
  let active = false, attack = 1, yaw = 0, pitch = -0.3, lastMode = null;
  const view = {x: -8, z: -2, height: 74, distance: 82, fov: 43};
  const follow = {x: 0, z: 0, selectedId: null};

  function sync(state, options) {
    const settings = cameraSettings(options), team = options.team === 1 ? 1 : 0;
    const selected = state?.players?.find(player => player.id === state?.selected?.[team]);
    const thirdPerson = settings.mode === 'third-person' && !options.menu && !!selected;
    const direction = (team === 0 ? 1 : -1) * (state?.half === 2 ? -1 : 1);
    if (thirdPerson) {
      if (!active) {yaw = direction === 1 ? 0 : Math.PI; pitch = -0.3; follow.selectedId = null;}
      else if (direction !== attack) yaw = wrap(yaw + Math.PI);
    }
    attack = direction; active = thirdPerson;
    return {settings, selected, thirdPerson};
  }

  function prepareInput(actions = {}, state, options = {}) {
    const penalty=!options.menu&&!options.replay&&penaltyScene(state);
    const context = penalty?null:sync(state, options);
    // Look deltas are client-only. Never leak them to the strict server protocol.
    const result = {mx: clamp(finite(actions.mx, 0), -1, 1), mz: clamp(finite(actions.mz, 0), -1, 1)};
    for (const key of buttons) result[key] = !!actions[key];
    const length = Math.hypot(result.mx, result.mz);
    if (length > 1) {result.mx /= length; result.mz /= length;}
    if(penalty){
      // A penalty uses screen axes for the goal target. During the resulting
      // flight, movement remains relative to the fixed view behind the taker.
      if(state.phase!=='restart'&&penalty.team===options.team)Object.assign(result,viewRelativeMovement(result.mx,result.mz,(penalty.team===0?1:-1)*(penalty.half===2?-1:1)>0?0:Math.PI));
    } else if (context.thirdPerson) {
      yaw = wrap(yaw + clamp(finite(actions.lookYaw, 0), -Math.PI, Math.PI));
      pitch = clamp(pitch + clamp(finite(actions.lookPitch, 0), -1, 1), -0.9, -0.07);
      Object.assign(result, viewRelativeMovement(result.mx, result.mz, yaw));
    }
    result.shotAssist=actions.shotAssist!==false;result.keeperAssist=actions.keeperAssist!==false;
    return result;
  }

  function update(state, options = {}, aspect = 16 / 9) {
    const penalty=!options.menu&&!options.replay&&penaltyScene(state);
    if(penalty){
      const dir=(penalty.team===0?1:-1)*(penalty.half===2?-1:1),portrait=aspect<1.25;
      lastMode='penalty';
      return {mode:'penalty',position:{x:penalty.x-dir*(portrait?9:7.5),y:3.2,z:penalty.z-dir*1.4},target:{x:dir*50.5,y:.7,z:0},fov:portrait?65:48,yaw:dir>0?0:Math.PI,pitch:-.15,hiddenPlayerId:null,height:0,zoom:0};
    }
    const {settings, selected, thirdPerson} = sync(state, options);
    if (thirdPerson) {
      const dt = clamp(finite(options.dt, 1 / 60), 0.001, 0.1);
      const snap = lastMode !== 'third-person' || follow.selectedId !== selected.id || Math.hypot(follow.x - selected.x, follow.z - selected.z) > 8;
      const amount = snap ? 1 : 1 - Math.exp(-dt * (options.reducedMotion ? 18 : 12));
      follow.x = mix(follow.x, selected.x, amount); follow.z = mix(follow.z, selected.z, amount); follow.selectedId = selected.id;
      lastMode = 'third-person';
      // An elevated orbit keeps the complete player and the nearby ball in view.
      // Look yaw is independent of the runner's facing: strafing never spins the view.
      const elevation = clamp(-pitch + settings.height * 0.28, 0.12, 1.08);
      const distance = 12 - settings.zoom * 6 + (aspect < 1.25 ? 2 : 0);
      const horizontal = Math.cos(elevation) * distance, focusAhead = 2.4;
      const position = {x: follow.x - Math.cos(yaw) * horizontal, y: 1.05 + Math.sin(elevation) * distance, z: follow.z - Math.sin(yaw) * horizontal};
      const target = {x: follow.x + Math.cos(yaw) * focusAhead, y: 1.05, z: follow.z + Math.sin(yaw) * focusAhead};
      return {mode: 'third-person', position, target, fov: settings.fov, yaw,
        pitch: -Math.atan2(position.y - target.y, horizontal + focusAhead), hiddenPlayerId: null, height: settings.height, zoom: settings.zoom};
    }
    const b = state?.ball || {x: 0, z: 0, y: 0, vx: 0};
    const menu = !!options.menu, tele = settings.mode === 'telebroadcast' && !menu;
    const mode = menu ? 'menu' : tele ? 'telebroadcast' : 'broadcast';
    const portrait = aspect < 1.25, loft = clamp(finite(b.y, 0) * 0.15, 0, 2.4);
    const target = menu ? {x: -8, z: -2, height: 74, distance: 82, fov: 43} : {
      x: clamp(finite(b.x, 0) * (tele ? 0.9 : 0.81) + clamp(finite(b.vx, 0), -14, 14) * (tele ? 0.2 : 0.12), tele ? -41 : -35, tele ? 41 : 35),
      z: clamp(finite(b.z, 0) * (tele ? 0.85 : 0.45), tele ? -29 : -12, tele ? 29 : 12),
      height: (tele ? 16 + settings.height * 18 : 36 + settings.height * 25) + loft + (portrait ? 15 : 0),
      distance: (tele ? 38 + settings.height * 8 : 41 + settings.height * 18) + (portrait ? 10 : 0),
      fov: tele ? 44 - settings.zoom * 18 : 54 - settings.zoom * 22
    };
    const dt = clamp(finite(options.dt, 1 / 60), 0.001, 0.1);
    // A sparse replay may jump directly from a long shot to the goal snapshot.
    // Present that endpoint immediately; live tracking retains its normal easing.
    const replayEndpoint = !menu && options.replay && state?.phase === 'goal';
    const amount = replayEndpoint ? 1 : 1 - Math.exp(-dt * (options.reducedMotion ? 1.5 : 3.2));
    for (const key of Object.keys(view)) view[key] = lastMode !== mode ? target[key] : mix(view[key], target[key], amount);
    lastMode = mode;
    return {mode, position: {x: view.x, y: view.height, z: view.z + view.distance}, target: {x: view.x, y: 0, z: view.z}, fov: view.fov,
      yaw: -Math.PI / 2, pitch: -Math.atan2(view.height, view.distance), hiddenPlayerId: null, height: settings.height, zoom: settings.zoom};
  }
  return {prepareInput, update};
}
