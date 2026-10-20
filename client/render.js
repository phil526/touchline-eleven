import {isManualRestart} from '../shared/restarts.js';
import * as THREE from 'three';
import {createFootballer, animateFootballer} from './animation.js';
import {createPlayerGeometries, createPlayerTextures, bendShortsMaterial} from './player-model.js';
import {createCameraController} from './camera.js';
import {shotAim,shotTrajectory} from '../shared/shooting.js';
import {passPreview} from '../shared/passing.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mix = (a, b, t) => a + (b - a) * t;
const white = 0xdde8cf;
const temp = new THREE.Object3D();

export function shotPreview(state, options = {}) {
  const team = options.team === 1 ? 1 : 0,penalty=isManualRestart(state,team)&&state.restart.type==='penalty';
  if (options.menu || options.replay || options.guidesHidden || !options.input?.shoot&&!penalty) return null;
  const selected = state?.players?.find(player => player.id === state?.selected?.[team]);
  if (!selected || state.ball?.owner !== selected.id || !(selected.charge > 0)&&!penalty || state.phase !== 'playing'&&!isManualRestart(state,team)) return null;
  if(isManualRestart(state,team)&&state.restart.type==='throwIn')return null;
  return shotAim(state, selected, options.input||{},penalty&&!options.input?.shoot?0.55:Math.max(0.18, selected.charge));
}

export function passingPreview(state, options = {}) {
  const team=options.team===1?1:0,manual=isManualRestart(state,team);
  if(manual&&state.restart.type==='penalty')return null;
  if(options.menu||options.replay||options.guidesHidden||state?.phase!=='playing'&&!manual)return null;
  if(options.input?.shoot&&!(manual&&state.restart.type==='throwIn'))return null;
  const selected=state.players.find(p=>p.id===state.selected[team]);
  if(!selected||state.ball.owner!==selected.id)return null;
  const kind=isManualRestart(state,team)&&options.input?.shoot&&state.restart.type==='throwIn'?'lob':selected.passType||(options.input?.throughHold?'through':'pass');
  return passPreview(state,selected,options.input||{},kind,selected.passCharge||selected.charge||0);
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: 'high-performance'});
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b202b);
  scene.fog = new THREE.FogExp2(0x102b35, 0.0031);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 700);
  const resources = new Set();
  let frame = 0, elapsed = 0, lastQuality = '', lastShadows = null, fps = 60, lastFrame = 16.7, lastRenderAt = null;
  let lastScale=1;
  let width = 1, height = 1, lastBoard = '', passTargetId = null, shotAimInfo = null, passAimInfo = null, passTargetName = null;
  const cameraController = createCameraController();
  let cameraInfo = cameraController.update(null, {menu: true});
  const lookAt = new THREE.Vector3();
  const save = value => {resources.add(value); return value;};
  const material = (colour, extra = {}) => save(new THREE.MeshStandardMaterial({color: colour, roughness: 0.9, metalness: 0, ...extra}));
  const basic = (colour, extra = {}) => save(new THREE.MeshBasicMaterial({color: colour, ...extra}));
  const boxGeometry = save(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeometry = save(new THREE.CylinderGeometry(1, 1, 1, 8));
  const sphereGeometry = save(new THREE.SphereGeometry(1, 10, 8));
  const cube = (x, y, z, sx, sy, sz, mat, parent = scene) => {
    const mesh = new THREE.Mesh(boxGeometry, mat); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); parent.add(mesh); return mesh;
  };
  const batches = [];
  const crowdObjects = [];

  scene.add(new THREE.HemisphereLight(0xc9ebf2, 0x344e36, 2.15));
  const key = new THREE.DirectionalLight(0xfff2d6, 3.15);
  key.position.set(-25, 58, 18); key.target.position.set(0, 0, 0);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, {left: -75, right: 75, top: 55, bottom: -55, near: 0.5, far: 140});
  key.shadow.bias = -0.0003; key.shadow.normalBias = 0.025;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0x9bd9ff, 1.1); fill.position.set(38, 35, -38); scene.add(fill);

  // Original, deterministic turf texture. Fine variation survives at broadcast distance.
  function canvasTexture(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const texture = save(new THREE.CanvasTexture(c)); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }
  let seed = 7391;
  const random = () => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296;};
  const turf = canvasTexture(1536, 1024, (ctx, w, h) => {
    for (let i = 0; i < 20; i++) {ctx.fillStyle = i % 2 ? '#337442' : '#2e6a3c'; ctx.fillRect(i * w / 20, 0, w / 20 + 1, h);}
    for (let i = 0; i < 85000; i++) {
      ctx.fillStyle = random() > 0.5 ? 'rgba(189,213,124,.055)' : 'rgba(10,45,22,.09)';
      ctx.fillRect(random() * w, random() * h, 1, 2 + random() * 3);
    }
  });
  turf.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const surround = cube(0, -0.19, 0, 148, 0.3, 108, material(0x243c32)); surround.receiveShadow = true;
  const pitch = new THREE.Mesh(save(new THREE.PlaneGeometry(105, 68)), material(0xffffff, {map: turf}));
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.001; pitch.receiveShadow = true; scene.add(pitch);
  const lineMat = basic(white);
  const line = (x, z, sx, sz) => cube(x, 0.017, z, sx, 0.012, sz, lineMat);
  const rect = (x, z, sx, sz) => {line(x - sx / 2, z, 0.13, sz); line(x + sx / 2, z, 0.13, sz); line(x, z - sz / 2, sx, 0.13); line(x, z + sz / 2, sx, 0.13);};
  const arc = (x, z, radius, start = 0, end = Math.PI * 2, linewidth = 0.13) => {
    const positions = [], indices = [], segments = Math.ceil((end - start) * radius * 3);
    for (let i = 0; i <= segments; i++) {
      const a = mix(start, end, i / segments);
      for (const r of [radius - linewidth / 2, radius + linewidth / 2]) positions.push(x + Math.cos(a) * r, 0.025, z + Math.sin(a) * r);
      if (i < segments) {const n = i * 2; indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);}
    }
    const geo = save(new THREE.BufferGeometry()); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setIndex(indices);
    const m = new THREE.Mesh(geo, lineMat); m.material.side = THREE.DoubleSide; scene.add(m);
  };
  const dot = (x, z, radius = 0.15) => {const m = new THREE.Mesh(save(new THREE.CircleGeometry(radius, 16)), lineMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.026, z); scene.add(m);};
  rect(0, 0, 105, 68); line(0, 0, 0.13, 68); arc(0, 0, 9.15); dot(0, 0);
  for (const end of [-1, 1]) {
    rect(end * 44.25, 0, 16.5, 40.32); rect(end * 49.75, 0, 5.5, 18.32); dot(end * 41.5, 0);
    const theta = Math.acos(5.5 / 9.15);
    arc(end * 41.5, 0, 9.15, end === 1 ? Math.PI - theta : -theta, end === 1 ? Math.PI + theta : theta);
    for (const side of [-1, 1]) {
      const start = end === 1 ? (side === 1 ? Math.PI : Math.PI / 2) : (side === 1 ? 3 * Math.PI / 2 : 0);
      arc(end * 52.5, side * 34, 1, start, start + Math.PI / 2);
      cube(end * 52.75, 0.79, side * 34.25, 0.035, 1.58, 0.035, material(0xe9e8d5));
      const flag = cube(end * 52.75 + 0.22, 1.5, side * 34.25, 0.44, 0.26, 0.018, material(0xf2b04b)); flag.rotation.y = side * 0.18;
    }
  }

  // White goal frames and individually drawn mesh-net strands; one draw per net.
  const goalMat = material(0xf4f1dc, {roughness: 0.45});
  function pole(a, b, radius = 0.065, mat = goalMat) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const m = new THREE.Mesh(cylinderGeometry, mat); m.position.copy(start).add(end).multiplyScalar(0.5);
    m.scale.set(radius, start.distanceTo(end), radius); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.sub(start).normalize()); scene.add(m); return m;
  }
  for (const end of [-1, 1]) {
    const front = end * 52.5, rear = end * 54.65;
    for (const z of [-3.66, 3.66]) {
      pole([front, 0, z], [front, 2.44, z]).castShadow = true;
      pole([front, 2.44, z], [rear, 2.15, z], 0.035);
      pole([rear, 0, z], [rear, 2.15, z], 0.035);
      pole([front, 0.05, z], [rear, 0.05, z], 0.035);
    }
    pole([front, 2.44, -3.66], [front, 2.44, 3.66]).castShadow = true;
    pole([rear, 2.15, -3.66], [rear, 2.15, 3.66], 0.035);
    const net = [], segment = (a, b) => net.push(...a, ...b);
    for (let z = -3.66; z <= 3.67; z += 0.244) {
      segment([rear, 0, z], [rear, 2.15, z]); segment([front, 2.44, z], [rear, 2.15, z]);
    }
    for (let y = 0; y <= 2.16; y += 0.215) {
      segment([rear, y, -3.66], [rear, y, 3.66]);
      for (const z of [-3.66, 3.66]) segment([front, y / 2.15 * 2.44, z], [rear, y, z]);
    }
    for (let u = 0; u <= 1.01; u += 0.1) {
      const x = mix(front, rear, u), top = mix(2.44, 2.15, u);
      for (const z of [-3.66, 3.66]) segment([x, 0, z], [x, top, z]);
      segment([x, top, -3.66], [x, top, 3.66]);
    }
    const geometry = save(new THREE.BufferGeometry()); geometry.setAttribute('position', new THREE.Float32BufferAttribute(net, 3));
    scene.add(new THREE.LineSegments(geometry, save(new THREE.LineBasicMaterial({color: 0xaecbc0, transparent: true, opacity: 0.43}))));
  }

  // Four coherent stepped stands; seats and spectators share instanced geometries.
  const concrete = material(0x314a50), steel = material(0x263d46, {metalness: 0.5, roughness: 0.65}), roofMat = material(0x18333f, {metalness: 0.35});
  const seatPositions = [], peoplePositions = [];
  for (const side of [-1, 1]) {
    for (let row = 0; row < 13; row++) {
      const z = side * (40.8 + row * 1.08), y = 0.7 + row * 0.73;
      cube(0, y - 0.36, z, 126, 0.73, 1.16, concrete);
      for (let col = 0; col < 116; col++) {
        if (col % 29 < 2) continue;
        const x = -61.7 + col * 1.07;
        seatPositions.push([x, y + 0.22, z, side, row, col]);
        if (random() > 0.13) peoplePositions.push([x + (random() - 0.5) * 0.15, y + 0.56, z, side, random()]);
      }
    }
    for (let row = 0; row < 11; row++) {
      const x = side * (61 + row * 1.08), y = 0.7 + row * 0.73;
      cube(x, y - 0.36, 0, 1.16, 0.73, 79, concrete);
      for (let col = 0; col < 71; col++) {
        if (col % 24 < 2) continue;
        const z = -37.5 + col * 1.07;
        seatPositions.push([x, y + 0.22, z, 0, row, col]);
        if (random() > 0.13) peoplePositions.push([x, y + 0.56, z, 0, random()]);
      }
    }
    cube(0, 10.8, side * 54.6, 129, 1.1, 1, steel);
    const roof = cube(0, 13.6, side * 50.5, 132, 0.5, 17, roofMat); roof.rotation.x = side * -0.045;
    cube(0, 13.2, side * 42.4, 132, 0.3, 0.2, material(0xa4b9b6, {metalness: 0.5}));
    cube(side * 73, 9.2, 0, 0.8, 0.8, 81, steel);
    for (let x = -60; x <= 60; x += 20) {
      pole([x, 0, side * 55.4], [x, 13.9, side * 55.4], 0.2, steel);
      pole([x, 13.7, side * 55.4], [x, 13.2, side * 42.5], 0.09, steel);
      pole([x, 10.9, side * 55.4], [x, 13.3, side * 45.5], 0.075, steel);
    }
  }
  function instances(geometry, mat, entries, compose) {
    const mesh = new THREE.InstancedMesh(geometry, mat, entries.length);
    entries.forEach((entry, i) => {temp.position.set(0, 0, 0); temp.rotation.set(0, 0, 0); temp.scale.set(1, 1, 1); compose(entry, i, mesh); temp.updateMatrix(); mesh.setMatrixAt(i, temp.matrix);});
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); scene.add(mesh); return mesh;
  }
  const seats = instances(boxGeometry, material(0xffffff), seatPositions, (p, i, mesh) => {
    temp.position.set(p[0], p[1], p[2]); temp.scale.set(0.68, 0.19, 0.62);
    mesh.setColorAt(i, new THREE.Color((p[4] + Math.floor(p[5] / 11)) % 5 === 0 ? 0x9da89a : p[5] % 3 === 0 ? 0x376776 : 0x28515f));
  });
  crowdObjects.push(seats);
  const crowdPalette = [0x55716e, 0x7a8b79, 0x28434c, 0xb8af87, 0x254158, 0x935c37, 0xb28c54, 0x3e5660];
  const crowd = instances(boxGeometry, material(0xffffff), peoplePositions, (p, i, mesh) => {
    temp.position.set(p[0], p[1], p[2]); temp.scale.set(0.38, 0.55, 0.3);
    mesh.setColorAt(i, new THREE.Color(crowdPalette[Math.floor(p[4] * crowdPalette.length)]));
  });
  const heads = instances(save(new THREE.OctahedronGeometry(1, 0)), material(0xffffff), peoplePositions, (p, i, mesh) => {
    temp.position.set(p[0], p[1] + 0.39, p[2]); temp.scale.set(0.12, 0.135, 0.12);
    mesh.setColorAt(i, new THREE.Color([0x956f51, 0xc99872, 0x634b37][i % 3]));
  });
  crowdObjects.push(crowd, heads);

  // Warm floodlight banks. Light sprites are restrained, without costly post-processing.
  const glowTexture = canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,246,211,.7)'); g.addColorStop(0.12, 'rgba(225,243,250,.3)'); g.addColorStop(1, 'rgba(200,231,244,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const lightMat = basic(0xfff0ce);
  for (const x of [-65, 65]) for (const z of [-45, 45]) {
    pole([x, 0, z], [x, 22, z], 0.24, steel);
    const head = cube(x, 22.2, z, 5, 1.6, 0.25, steel); head.rotation.x = z > 0 ? -0.4 : 0.4;
    for (let col = -2; col <= 2; col++) for (const row of [-0.35, 0.35]) cube(x + col * 0.88, 22.2 + row, z + (z < 0 ? 0.2 : -0.2), 0.68, 0.44, 0.12, lightMat);
    const glow = new THREE.Sprite(save(new THREE.SpriteMaterial({map: glowTexture, transparent: true, opacity: 0.56, depthWrite: false, blending: THREE.AdditiveBlending})));
    glow.position.set(x, 22.2, z); glow.scale.set(14, 14, 1); scene.add(glow);
  }

  // Perimeter media is original typography, with no real sponsors or logos.
  const boardColours = ['#d9e2d3', '#eba846', '#9fbbb9', '#d8e0d3'];
  const slogans = ['TOUCHLINE / ELEVEN', 'PLAY THE SPACE', 'MERIDIAN', 'NORTH / 90'];
  const boardMats = slogans.map((text, i) => basic(0xffffff, {map: canvasTexture(1024, 96, (ctx, w, h) => {
    ctx.fillStyle = '#142c36'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = boardColours[i]; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 38px Arial'; ctx.fillText(text, w / 2, h / 2);
    ctx.fillStyle = '#40616a'; ctx.fillRect(0, h - 4, w, 4);
  })}));
  const boardGeometry = save(new THREE.PlaneGeometry(1, 1));
  for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
    const board = new THREE.Mesh(boardGeometry, boardMats[i % 4]); board.position.set(-49 + i * 14, 0.65, side * 37.6); board.scale.set(13.6, 1.25, 1); if (side > 0) board.rotation.y = Math.PI; scene.add(board);
    cube(-49 + i * 14, 0.63, side * 37.68, 13.8, 1.3, 0.18, steel);
  }
  for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
    const board = new THREE.Mesh(boardGeometry, boardMats[(i + 1) % 4]); board.position.set(side * 57.5, 0.65, -28 + i * 14); board.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; board.scale.set(13.6, 1.25, 1); scene.add(board);
  }
  // Technical areas, covered dugouts and team benches on the near touchline.
  const benchGlass = material(0x80aeb7, {transparent: true, opacity: 0.2, metalness: 0.2, roughness: 0.3, depthWrite: false});
  for (const x of [-16, 16]) {
    line(x, 35.9, 12, 0.1); line(x - 6, 35.1, 0.1, 1.6); line(x + 6, 35.1, 0.1, 1.6);
    cube(x, 1.1, 39, 9.8, 2.2, 0.09, benchGlass); cube(x, 2.2, 38.3, 10, 0.1, 1.8, benchGlass);
    cube(x, 0.51, 38.5, 9, 0.15, 0.6, steel);
    for (let i = -4; i <= 4; i++) cube(x + i, 0.8, 38.6, 0.7, 0.5, 0.15, material(x < 0 ? 0x28436d : 0xc48933));
  }
  const scoreCanvas = document.createElement('canvas'); scoreCanvas.width = 1024; scoreCanvas.height = 256;
  const scoreTexture = save(new THREE.CanvasTexture(scoreCanvas)); scoreTexture.colorSpace = THREE.SRGBColorSpace;
  const scoreMesh = new THREE.Mesh(boardGeometry, basic(0xffffff, {map: scoreTexture})); scoreMesh.position.set(0, 11.8, -52.4); scoreMesh.scale.set(19, 4.75, 1); scene.add(scoreMesh);
  cube(0, 11.8, -52.7, 19.6, 5.3, 0.5, steel);
  function updateBoard(state) {
    const score = state?.score || [0, 0], label = `${score[0]}:${score[1]}:${state?.half || 1}`;
    if (label === lastBoard) return; lastBoard = label;
    const ctx = scoreCanvas.getContext('2d'); ctx.fillStyle = '#071c27'; ctx.fillRect(0, 0, 1024, 256);
    ctx.textAlign = 'center'; ctx.fillStyle = '#9bb6b6'; ctx.font = '500 28px Arial'; ctx.fillText('M E R I D I A N   G R O U N D', 512, 52);
    ctx.fillStyle = '#e8eddc'; ctx.font = '700 80px Arial'; ctx.fillText(`NSA   ${score[0]}  —  ${score[1]}   EMB`, 512, 153);
    ctx.fillStyle = '#e6a748'; ctx.font = '600 23px Arial'; ctx.fillText('EXHIBITION  /  TOUCHLINE ELEVEN', 512, 214); scoreTexture.needsUpdate = true;
  }

  // Batch static architecture after construction. Materials preserve their individual
  // transparency and shadow behaviour; animation and the scoreboard remain separate.
  const staticGroups = new Map(), televisionRoof = [];
  for (const object of [...scene.children]) {
    if (!object.isMesh || object.isInstancedMesh || object === scoreMesh || object.material.transparent) continue;
    // Television framing can pass behind the near stand: omit its roof and
    // overhead supports from that view so they never obscure the live ball.
    object.userData.televisionRoof = object.position.z > 40 && object.position.y > 10;
    if (object.userData.televisionRoof) televisionRoof.push(object);
    const key = `${object.geometry.uuid}:${object.material.uuid}:${object.castShadow}:${object.receiveShadow}:${object.userData.televisionRoof}`;
    if (!staticGroups.has(key)) staticGroups.set(key, []);
    staticGroups.get(key).push(object);
  }
  for (const group of staticGroups.values()) {
    if (group.length < 2) continue;
    const batch = new THREE.InstancedMesh(group[0].geometry, group[0].material, group.length);
    if (group[0].userData.televisionRoof) televisionRoof.push(batch);
    batch.castShadow = group[0].castShadow; batch.receiveShadow = group[0].receiveShadow;
    group.forEach((object, index) => {object.updateMatrix(); batch.setMatrixAt(index, object.matrix); scene.remove(object);});
    batch.computeBoundingSphere(); scene.add(batch);
  }

  // Anatomical player surfaces are instanced by shape, never one draw per limb.
  // Nearby players retain facial and kit detail; distance reduces geometry for
  // the full 22-player match, including on phones and in the penalty camera.
  const rigs = Array.from({length: 22}, (_, i) => createFootballer(i, i < 11 ? 0 : 1, i % 11 === 0));
  const maps = createPlayerTextures(canvasTexture);
  const playerMat = material(0xffffff, {roughness: .84, vertexColors:true, map:maps.fabric});
  const skinMat = material(0xffffff, {roughness:.74, vertexColors:true});
  const faceMat = material(0xffffff, {roughness:.79, vertexColors:true, map:maps.face});
  const hairMat = material(0xffffff, {roughness:.95, vertexColors:true});
  const bootMat = material(0xffffff, {roughness:.62, vertexColors:true});
  const shortsMat = save(bendShortsMaterial(playerMat.clone()));
  const shortsDepth = save(bendShortsMaterial(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking})));
  const playerMaterials = [playerMat,skinMat,faceMat,hairMat,bootMat,shortsMat];
  const nearPlayers = new Array(22).fill(false);
  let playerTriangles=0,playerDrawCalls=0;
  for (const detail of ['near','far']) for (const [shape, geometry] of Object.entries(createPlayerGeometries(detail))) {
    save(geometry);
    const parts = rigs.flatMap((r, playerIndex) => r.parts.filter(p => p.shape === shape && (detail==='near'||!p.detail))
      .map(p => ({...p, playerIndex,tint:new THREE.Color(p.colour).toArray()})));
    if (!parts.length) continue;
    const surface = shape==='shorts'?shortsMat:shape==='head'?faceMat:/crop|sweep|curls/.test(shape)?hairMat:shape==='boot'?bootMat:/round|upperArm|forearm|hand|thigh/.test(shape)?skinMat:playerMat;
    const mesh = new THREE.InstancedMesh(geometry, surface, parts.length); mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if(shape==='shorts'){
      for(const side of ['Left','Right'])geometry.setAttribute(`leg${side}Quaternion`,new THREE.InstancedBufferAttribute(new Float32Array(parts.length*4),4).setUsage(THREE.DynamicDrawUsage));
      mesh.customDepthMaterial=shortsDepth;
    }
    mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.setColorAt(0,new THREE.Color(0xffffff)); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count=0;scene.add(mesh); batches.push({mesh, parts,detail,shape});
  }
  // Shirt-number atlas: front and back numbers remain original, with only one draw.
  const numberAtlas = canvasTexture(1024, 512, (ctx) => {
    ctx.clearRect(0, 0, 1024, 512); ctx.fillStyle = '#f7f2df'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 84px Arial';
    for (let i = 0; i < 32; i++) ctx.fillText(String(i + 1), (i % 8) * 128 + 64, (3 - Math.floor(i / 8)) * 128 + 66);
  });
  const numberGeometry = save(new THREE.PlaneGeometry(0.19, 0.19));
  const atlasOffsets = new Float32Array(44 * 2); numberGeometry.setAttribute('atlasOffset', new THREE.InstancedBufferAttribute(atlasOffsets, 2));
  const numberMaterial = save(new THREE.ShaderMaterial({
    uniforms: {atlas: {value: numberAtlas}}, transparent: true, depthWrite: false,
    vertexShader: 'attribute vec2 atlasOffset; varying vec2 vUv; void main(){vUv=(uv+atlasOffset)/vec2(8.,4.);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
    fragmentShader: 'uniform sampler2D atlas;varying vec2 vUv;void main(){vec4 c=texture2D(atlas,vUv);if(c.a<0.1)discard;gl_FragColor=c;}'
  }));
  const numbers = new THREE.InstancedMesh(numberGeometry, numberMaterial, 44); numbers.frustumCulled = false; scene.add(numbers);
  const shadowTexture = canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(3,15,15,.55)'); g.addColorStop(1, 'rgba(3,15,15,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const blobMat = basic(0xffffff, {map: shadowTexture, transparent: true, depthWrite: false});
  const blobs = new THREE.InstancedMesh(boardGeometry, blobMat, 22); blobs.frustumCulled = false; scene.add(blobs);

  const footballTexture = canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#faf9e9'; ctx.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) for (let col = 0; col < 8; col++) {
      const x = col * 64 + (row % 2) * 32, y = 30 + row * 66;
      ctx.beginPath(); for (let n = 0; n < 5; n++) {const a = n / 5 * Math.PI * 2 - Math.PI / 2; const px = x + Math.cos(a) * 19, py = y + Math.sin(a) * 18; if (!n) ctx.moveTo(px, py); else ctx.lineTo(px, py);} ctx.closePath(); ctx.fillStyle = '#26323b'; ctx.fill();
      ctx.strokeStyle = '#9aa9a4'; ctx.lineWidth = 1; ctx.stroke();
    }
  });
  const ball = new THREE.Mesh(save(new THREE.SphereGeometry(0.225, 20, 12)), material(0xffffff, {map: footballTexture, roughness: 0.7, emissive: 0x10100c})); ball.castShadow = true; scene.add(ball);
  const ballShadow = new THREE.Mesh(boardGeometry, blobMat); ballShadow.rotation.x = -Math.PI / 2; scene.add(ballShadow);
  const selection = new THREE.Group(); scene.add(selection);
  const markerMat = basic(0xf3eccf, {depthTest: true});
  const ring = new THREE.Mesh(save(new THREE.RingGeometry(0.58, 0.68, 32)), markerMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.045; selection.add(ring);
  const triangleGeometry = save(new THREE.ConeGeometry(0.19, 0.3, 3)); triangleGeometry.rotateZ(Math.PI);
  const triangle = new THREE.Mesh(triangleGeometry, markerMat); triangle.position.y = 2.25; selection.add(triangle);
  const receiver = new THREE.Mesh(save(new THREE.RingGeometry(0.65, 0.9, 4)), basic(0xf4bd61, {transparent: true, opacity: 0.95})); receiver.rotation.x = -Math.PI / 2; receiver.visible = false; scene.add(receiver);
  const passEndpoint = new THREE.Mesh(save(new THREE.RingGeometry(0.35,0.45,24)),basic(0x9be6ca,{transparent:true,opacity:0.95}));passEndpoint.rotation.x=-Math.PI/2;passEndpoint.visible=false;scene.add(passEndpoint);
  const passGuideGeometry = save(new THREE.BufferGeometry());
  passGuideGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(6),3));
  const passGuide = new THREE.Line(passGuideGeometry,save(new THREE.LineDashedMaterial({color:0xf4bd61,transparent:true,opacity:0.38,dashSize:0.65,gapSize:0.65})));
  passGuide.frustumCulled=false;passGuide.visible=false;scene.add(passGuide);
  // A broad ground arrow and a raised reticle show intended aim, not predicted flight.
  // The target is shared with the simulation before its accuracy / pressure spread.
  const shotGuide = new THREE.Group(); shotGuide.visible = false; scene.add(shotGuide);
  const shotMaterial = basic(0xffc56b, {transparent: true, opacity: 0.8, depthWrite: false});
  const shotShaft = cube(0, 0, 0, 1, 0.018, 0.13, shotMaterial, shotGuide);
  const shotArrowGeometry = save(new THREE.BufferGeometry());
  shotArrowGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, -1,0,-0.5, -1,0,0.5], 3)); shotArrowGeometry.computeVertexNormals();
  const shotArrow = new THREE.Mesh(shotArrowGeometry, shotMaterial); shotGuide.add(shotArrow);
  const targetMaterial = basic(0xffdf9c, {transparent: true, opacity: 0.95, depthWrite: false, depthTest: false});
  const shotTarget = new THREE.Mesh(save(new THREE.RingGeometry(0.38, 0.47, 28)), targetMaterial); shotTarget.renderOrder = 8; shotGuide.add(shotTarget);
  const targetDot=new THREE.Mesh(save(new THREE.CircleGeometry(.045,16)),targetMaterial);targetDot.renderOrder=9;shotTarget.add(targetDot);
  const shotHeight = cube(0, 0, 0, 0.045, 1, 0.045, targetMaterial, shotGuide); shotHeight.renderOrder = 7;
  const shotFootprint = new THREE.Mesh(save(new THREE.RingGeometry(0.52, 0.6, 28)), shotMaterial); shotFootprint.rotation.x = -Math.PI / 2; shotGuide.add(shotFootprint);
  const flightGeometry=save(new THREE.BufferGeometry());
  flightGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(81*3),3));
  const flightLine=new THREE.Line(flightGeometry,save(new THREE.LineDashedMaterial({color:0x89eddf,transparent:true,opacity:.9,dashSize:.35,gapSize:.22,depthWrite:false})));
  flightLine.frustumCulled=false;shotGuide.add(flightLine);
  const shotColourLow = new THREE.Color(0x89eddf), shotColourHigh = new THREE.Color(0xffaa48);
  const nextMarker = new THREE.Mesh(save(new THREE.RingGeometry(0.42, 0.49, 4)), basic(0xe3ead8, {transparent: true, opacity: 0.55})); nextMarker.rotation.x = -Math.PI / 2; nextMarker.visible = false; scene.add(nextMarker);
  // Brief foul call-out: offender (red), fouled player (gold) and the contact spot.
  const foulMarkers = new THREE.Group(); foulMarkers.visible = false; scene.add(foulMarkers);
  const foulRed = basic(0xe8564a, {transparent: true, opacity: 0.95, depthWrite: false}), foulGold = basic(0xffd27a, {transparent: true, opacity: 0.95, depthWrite: false});
  const foulRingGeometry = save(new THREE.RingGeometry(0.72, 0.86, 32));
  const offenderRing = new THREE.Mesh(foulRingGeometry, foulRed); offenderRing.rotation.x = -Math.PI / 2; foulMarkers.add(offenderRing);
  const victimRing = new THREE.Mesh(foulRingGeometry, foulGold); victimRing.rotation.x = -Math.PI / 2; foulMarkers.add(victimRing);
  const foulSpot = new THREE.Group(); foulMarkers.add(foulSpot);
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {const bar = cube(0, 0.05, 0, 0.9, 0.02, 0.12, foulRed, foulSpot); bar.rotation.y = angle;}
  const foulPulse = new THREE.Mesh(save(new THREE.RingGeometry(0.5, 0.58, 32)), basic(0xe8564a, {transparent: true, opacity: 0.95, depthWrite: false})); foulPulse.rotation.x = -Math.PI / 2; foulPulse.position.y = 0.05; foulSpot.add(foulPulse);
  const FOUL_HIGHLIGHT_SECONDS = 3.5;
  const debugPositions = new Float32Array(22 * 6);
  const debugGeometry = save(new THREE.BufferGeometry()); debugGeometry.setAttribute('position', new THREE.BufferAttribute(debugPositions, 3));
  const debugLines = new THREE.LineSegments(debugGeometry, save(new THREE.LineBasicMaterial({color: 0x67f5d7, transparent: true, opacity: 0.7}))); debugLines.frustumCulled = false; scene.add(debugLines);
  const debugCircles = new THREE.InstancedMesh(save(new THREE.RingGeometry(0.44, 0.47, 16)), basic(0xe0a0ff), 22); debugCircles.frustumCulled = false; scene.add(debugCircles);
  const fallbackPlayers = rigs.map((_, i) => ({id: i, team: i < 11 ? 0 : 1, number: i % 11 + 1, x: (i < 11 ? -1 : 1) * (i % 11 === 0 ? 48 : 9 + Math.floor((i % 11 - 1) / 3) * 11), z: i % 11 === 0 ? 0 : ((i % 11 - 1) % 3 - 1) * 19, facing: i < 11 ? 0 : Math.PI, vx: 0, vz: 0}));

  function resize() {
    const rect = canvas.getBoundingClientRect(); width = Math.max(1, Math.round(rect.width || innerWidth)); height = Math.max(1, Math.round(rect.height || innerHeight));
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  function configure(options) {
    const quality = options.quality || 'high';
    const resolutionScale=clamp(Number.isFinite(options.resolutionScale)?options.resolutionScale:1,.65,1);
    if (quality !== lastQuality || resolutionScale!==lastScale) {
      lastQuality = quality;lastScale=resolutionScale;
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, quality === 'low' ? 1 : quality === 'medium' ? 1.35 : 1.75) * (quality === 'low' ? 0.85 : 1)*resolutionScale);
      crowdObjects[2].visible = quality !== 'low';
      crowdObjects[1].visible = quality !== 'low';
      key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
      if (key.shadow.map) {key.shadow.map.dispose(); key.shadow.map = null;}
      resize();
    }
    const shadows = options.shadows !== false && quality !== 'low';
    if (shadows !== lastShadows) {lastShadows = shadows; renderer.shadowMap.enabled = shadows; for(const mat of playerMaterials)mat.needsUpdate = true; pitch.material.needsUpdate = true;}
  }

  function render(state, options = {}) {
    const rawDt = Number.isFinite(options.dt) && options.dt > 0 ? options.dt : 1 / 60;
    const dt = clamp(rawDt, 0.001, 0.1); elapsed += dt; frame++;
    const renderAt = performance.now(), measuredDt = lastRenderAt === null ? rawDt : Math.max(0.001, (renderAt - lastRenderAt) / 1000);
    lastRenderAt = renderAt;
    lastFrame = mix(lastFrame, measuredDt * 1000, 0.05); fps = 1000 / lastFrame;
    configure(options);
    if (Math.abs(canvas.clientWidth - width) > 1 || Math.abs(canvas.clientHeight - height) > 1) resize();
    const players = state?.players?.length === 22 ? state.players : fallbackPlayers;
    cameraInfo = cameraController.update(state, options, camera.aspect);
    for (const object of televisionRoof) object.visible = cameraInfo.mode !== 'telebroadcast';
    for (let i = 0; i < 22; i++) {
      const player = players[i]; animateFootballer(rigs[i], player, dt, elapsed, state);
      const distance = Math.hypot(player.x-cameraInfo.position.x,player.z-cameraInfo.position.z,cameraInfo.position.y-1);
      // Hysteresis prevents repeated detail changes on the distance boundary.
      nearPlayers[i] = distance < (nearPlayers[i] ? 25 : 22);
      rigs[i].numbers.forEach((node, side) => {
        const at = i * 2 + side, num = clamp((player.number || i % 11 + 1) - 1, 0, 31);
        numbers.setMatrixAt(at, node.matrixWorld); atlasOffsets[at * 2] = num % 8; atlasOffsets[at * 2 + 1] = Math.floor(num / 8);
      });
      temp.position.set(player.x, 0.032, player.z); temp.rotation.set(-Math.PI / 2, 0, 0); temp.scale.set(1.4, 1.1, 1); temp.updateMatrix(); blobs.setMatrixAt(i, temp.matrix);
      if (options.debug) {
        temp.scale.set(1, 1, 1); temp.updateMatrix(); debugCircles.setMatrixAt(i, temp.matrix);
        const j = i * 6; debugPositions[j] = player.x; debugPositions[j + 1] = 0.2; debugPositions[j + 2] = player.z;
        debugPositions[j + 3] = player.targetX ?? player.x; debugPositions[j + 4] = 0.2; debugPositions[j + 5] = player.targetZ ?? player.z;
      }
    }
    playerTriangles=0;playerDrawCalls=0;
    for (const {mesh, parts,detail,shape} of batches) {
      let count=0;
      for(const part of parts) if(nearPlayers[part.playerIndex]===(detail==='near')) {
        mesh.setMatrixAt(count,part.node.matrixWorld);mesh.instanceColor.array.set(part.tint,count*3);
        if(shape==='shorts')for(const [i,side] of ['Left','Right'].entries()){
          const q=rigs[part.playerIndex].legs[i].upper.quaternion;
          mesh.geometry.attributes[`leg${side}Quaternion`].setXYZW(count,q.x,q.y,q.z,q.w);
        }
        count++;
      }
      mesh.count=count;mesh.visible=count>0;mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;
      if(shape==='shorts')for(const side of ['Left','Right'])mesh.geometry.attributes[`leg${side}Quaternion`].needsUpdate=true;
      if(count){playerDrawCalls++;playerTriangles+=mesh.geometry.index.count/3*count;}
    }
    numbers.instanceMatrix.needsUpdate = true; numberGeometry.attributes.atlasOffset.needsUpdate = true; blobs.instanceMatrix.needsUpdate = true;
    debugLines.visible = debugCircles.visible = !!options.debug && !options.menu;
    if (options.debug) {debugGeometry.attributes.position.needsUpdate = true; debugCircles.instanceMatrix.needsUpdate = true;}
    const b = state?.ball || {x: 0, y: 0.225, z: 0, vx: 0, vz: 0};
    ball.position.set(b.x, Math.max(0.225, b.y || 0), b.z);
    if(b.state==='held'&&b.owner!==null&&rigs[b.owner]?.goalkeeper)ball.position.copy(rigs[b.owner].heldBallAnchor);
    ball.rotation.x += (b.vz || 0) * dt / 0.225; ball.rotation.z -= (b.vx || 0) * dt / 0.225;
    ballShadow.position.set(ball.position.x, 0.034, ball.position.z); const shadowScale = 0.75 + Math.max(0, ball.position.y) * 0.15; ballShadow.scale.set(shadowScale, shadowScale, 1);
    const team = options.team === 1 ? 1 : 0, selected = players.find(p => p.id === state?.selected?.[team]);
    shotAimInfo = shotPreview(state, options); shotGuide.visible = !!shotAimInfo;
    if (shotAimInfo) {
      const {origin,power,kind,penalty}=shotAimInfo,points=shotTrajectory(shotAimInfo),target=kind==='normal'||penalty?shotAimInfo.target:points.at(-1), dx = target.x - origin.x, dz = target.z - origin.z;
      const length = Math.hypot(dx, dz), heading = Math.atan2(dz, dx), headLength = Math.min(1.5, length * 0.25);
      const positions=flightGeometry.attributes.position;points.forEach((p,i)=>positions.setXYZ(i,p.x,Math.max(.12,p.y),p.z));positions.needsUpdate=true;flightGeometry.setDrawRange(0,points.length);flightLine.computeLineDistances();
      shotShaft.visible=shotArrow.visible=kind==='normal'&&!penalty;
      shotHeight.visible=shotFootprint.visible=!penalty;flightLine.visible=!penalty||!!options.input?.shoot;
      shotShaft.position.set((origin.x + target.x) * 0.5, 0.075, (origin.z + target.z) * 0.5);
      shotShaft.rotation.y = -heading; shotShaft.scale.set(Math.max(0.01, length - headLength * 0.25), 0.018, 0.1 + power * 0.08);
      shotArrow.position.set(target.x, 0.087, target.z); shotArrow.rotation.y = -heading; shotArrow.scale.set(headLength, 1, 0.8 + power * 0.45);
      shotTarget.position.set(target.x, Math.max(0.2, target.y), target.z); shotTarget.scale.setScalar(penalty?.65:1 + power * 0.35);
      shotHeight.position.set(target.x, target.y / 2, target.z); shotHeight.scale.y = Math.max(0.1, target.y);
      shotFootprint.position.set(target.x, 0.07, target.z);
      shotMaterial.color.copy(shotColourLow).lerp(shotColourHigh, power); targetMaterial.color.copy(shotMaterial.color);flightLine.material.color.copy(shotMaterial.color);
    }
    selection.visible = !!selected && !options.menu && !options.replay && cameraInfo.mode!=='penalty';
    if (selected) {
      selection.position.set(selected.x, 0, selected.z); triangle.rotation.y = elapsed * 0.6;
      passAimInfo=passingPreview(state,options);
      const target=passAimInfo?players.find(p=>p.id===passAimInfo.receiverId):null,charging=!!passAimInfo&&(options.input?.passHold||options.input?.throughHold);
      passTargetId=target?.id??null;passTargetName=target?.name??null;receiver.visible=!!target;passGuide.visible=!!passAimInfo&&(!!target||charging||isManualRestart(state,team));passEndpoint.visible=!!passAimInfo&&(charging||isManualRestart(state,team));
      if (target) {
        receiver.position.set(target.x, 0.047, target.z);
        receiver.scale.setScalar(charging?1.15+passAimInfo.power*.25:1);
        receiver.material.color.setHex(charging?0x9be6ca:0xf4bd61);
      }
      if(passGuide.visible){
        const points=passGuideGeometry.attributes.position;
        points.setXYZ(0,b.x,0.07,b.z);points.setXYZ(1,passAimInfo.target.x,0.07,passAimInfo.target.z);points.needsUpdate=true;passGuide.computeLineDistances();
        passGuide.material.opacity=charging?.85:.45;passGuide.material.color.setHex(charging?0x9be6ca:0xf4bd61);
        passEndpoint.position.set(passAimInfo.target.x,.06,passAimInfo.target.z);
      }
      const switchScore = p => Math.hypot(p.x - (b.x + (b.vx || 0) * 0.23), p.z - (b.z + (b.vz || 0) * 0.23)) + (p.id === selected.id ? 3 : 0);
      const candidate = players.filter(p => p.team === team && p.role !== 'GK').sort((a, c) => switchScore(a) - switchScore(c))[0];
      nextMarker.visible = !!candidate && candidate.id !== selected.id && !options.menu && !options.replay && b.owner !== selected.id;
      if (candidate) nextMarker.position.set(candidate.x, 0.045, candidate.z);
    } else {receiver.visible = passGuide.visible = passEndpoint.visible = false;passTargetId=null;passTargetName=null;passAimInfo=null;nextMarker.visible = false;}
    const foul = state?.phase === 'restart' ? state.restart?.foul : null, foulAge = state?.phaseTime ?? Infinity;
    foulMarkers.visible = !!foul && foulAge < FOUL_HIGHLIGHT_SECONDS && !options.menu && !options.replay;
    if (foulMarkers.visible) {
      const offender = players[foul.offender], victim = players[foul.victim], fade = clamp((FOUL_HIGHLIGHT_SECONDS - foulAge) / 0.6, 0, 1);
      offenderRing.visible = !!offender; victimRing.visible = !!victim;
      if (offender) offenderRing.position.set(offender.x, 0.05, offender.z);
      if (victim) victimRing.position.set(victim.x, 0.05, victim.z);
      foulSpot.position.set(foul.x, 0, foul.z);
      const pulse = (elapsed * 1.6) % 1; foulPulse.scale.setScalar(1 + pulse * 1.4);
      foulRed.opacity = 0.95 * fade; foulGold.opacity = 0.95 * fade; foulPulse.material.opacity = 0.8 * fade * (1 - pulse);
    }
    updateBoard(state);
    if (Math.abs(camera.fov - cameraInfo.fov) > 0.001) {camera.fov = cameraInfo.fov; camera.updateProjectionMatrix();}
    camera.position.set(cameraInfo.position.x, cameraInfo.position.y, cameraInfo.position.z);
    lookAt.set(cameraInfo.target.x, cameraInfo.target.y, cameraInfo.target.z); camera.lookAt(lookAt);
    if (shotGuide.visible) shotTarget.quaternion.copy(camera.quaternion);
    renderer.render(scene, camera);
  }
  function dispose() {
    for (const resource of resources) resource.dispose?.();
    scene.traverse(object => {if (object.isInstancedMesh) object.dispose?.();}); renderer.dispose();
  }
  function stats() {return {fps: Math.round(fps), frameMs: Number(lastFrame.toFixed(1)), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles,playerTriangles,playerDrawCalls,nearPlayerModels:nearPlayers.filter(Boolean).length, pixelRatio: renderer.getPixelRatio(), quality:lastQuality,resolutionScale:lastScale,shadows:lastShadows, width, height,
    cameraMode: cameraInfo.mode, cameraFov: camera.fov, cameraPosition: {...cameraInfo.position}, cameraTarget: {...cameraInfo.target}, cameraYaw: cameraInfo.yaw, cameraPitch: cameraInfo.pitch,
    ballVisualPosition:ball.position.toArray(),keeperPresentation:[0,11].map(id=>({id,lean:rigs[id].root.rotation.z,gloveCentre:rigs[id].heldBallAnchor.toArray()})),
    cameraForward: {x: Math.cos(cameraInfo.yaw), z: Math.sin(cameraInfo.yaw)}, hiddenPlayerId: null, cameraHeight: cameraInfo.height, cameraZoom: cameraInfo.zoom, passTargetId,passTargetName,passCharge:passAimInfo?.power??0,passAimTarget:passAimInfo?{...passAimInfo.target}:null,
    shotAimVisible: shotGuide.visible, shotAimKind:shotAimInfo?.kind??null, shotAimCurl:shotAimInfo?.curl??0, shotAimPath:shotAimInfo?shotTrajectory(shotAimInfo):null, shotAimTarget: shotAimInfo ? {...shotAimInfo.target} : null, shotAimOrigin: shotAimInfo ? {...shotAimInfo.origin} : null, shotAimPower: shotAimInfo?.power ?? 0};}
  resize(); updateBoard(null);
  return {render, resize, dispose, stats, audioView:()=>cameraInfo, prepareInput: cameraController.prepareInput};
}
