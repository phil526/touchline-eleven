import * as THREE from 'three';

// Original, metre-scale sculpted surfaces. Ring profiles keep the silhouette
// continuous while sharing geometry between every player and both camera modes.
function surface(rings, segments, {start = -Math.PI, sweep = Math.PI * 2, shade, deform, caps = true} = {}) {
  const positions = [], colours = [], uv = [], indices = [], stride = segments + 1;
  const bottom = rings[0][0], height = rings.at(-1)[0] - bottom;
  rings.forEach(([y, rx, rz, z = 0, tone = 1], row) => {
    for (let column = 0; column <= segments; column++) {
      const u = column / segments, angle = start + sweep * u;
      const point = {x: Math.sin(angle) * rx, y, z: Math.cos(angle) * rz + z};
      deform?.(point, angle, row);
      positions.push(point.x, point.y, point.z); uv.push(u, (y - bottom) / height);
      const value = shade ? shade(y, angle, tone) : tone;
      colours.push(value, value, value);
      if (row < rings.length - 1 && column < segments) {
        const a = row * stride + column, b = a + stride;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  });
  if (caps && sweep === Math.PI * 2) {
    for (const row of [0, rings.length - 1]) {
      const [y, rx, rz, z = 0, tone = 1] = rings[row], centre = positions.length / 3;
      positions.push(0, y, z); colours.push(tone, tone, tone); uv.push(.5, .5);
      for (let j = 0; j <= segments; j++) {
        const angle = start + Math.PI * 2 * j / segments;
        positions.push(Math.sin(angle) * rx, y, Math.cos(angle) * rz + z);
        colours.push(tone, tone, tone); uv.push(j / segments, row ? 1 : 0);
        if (j < segments) {
          const a = centre + 1 + j, b = a + 1;
          indices.push(...(row === 0 ? [centre, b, a] : [centre, a, b]));
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  // The duplicated UV seam must share a normal, otherwise the back is creased.
  if (sweep === Math.PI * 2) {
    const normal = geometry.attributes.normal, average = new THREE.Vector3();
    for (let row = 0; row < rings.length; row++) {
      const a = row * stride, b = a + segments;
      average.set(normal.getX(a) + normal.getX(b), normal.getY(a) + normal.getY(b), normal.getZ(a) + normal.getZ(b)).normalize();
      normal.setXYZ(a, average.x, average.y, average.z); normal.setXYZ(b, average.x, average.y, average.z);
    }
  }
  geometry.computeBoundingSphere(); return geometry;
}

const shirt = [
  [0, .158, .105, 0, .81], [.018, .164, .11, 0, .98], [.09, .157, .105],
  [.19, .17, .118], [.29, .192, .128], [.36, .211, .119],
  [.405, .192, .105], [.449, .091, .067], [.46, .069, .059, 0, .76]
];
const head = [
  [-.128, .028, .034, .018, .76], [-.116, .054, .057, .014, .9],
  [-.085, .078, .074, .006], [-.041, .092, .088], [.012, .096, .096],
  [.06, .091, .098, -.004], [.102, .073, .082, -.009],
  [.131, .04, .048, -.01], [.141, .004, .005, -.01]
];

function shortsGeometry(segments) {
  const positions=[],colours=[],uv=[],indices=[],sides=[],weights=[];
  const rings=[[-.28,.096,.088,0,1,.86],[-.265,.099,.092,0,1,1],[-.19,.101,.099,.35,.8,1],[-.12,.103,.106,1,0,1],[-.055,.1,.113,1,0,1],[.005,.1,.115,1,0,1],[.095,.1,.106,1,0,.94]];
  for(const side of [-1,1]) {
    const base=positions.length/3;
    rings.forEach(([y,radius,depth,join,weight,tone],row)=>{
      for(let j=0;j<=segments;j++){
        const a=j/segments*Math.PI*2,sin=Math.sin(a),cos=Math.cos(a);
        // Each leg opening blends into half of the common waistband. The
        // inside surfaces meet at the crotch instead of stacking rigid tubes.
        const circular=.104+sin*radius,waist=Math.max(0,sin)*(row===6?.16:.183);
        positions.push(side*(circular*(1-join)+waist*join),y,cos*depth);
        colours.push(tone,tone,tone);uv.push(j/segments,(y+.28)/.345);sides.push(side);weights.push(weight);
        if(row<rings.length-1&&j<segments){const a=base+row*(segments+1)+j,b=a+segments+1;
          indices.push(...(side===1?[a,a+1,b,a+1,b+1,b]:[a,b,a+1,a+1,b,b+1]));}
      }
    });
  }
  const geometry=new THREE.BufferGeometry();
  for(const [name,array,size] of [['position',positions,3],['color',colours,3],['uv',uv,2],['legSide',sides,1],['legWeight',weights,1]])geometry.setAttribute(name,new THREE.Float32BufferAttribute(array,size));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();return geometry;
}

// Two visual hip rotations bend the garment with the legs. The shared match
// state and its collision model are never read or altered by this shader.
export function bendShortsMaterial(material) {
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec4 legLeftQuaternion;
      attribute vec4 legRightQuaternion;
      attribute float legSide;
      attribute float legWeight;
      vec3 rotateLeg(vec3 p,vec4 q){return p+2.0*cross(q.xyz,cross(q.xyz,p)+q.w*p);}
    `).replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      vec4 normalLeg=legSide<0.0?legLeftQuaternion:legRightQuaternion;
      objectNormal=normalize(mix(objectNormal,rotateLeg(objectNormal,normalLeg),legWeight));
    `).replace('#include <begin_vertex>',`#include <begin_vertex>
      vec4 bendLeg=legSide<0.0?legLeftQuaternion:legRightQuaternion;
      vec3 hip=vec3(legSide*.104,-.09,0.0);
      transformed=mix(position,rotateLeg(position-hip,bendLeg)+hip,legWeight);
    `);
  };
  material.customProgramCacheKey=()=> 't11-continuous-shorts-v1';return material;
}

export function createPlayerGeometries(detail = 'near') {
  const n = detail === 'near' ? 20 : 10, limb = detail === 'near' ? 12 : 8;
  const shapes = {};
  const add = (name, rings, segments = limb, options) => shapes[name] = surface(rings, segments, options);
  add('jersey', shirt, n, {deform(p, angle) {
    // Small sewn-in folds around the hem, rather than rigid straight sides.
    const fold = Math.sin(angle * 7 + p.y * 29) * .0028 * Math.max(0, 1 - p.y / .22);
    p.x += Math.sin(angle) * fold; p.z += Math.cos(angle) * fold;
  }});
  add('shirtStripe', [[.028,.165,.113],[.095,.16,.109],[.19,.173,.122],[.29,.195,.132],[.37,.21,.12],[.407,.19,.107]], 4, {start:-.64,sweep:.19,caps:false});
  add('shirtBand', [[.255,.187,.129],[.29,.195,.132]], n, {caps:false});
  shapes.shorts=shortsGeometry(n);
  add('sleeve', [[-.148,.061,.059,0,.84],[-.137,.066,.064],[-.055,.073,.071],[.006,.069,.063],[.035,.025,.027]], limb);
  add('upperArm', [[-.295,.039,.039],[-.255,.044,.043],[-.2,.056,.052],[-.125,.057,.053],[-.08,.045,.044]], limb);
  add('forearm', [[-.237,.03,.027],[-.215,.033,.03],[-.16,.04,.035],[-.075,.05,.043],[-.015,.043,.04],[.012,.03,.032]], limb);
  add('hand', [[-.06,.019,.013],[-.047,.033,.018],[-.012,.036,.022],[.027,.03,.021],[.051,.021,.019]], limb);
  add('thigh', [[-.405,.052,.055,0,.88],[-.365,.059,.064],[-.29,.075,.08],[-.21,.086,.085],[-.12,.088,.084],[-.08,.08,.075]], limb);
  add('sock', [[-.407,.034,.038],[-.36,.037,.042],[-.27,.05,.055,-.005],[-.19,.065,.067,-.009],[-.1,.066,.062],[-.06,.058,.056,0,.84],[-.045,.058,.056]], limb);
  add('sockBand', [[-.078,.059,.058],[-.06,.06,.058]], limb, {caps:false});
  add('collar', [[.446,.07,.06,0,.7],[.452,.077,.064],[.467,.072,.062]], n, {caps:false});
  add('head', head, n);
  for (const [name, lift, ridge] of [['crop',0,.001],['sweep',.017,.004],['curls',.012,.006]]) {
    add(name, [[-.053,.084,.088,-.007],[0,.099,.101,-.006],[.063,.096,.103,-.006],[.108,.078,.087,-.01],[.139,.04,.051,-.012],[.146,.003,.006,-.012]], n, {
      deform(p, angle, row) {
        const front = Math.max(0, Math.cos(angle)), t = [0,.3,.6,.83,.96,1][row];
        // Interpolate the scalp from a nape/temple/forehead hairline to the
        // crown. Both the near and far mesh follow the same head surface.
        const hairline = -.053 + front * .112 + Math.abs(Math.sin(angle)) * .018;
        const scalpY = hairline + (.141 - hairline) * t;
        let upper = head.findIndex(r => r[0] >= scalpY);
        if (upper < 0) upper = head.length-1; else if (upper === 0) upper = 1;
        const a = head[upper-1], b = head[upper], blend = (scalpY-a[0])/(b[0]-a[0]);
        const clearance=.01+ridge;
        p.x = Math.sin(angle) * (a[1]+(b[1]-a[1])*blend+clearance);
        p.z = Math.cos(angle) * (a[2]+(b[2]-a[2])*blend+clearance)+(a[3]||0)+((b[3]||0)-(a[3]||0))*blend;
        p.y = scalpY + .003 + lift*t*(1-Math.abs(Math.sin(angle))*.5);
        const wave = Math.sin(angle * (name === 'curls' ? 13 : 6) + row * 2.7) * ridge;
        p.x += Math.sin(angle) * wave; p.z += Math.cos(angle) * wave;
      },caps:false,shade(y,a){return .8 + .2 * Math.abs(Math.sin(a * 9 + y * 31));}
    });
  }
  add('boot', [[-.0375,.05,.118,.061,.23],[-.023,.06,.128,.063,.32],[-.013,.061,.129,.063],
    [.018,.059,.123,.061],[.039,.051,.092,.039],[.064,.036,.049,.003],[.075,.026,.037,-.006,.65]], n);
  const sphere = new THREE.SphereGeometry(1, limb, detail === 'near' ? 10 : 6);
  sphere.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(sphere.attributes.position.count * 3).fill(1),3));
  shapes.round = sphere;
  return shapes;
}

// Self-hosted procedural maps: no player likeness or external texture requests.
export function createPlayerTextures(canvasTexture) {
  const fabric = canvasTexture(128,128,(ctx,w,h) => {
    ctx.fillStyle='#fafafa';ctx.fillRect(0,0,w,h);
    for(let y=0;y<h;y+=2){ctx.fillStyle=y%4?'#f7f7f7':'#f5f5f5';ctx.fillRect(0,y,w,1);}
    for(let x=0;x<w;x+=3){ctx.fillStyle='rgba(100,100,100,.025)';ctx.fillRect(x,0,1,h);}
  });
  const face = canvasTexture(512,512,(ctx,w,h) => {
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
    // Narrow eyes and soft brows sit on the shaped cheek/jaw mesh.
    for(const u of [.429,.571]){
      const x=u*w,y=.445*h;
      let g=ctx.createRadialGradient(x,y,1,x,y,23);g.addColorStop(0,'rgba(62,39,32,.19)');g.addColorStop(1,'rgba(62,39,32,0)');ctx.fillStyle=g;ctx.fillRect(x-25,y-25,50,50);
      ctx.fillStyle='#cabbae';ctx.beginPath();ctx.ellipse(x,y,10,4.2,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#28231f';ctx.beginPath();ctx.ellipse(x,y,3.4,4,0,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#6c5647';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(x-12,y-15);ctx.quadraticCurveTo(x,y-19,x+12,y-15);ctx.stroke();
    }
    ctx.strokeStyle='rgba(80,45,35,.55)';ctx.lineWidth=2.2;ctx.beginPath();ctx.moveTo(245,395);ctx.quadraticCurveTo(256,400,267,395);ctx.stroke();
    ctx.fillStyle='rgba(76,45,31,.4)';for(const x of [250,262]){ctx.beginPath();ctx.ellipse(x,343,2.5,1.5,0,0,Math.PI*2);ctx.fill();}
    // A restrained beard shadow; tiny marks stay soft through texture mipmaps.
    for(let i=0;i<380;i++){const x=218+(i*37%77),y=371+(i*53%78);const dx=(x-256)/39,dy=(y-399)/54;
      if(dx*dx+dy*dy<1&&!(Math.abs(x-256)<16&&y<405)){ctx.fillStyle='rgba(61,43,33,.065)';ctx.fillRect(x,y,1,2);}}
  });
  return {fabric,face};
}
