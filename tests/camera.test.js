import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraController, cameraSettings} from '../client/camera.js';
import * as THREE from 'three';
import {validateInput} from '../server/index.js';
import {createMatch} from '../shared/simulation.js';
import {shotAim} from '../shared/shooting.js';
import {shotPreview} from '../client/render.js';

const state = () => ({half: 1, selected: [1, 12], ball: {x: 0, y: 0.225, z: 0, vx: 0}, players: Array.from({length: 22}, (_, id) => ({id, team: id < 11 ? 0 : 1, x: id - 11, z: id % 3, facing: 0}))});
const thirdPerson = {cameraMode: 'third-person', team: 0, menu: false, dt: 1 / 60};
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be ${expected}`);

test('third-person forward and strafe follow the orbit without steering the view', () => {
  const camera = createCameraController(), match = state();
  const forward = camera.prepareInput({mx: 0, mz: -1}, match, thirdPerson);
  close(forward.mx, 1); close(forward.mz, 0);
  const turn = camera.prepareInput({mx: 0, mz: -1, lookYaw: Math.PI / 2}, match, thirdPerson);
  close(turn.mx, 0); close(turn.mz, 1);
  const strafe = camera.prepareInput({mx: 1, mz: 0}, match, thirdPerson);
  close(strafe.mx, -1); close(strafe.mz, 0);
  close(camera.update(match, thirdPerson).yaw, Math.PI / 2);
  for (let i = 0; i < 20; i++) camera.prepareInput({mx: 1, mz: -1}, match, thirdPerson);
  close(camera.update(match, thirdPerson).yaw, Math.PI / 2);
});

test('switching snaps the follow position behind the visible player and retains orbit heading', () => {
  const camera = createCameraController(), match = state();
  camera.prepareInput({lookYaw: 0.7}, match, thirdPerson);
  const initial = camera.update(match, thirdPerson);
  assert.equal(initial.hiddenPlayerId, null); assert.ok(initial.position.y > 3);
  match.selected[0] = 5; match.players[5].x = 31; match.players[5].z = -16;
  const switched = camera.update(match, thirdPerson);
  close(switched.target.x, 31 + Math.cos(initial.yaw) * 2.4); close(switched.target.z, -16 + Math.sin(initial.yaw) * 2.4);
  assert.equal(switched.hiddenPlayerId, null); close(switched.yaw, initial.yaw);
  assert.ok((switched.position.x - 31) * Math.cos(switched.yaw) + (switched.position.z + 16) * Math.sin(switched.yaw) < -5);
  match.players[5].x = -40; match.players[5].z = 25;
  const reset = camera.update(match, thirdPerson);
  close(reset.target.x, -40 + Math.cos(initial.yaw) * 2.4);
});

test('both teams face their attack goal and end changes rotate exactly once', () => {
  const match = state(), camera = createCameraController();
  close(camera.update(match, {...thirdPerson, team: 1}).yaw, Math.PI);
  const ours = createCameraController(); ours.prepareInput({lookYaw: 0.2}, match, thirdPerson);
  match.half = 2;
  const action = ours.prepareInput({mz: -1}, match, thirdPerson);
  assert.ok(action.mx < -0.97); assert.ok(action.mz < 0);
  const yaw = ours.update(match, thirdPerson).yaw;
  for (let i = 0; i < 3; i++) {ours.prepareInput({}, match, thirdPerson); close(ours.update(match, thirdPerson).yaw, yaw);}
});

test('look data never enters the server action protocol in any camera mode', () => {
  for (const cameraMode of ['broadcast', 'telebroadcast', 'third-person']) {
    const camera = createCameraController();
    const action = camera.prepareInput({mx: 0.3, mz: -0.4, shoot: true, finesse: true, chip: true, pass: true, slide: true, lookYaw: 0.8, lookPitch: -0.2, unexpected: 'drop'}, state(), {...thirdPerson, cameraMode});
    assert.equal(action.lookYaw, undefined); assert.equal(action.lookPitch, undefined); assert.equal(action.unexpected, undefined);
    assert.equal(validateInput(action).shoot, true); assert.equal(action.pass, true); assert.equal(action.slide, true);
    assert.equal(validateInput(action).finesse,true);assert.equal(validateInput(action).chip,true);
  }
});

test('TV cameras retain screen-relative controls and have distinct framing', () => {
  const match = state(), camera = createCameraController();
  const broadcast = camera.update(match, {cameraMode: 'broadcast', cameraHeight: 0.5, cameraZoom: 0.5});
  const tele = camera.update(match, {cameraMode: 'telebroadcast', cameraHeight: 0.5, cameraZoom: 0.5});
  assert.ok(tele.position.y < broadcast.position.y);
  assert.ok(Math.abs(tele.pitch) < Math.abs(broadcast.pitch)); assert.ok(tele.fov < broadcast.fov);
  const action = camera.prepareInput({mx: 0.6, mz: -0.8}, match, {cameraMode: 'telebroadcast'});
  close(action.mx, 0.6); close(action.mz, -0.8);
});

test('height raises TV cameras, zoom narrows their lens, and menu restores all figures', () => {
  for (const cameraMode of ['broadcast', 'telebroadcast']) {
    const camera = createCameraController(), match = state();
    const wide = camera.update(match, {cameraMode, cameraHeight: 0, cameraZoom: 0});
    let closeView;
    for (let i = 0; i < 180; i++) closeView = camera.update(match, {cameraMode, cameraHeight: 1, cameraZoom: 1, dt: 1 / 60});
    assert.ok(closeView.position.y > wide.position.y + 15);
    assert.ok(closeView.fov < wide.fov - 17);
    camera.update(match, thirdPerson);
    const menu = camera.update(match, {...thirdPerson, menu: true});
    assert.equal(menu.mode, 'menu'); assert.equal(menu.hiddenPlayerId, null); close(menu.position.y, 74);
  }
});

test('third-person height, zoom and FOV work while legacy preferences migrate', () => {
  const camera = createCameraController(), match = state();
  const low = camera.update(match, {...thirdPerson, cameraHeight: 0, cameraZoom: 0});
  const high = camera.update(match, {...thirdPerson, cameraHeight: 1, cameraZoom: 0});
  assert.ok(high.position.y > low.position.y + 2);
  const near = camera.update(match, {...thirdPerson, cameraHeight: 1, cameraZoom: 1});
  const subject = match.players[match.selected[0]];
  assert.ok(Math.hypot(near.position.x - subject.x, near.position.z - subject.z) < Math.hypot(high.position.x - subject.x, high.position.z - subject.z) - 3);
  const broad = camera.update(match, {...thirdPerson, cameraFov: 500}); assert.equal(broad.fov, 100);
  camera.prepareInput({lookPitch: -1000}, match, thirdPerson);
  const down = camera.update(match, {...thirdPerson, cameraFov: 0});
  assert.ok(down.pitch > -Math.PI / 2 && down.pitch < -0.6); assert.equal(down.fov, 60);
  assert.equal(cameraSettings({cameraMode: 'first-person'}).mode, 'third-person');
  assert.deepEqual(cameraSettings({cameraHeight: -1, cameraZoom: 3, cameraMode: 'invalid', cameraFov: NaN}), {mode: 'broadcast', height: 0, zoom: 1, fov: 80});
});

test('default third-person framing includes complete player and dribbling ball in landscape and portrait', () => {
  for (const aspect of [16 / 9, 9 / 16]) {
    const match = state(), subject = match.players[match.selected[0]];
    const info = createCameraController().update(match, thirdPerson, aspect);
    const camera = new THREE.PerspectiveCamera(info.fov, aspect, 0.1, 700);
    camera.position.set(info.position.x, info.position.y, info.position.z); camera.lookAt(info.target.x, info.target.y, info.target.z); camera.updateMatrixWorld();
    for (const [ahead, y] of [[0, 0.05], [0, 1.9], [0.8, 0.225]]) {
      const projected = new THREE.Vector3(subject.x + ahead, y, subject.z).project(camera);
      assert.ok(Math.abs(projected.x) < 0.9 && Math.abs(projected.y) < 0.9 && projected.z < 1, `Player / ball fits ${aspect} viewport: ${projected.toArray()}`);
    }
  }
});

test('shot preview matches the release helper, directional aim and minimum tap power without mutation', () => {
  const match = createMatch(), selected = match.players[match.selected[0]];
  match.phase = 'playing'; match.ball.owner = selected.id; selected.charge = 0.6;
  const options = {team: 0, input: {mx: 0, mz: 0.8, shoot: true}}, before = JSON.stringify(match);
  const preview = shotPreview(match, options);
  assert.deepEqual(preview, shotAim(match, selected, options.input, selected.charge));
  assert.equal(JSON.stringify(match), before); assert.ok(preview.target.z > 2);
  const opposite = shotPreview(match, {...options, input: {...options.input, mz: -0.8}});
  assert.ok(opposite.target.z < -2);
  selected.charge = 0.08;
  const tap = shotPreview(match, options); close(tap.power, 0.18); assert.ok(tap.target.y < preview.target.y);
});

test('shot guide disappears on release, lost possession, selection change, menus, replays and stopped play', () => {
  const match = createMatch(), selected = match.players[match.selected[0]];
  match.phase = 'playing'; match.ball.owner = selected.id; selected.charge = 0.6;
  const options = {team: 0, input: {shoot: true}};
  assert.ok(shotPreview(match, options));
  for (const hidden of [{menu: true}, {replay: true}, {input: {shoot: false}}, {team: 1}]) assert.equal(shotPreview(match, {...options, ...hidden}), null);
  match.ball.owner = null; assert.equal(shotPreview(match, options), null); match.ball.owner = selected.id;
  match.selected[0] = 1; assert.equal(shotPreview(match, options), null); match.selected[0] = selected.id;
  selected.charge = 0; assert.equal(shotPreview(match, options), null); selected.charge = 0.6;
  match.phase = 'goal'; assert.equal(shotPreview(match, options), null);
});

test('replay goal endpoints immediately frame either goal while live TV movement stays smooth', () => {
  for (const direction of [-1, 1]) for (const cameraMode of ['broadcast', 'telebroadcast']) {
    const replayCamera = createCameraController(), liveCamera = createCameraController(), match = state();
    const options = {cameraMode, cameraHeight: 0.55, cameraZoom: 0.35, dt: 1 / 60};
    match.phase = 'playing';
    replayCamera.update(match, {...options, replay: true}); liveCamera.update(match, options);
    match.ball.x = direction * 53; match.phase = 'goal';
    const endpoint = replayCamera.update(match, {...options, replay: true});
    const live = liveCamera.update(match, options);
    const expected = createCameraController().update(match, options);
    assert.deepEqual(endpoint.position, expected.position, 'Replay endpoint must snap even after a sparse snapshot jump');
    assert.deepEqual(endpoint.target, expected.target);
    assert.ok(Math.abs(live.position.x) < Math.abs(endpoint.position.x) * 0.1, 'Live camera must retain tracking smoothing');
    const projection = new THREE.PerspectiveCamera(endpoint.fov, 16 / 9, 0.1, 700);
    projection.position.set(endpoint.position.x, endpoint.position.y, endpoint.position.z); projection.lookAt(endpoint.target.x, endpoint.target.y, endpoint.target.z); projection.updateMatrixWorld();
    for (const z of [-3.66, 3.66]) for (const y of [0, 2.44]) {
      const post = new THREE.Vector3(direction * 52.5, y, z).project(projection);
      assert.ok(Math.abs(post.x) < 0.95 && Math.abs(post.y) < 0.95, 'Complete goal mouth must be inside endpoint frame');
    }
  }
});
