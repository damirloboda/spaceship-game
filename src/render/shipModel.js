// The starter explorer ship "Pathfinder": exterior hull plus a walkable
// interior (cockpit, quarters, lab, galley, technical bay with the engine
// compartment and Nitro slot, cargo hold and rear hatch).
// Ship-local axes: forward = -Z, up = +Y, interior deck at y = 0.
import * as THREE from 'three';
import { colorize, merge } from './models.js';
import { createFieldMaterial, createExhaustMaterial } from './shaders.js';
import { texture } from './textures.js';
import { staticInstance, SHIP_MODEL } from './modelLib.js';

export const INTERIOR = { minX: -3.2, maxX: 3.2, minZ: -10.8, maxZ: 10.8, height: 2.8 };
export const GEAR_HEIGHT = 2.6; // distance from deck (y=0) to the ground when landed
export const RAMP_EXIT = new THREE.Vector3(-5.5, -GEAR_HEIGHT, -7.5); // where the player steps off (port side, by the cockpit)
export const EXIT_FACING = new THREE.Vector3(-1, 0, 0);
export const RAMP_OPEN = 0.42;
// Placement of the hand-made hull model in ship space.
export const SHIP_SHELL = { length: 38, offset: new THREE.Vector3(0, -1.4, -1.5) };
export const RAMP_CLOSED = 0.0;


// ---- geometry helpers for the hull ----
function octagon(w, t, b, ct, cb, x0 = 0) {
  ct = Math.min(ct, w * 0.45, (t - b) * 0.3);
  cb = Math.min(cb, w * 0.45, (t - b) * 0.3);
  return [[-w + ct, t], [w - ct, t], [w, t - ct], [w, b + cb], [w - cb, b], [-w + cb, b], [-w, b + cb], [-w, t - ct]].map(([x, y]) => [x + x0, y]);
}

function pushTri(arr, a, b, c) { arr.push(...a, ...b, ...c); }

// Loft octagonal sections [z, halfWidth, top, bottom] into a faceted hull.
function loft(sections, { capStart = false, capEnd = false, topChamfer = 0.8, bottomChamfer = 1.0, x0 = 0 } = {}) {
  const rings = sections.map(([z, w, t, b]) => octagon(w, t, b, topChamfer, bottomChamfer, x0).map(([x, y]) => [x, y, z]));
  const pos = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let k = 0; k < 8; k++) {
      const a = A[k], b = A[(k + 1) % 8], c = B[(k + 1) % 8], d = B[k];
      pushTri(pos, a, d, c);
      pushTri(pos, a, c, b);
    }
  }
  const cap = (ring, flip) => {
    const cx = ring.reduce((s, p) => s + p[0], 0) / 8, cy = ring.reduce((s, p) => s + p[1], 0) / 8, cz = ring[0][2];
    for (let k = 0; k < 8; k++) {
      const a = ring[k], b = ring[(k + 1) % 8], m = [cx, cy, cz];
      if (flip) pushTri(pos, m, b, a); else pushTri(pos, m, a, b);
    }
  };
  if (capStart) cap(rings[0], false);
  if (capEnd) cap(rings[rings.length - 1], true);
  return finishFlat(pos, sections, x0);
}

// Non-indexed geometry with flat normals, oriented outward from the axis.
function finishFlat(pos, sections, x0 = 0) {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array(pos);
  // Orient every triangle away from the loft axis (robust to section order).
  const midY = sections ? sections.reduce((s, q) => s + (q[2] + q[3]) / 2, 0) / sections.length : 1;
  for (let i = 0; i < arr.length; i += 9) {
    const ax = arr[i], ay = arr[i + 1], az = arr[i + 2];
    const e1 = [arr[i + 3] - ax, arr[i + 4] - ay, arr[i + 5] - az], e2 = [arr[i + 6] - ax, arr[i + 7] - ay, arr[i + 8] - az];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cx = (ax + arr[i + 3] + arr[i + 6]) / 3 - x0, cy = (ay + arr[i + 4] + arr[i + 7]) / 3 - midY;
    const cz = (az + arr[i + 5] + arr[i + 8]) / 3;
    const zc = sections ? (sections[0][0] + sections[sections.length - 1][0]) / 2 : 0;
    let out = n[0] * cx + n[1] * cy;
    if (Math.abs(out) < 1e-6 * Math.hypot(...n)) out = n[2] * (cz - zc);
    if (out < 0) {
      for (let k = 0; k < 3; k++) { const tmp = arr[i + 3 + k]; arr[i + 3 + k] = arr[i + 6 + k]; arr[i + 6 + k] = tmp; }
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// Canopy sections [z, halfWidth, top] sitting on the nose deck (y = 1.4).
function canopyLoft(sections) {
  const deck = 1.4;
  const rings = sections.map(([z, w, t]) => {
    const ym = deck + (t - deck) * 0.55;
    return [[-w, deck], [w, deck], [w * 1.02, ym], [w * 0.55, t], [-w * 0.55, t], [-w * 1.02, ym]].map(([x, y]) => [x, y, z]);
  });
  const pos = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let k = 1; k < 6; k++) { // skip the bottom edge (sits on the deck)
      const a = A[k], b = A[(k + 1) % 6], c = B[(k + 1) % 6], d = B[k];
      pushTri(pos, a, d, c);
      pushTri(pos, a, c, b);
    }
  }
  const secs = sections.map(([z, w, t]) => [z, w, t, deck]);
  return finishFlat(pos, secs, 0);
}

// Bevelled planform extrusion. points are [x, z] pairs in the wing plane.
function wingShape(points, depth, bevel = 0.08) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

function colorByHeight(geo, top, bottom, split) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const a = new THREE.Color(...top).convertSRGBToLinear(), b = new THREE.Color(...bottom).convertSRGBToLinear();
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.smoothstep(p.getY(i), split - 0.25, split + 0.25);
    c.copy(b).lerp(a, t);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Box-projected UVs per triangle (for tiling panel textures).
function boxUV(geo, scale) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      let u, w;
      if (ax >= ay && ax >= az) { u = v.z; w = v.y; } else if (ay >= az) { u = v.x; w = v.z; } else { u = v.x; w = v.y; }
      uv[(i + k) * 2] = u * scale;
      uv[(i + k) * 2 + 1] = w * scale;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Procedural instrument graphics for cockpit screens.
function screenTexture(kind, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 112;
  const g = c.getContext('2d');
  g.fillStyle = '#04080c'; g.fillRect(0, 0, 256, 112);
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 2; g.globalAlpha = 0.9;
  if (kind === 'radar') {
    for (const r of [16, 32, 48]) { g.beginPath(); g.arc(128, 56, r, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(128, 56); g.lineTo(170, 26); g.stroke();
    for (const [x, y] of [[150, 40], [100, 70], [140, 80]]) g.fillRect(x, y, 4, 4);
  } else if (kind === 'bars') {
    for (let i = 0; i < 8; i++) { const hgt = 20 + ((i * 37) % 60); g.fillRect(20 + i * 28, 100 - hgt, 18, hgt); }
  } else {
    g.beginPath();
    for (let x = 0; x < 256; x += 4) g.lineTo(x, 56 + Math.sin(x * 0.06) * 24 + Math.sin(x * 0.21) * 8);
    g.stroke();
    g.font = '16px monospace'; g.fillText('LB CORE', 10, 20);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(w, h, d, x, y, z, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return colorize(g, color);
}

export function buildShip(colorRGB = [0.88, 0.9, 0.92]) {
  const root = new THREE.Group();
  root.name = 'ship';
  const exterior = new THREE.Group();
  const interior = new THREE.Group();
  root.add(exterior, interior);

  // ---------- Exterior ----------
  // Faceted fighter hull lofted through octagonal sections, a glass canopy over
  // the cockpit, bevelled delta wings, weapon pods and twin engine bells.
  const hull = [];
  const white = colorRGB, dark = [0.2, 0.21, 0.24], accent = [1.0, 0.72, 0.1], mid = [0.55, 0.57, 0.6];
  const main = loft([
    [-7.6, 3.95, 3.45, -0.95], [-4, 4.2, 3.55, -1.0], [2, 4.4, 3.45, -1.0], [8, 4.25, 3.35, -0.95],
    [11.2, 3.9, 3.1, -0.7], [12.8, 3.3, 2.7, -0.3],
  ], { capEnd: true });
  hull.push(colorByHeight(main, white, dark, 0.2));
  const nose = loft([
    [-19.5, 0.25, 0.95, 0.55], [-17.5, 1.6, 1.3, -0.1], [-14.5, 3.2, 1.4, -0.75], [-11.5, 3.85, 1.4, -0.95], [-7.4, 3.95, 1.4, -0.95],
  ], { capStart: true, topChamfer: 0.35 });
  hull.push(colorByHeight(nose, white, dark, 0.3));
  // Accent stripes along the flanks
  for (const side of [-1, 1]) {
    const stripe = new THREE.BoxGeometry(0.06, 0.28, 18);
    stripe.translate(side * 4.43, 1.25, 2);
    hull.push(colorize(stripe, accent));
    const chev = new THREE.BoxGeometry(0.06, 0.18, 6);
    chev.translate(side * 3.9, 1.0, -13);
    chev.rotateY(side * 0.12);
    hull.push(colorize(chev, accent));
  }
  // Spine, fins, vents, sensor dome, antenna
  const spine = new THREE.BoxGeometry(1.2, 0.5, 14);
  spine.translate(0, 3.7, 3);
  hull.push(colorize(spine, mid));
  for (const side of [-1, 1]) {
    const fin = wingShape([[0, 0], [5.5, 0], [6.8, 3.4], [5.2, 3.4]], 0.28);
    fin.rotateY(-Math.PI / 2); fin.rotateZ(side * -0.25);
    fin.translate(side * 1.6, 3.4, 5.2);
    hull.push(colorize(fin, white));
    const finTip = new THREE.BoxGeometry(0.3, 0.2, 1.6);
    finTip.translate(side * 2.45, 6.75, 10.9);
    hull.push(colorize(finTip, accent));
  }
  for (let i = 0; i < 5; i++) {
    const vent = new THREE.BoxGeometry(0.9, 0.08, 0.35);
    vent.translate(0, 3.98, -1 + i * 0.6);
    hull.push(colorize(vent, dark));
  }
  const dome = new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 3.95, 9.5);
  hull.push(colorize(dome, dark));
  const ant = new THREE.CylinderGeometry(0.03, 0.05, 2.2, 5);
  ant.translate(0.8, 4.9, 7.5);
  hull.push(colorize(ant, mid));
  // Delta wings with bevelled edges
  for (const side of [-1, 1]) {
    const mirror = (pts) => (side > 0 ? pts : pts.map(([x, z]) => [-x, z]).reverse());
    const wing = wingShape(mirror([[0, -2.5], [0, 9], [10.5, 10.2], [11.5, 7.6], [6, 1.5]]), 0.55, 0.12);
    wing.rotateX(Math.PI / 2);
    wing.translate(side * 3.9, 0.9, 0);
    hull.push(colorize(wing, white));
    const wingStripe = wingShape(mirror([[0.2, 7.6], [0.2, 8.6], [10.8, 9.9], [11.1, 8.9]]), 0.6, 0.02);
    wingStripe.rotateX(Math.PI / 2);
    wingStripe.translate(side * 3.9, 0.92, 0);
    hull.push(colorize(wingStripe, accent));
    const winglet = wingShape([[0, 0], [3.2, 0], [3.8, 2.4], [2.4, 2.4]], 0.25, 0.06);
    winglet.rotateY(-Math.PI / 2);
    winglet.translate(side * 15.3, 0.9, 7.8);
    hull.push(colorize(winglet, dark));
    // Weapon pod with twin barrels under each wing
    const pod = new THREE.CylinderGeometry(0.55, 0.65, 6, 10);
    pod.rotateX(Math.PI / 2); pod.translate(side * 8.2, 0.3, 3.2);
    hull.push(colorize(pod, dark));
    const podNose = new THREE.ConeGeometry(0.55, 1.6, 10);
    podNose.rotateX(-Math.PI / 2); podNose.translate(side * 8.2, 0.3, -0.6);
    hull.push(colorize(podNose, mid));
    for (const dx of [-0.22, 0.22]) {
      const barrel = new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8);
      barrel.rotateX(Math.PI / 2); barrel.translate(side * 8.2 + dx, 0.3, -2.6);
      hull.push(colorize(barrel, [0.12, 0.12, 0.14]));
    }
    // Engine nacelle feeding the rear bells
    const nac = loft([[8, 1.35, 2.5, -0.2], [11, 1.5, 2.6, -0.3], [13.2, 1.45, 2.5, -0.2]], { capStart: true, x0: side * 2.5, topChamfer: 0.5 });
    hull.push(colorize(nac, mid));
  }
  const hullMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.5, metalness: 0.35,
    map: texture('hull_diff.jpg', { srgb: true }), normalMap: texture('hull_nor.jpg'), roughnessMap: texture('hull_rough.jpg'),
    normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: 1.2,
  });
  const hullGeo = merge(hull);
  boxUV(hullGeo, 0.22);
  const hullMesh = new THREE.Mesh(hullGeo, hullMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  exterior.add(hullMesh);
  // Engine bells (lathe) with glowing throats
  const bellGeo = new THREE.LatheGeometry([new THREE.Vector2(1.05, 0), new THREE.Vector2(1.25, 0.6), new THREE.Vector2(1.45, 1.6), new THREE.Vector2(1.5, 2.2), new THREE.Vector2(1.38, 2.25)], 20);
  bellGeo.rotateX(Math.PI / 2);
  const bellMat = new THREE.MeshStandardMaterial({ color: 0x3a3c42, metalness: 0.9, roughness: 0.3, side: THREE.DoubleSide, envMapIntensity: 1.3 });
  for (const side of [-1, 1]) {
    const bell = new THREE.Mesh(bellGeo, bellMat);
    bell.position.set(side * 2.5, 1.15, 13.1);
    exterior.add(bell);
  }
  // Glass canopy over the cockpit (reflective, see-through from inside)
  const canopyGeo = canopyLoft([[-16.8, 0.5, 1.7], [-14, 2.9, 2.85], [-10.8, 3.75, 3.45], [-7.6, 3.95, 3.55], [-6.4, 3.4, 3.45]]);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0d2233, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.45, envMapIntensity: 2.0 });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  exterior.add(canopy);
  const frameGeo = merge([-14, -10.8, -7.6].map((z) => colorize(new THREE.TorusGeometry(1, 0.05, 4, 8, Math.PI).scale(z < -12 ? 2.95 : 3.8, 2.0, 1).translate(0, 1.4, z), dark)));
  const frameMesh = new THREE.Mesh(frameGeo, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.8, roughness: 0.4 }));
  exterior.add(frameMesh);
  // Hand-made hull model (falls back to the procedural hull above).
  const legacyHull = [hullMesh, canopy, frameMesh, ...exterior.children.filter((o) => o.geometry === bellGeo)];
  const shell = staticInstance(SHIP_MODEL, SHIP_SHELL.length, { byLength: true, yaw: Math.PI });
  if (shell) {
    for (const o of legacyHull) o.visible = false;
    shell.position.copy(SHIP_SHELL.offset);
    shell.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      o.material.metalness = 0.35;
      o.material.roughness = 0.45;
      o.material.envMapIntensity = 1.4;
    });
    exterior.add(shell);
  }
  // Engine glow and exhaust
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.6, 1.0).multiplyScalar(0.9), toneMapped: false });
  const flameMat = createExhaustMaterial([0.3, 0.62, 1.0]);
  const flames = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.CircleGeometry(1.08, 20), glowMat);
    g.position.set(side * 2.5, 1.15, 13.25);
    exterior.add(g);
    const f = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 0.15, 9, 20, 6, true).rotateX(-Math.PI / 2).translate(0, 0, 4.5), flameMat);
    f.position.set(side * 2.5, 1.15, 15.2);
    exterior.add(f);
    flames.push(f);
  }
  // Landing gear
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.5, metalness: 0.7 });
  const gear = new THREE.Group();
  for (const [x, z] of [[0, -12], [-3.4, 6.5], [3.4, 6.5]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.7, 8), gearMat);
    leg.position.set(x, -1.7, z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 10), gearMat);
    foot.position.set(x, -2.5, z);
    gear.add(leg, foot);
  }
  exterior.add(gear);
  // Belly ramp between the engines (opens when landed)
  const ramp = new THREE.Group();
  ramp.position.set(0, -1.0, 8.2);
  const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 4.2).translate(0, 0, 2.1), gearMat);
  ramp.add(rampMesh);
  exterior.add(ramp);
  // Navigation lights
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  navR.position.set(-15.3, 3.4, 9.5);
  const navG = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0x20ff40 }));
  navG.position.set(15.3, 3.4, 9.5);
  exterior.add(navR, navG);
  if (shell) {
    // Engines of the hand-made hull sit further back and wider apart.
    // Two main engines in the tail plus two wing nacelles.
    const glows = exterior.children.filter((o) => o.material === glowMat);
    glows.forEach((o, i) => { o.position.set((i % 2 ? 1 : -1) * 3, 1.7, 17.45); o.scale.setScalar(0.95); });
    flames.forEach((f, i) => { f.position.set((i % 2 ? 1 : -1) * 3, 1.7, 19.4); f.userData.base = 1.15; });
    for (const side of [-1, 1]) {
      const g = glows[0].clone();
      g.position.set(side * 14.5, 2.4, 12.15);
      g.scale.setScalar(0.7);
      exterior.add(g);
      const f = flames[0].clone();
      f.position.set(side * 14.5, 2.4, 13.6);
      f.userData = { base: 0.7 };
      exterior.add(f);
      flames.push(f);
    }
    navR.position.set(-16.6, 0.2, 12); navG.position.set(16.6, 0.2, 12);
    ramp.visible = false;
  }
  // Energy field for Overdrive / Lightbreak
  const fieldMat = createFieldMaterial();
  const field = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), fieldMat);
  field.scale.set(20, 10, 30);
  field.position.set(0, 1.2, 0);
  field.visible = false;
  field.renderOrder = 10;
  exterior.add(field);

  // ---------- Interior ----------
  const I = INTERIOR;
  const wallC = [0.78, 0.8, 0.83], floorC = [0.28, 0.3, 0.34], trimC = [0.95, 0.5, 0.15], darkC = [0.2, 0.22, 0.25];
  const parts = [];
  const colliders = [];
  const solid = (w, h, d, x, y, z, c, collide = true) => {
    parts.push(box(w, h, d, x, y, z, c));
    if (collide) colliders.push({ min: [x - w / 2, y - h / 2, z - d / 2], max: [x + w / 2, y + h / 2, z + d / 2] });
  };
  const L = I.maxZ - I.minZ;
  solid(I.maxX - I.minX + 0.4, 0.2, L + 0.4, 0, -0.1, 0, floorC);
  solid(I.maxX - I.minX + 0.4, 0.2, L + 0.4, 0, I.height + 0.1, 0, wallC, false);
  solid(0.2, I.height, L, I.minX - 0.1, I.height / 2, 0, wallC);
  solid(0.2, I.height, L, I.maxX + 0.1, I.height / 2, 0, wallC);
  // Front: low console wall with window above (window is transparent glass)
  solid(I.maxX - I.minX, 0.85, 0.3, 0, 0.425, I.minZ - 0.15, darkC);
  // Rear wall with hatch opening in the middle (x -0.9..0.9)
  solid(2.3, I.height, 0.2, -2.05, I.height / 2, I.maxZ + 0.1, wallC);
  solid(2.3, I.height, 0.2, 2.05, I.height / 2, I.maxZ + 0.1, wallC);
  solid(1.8, 0.6, 0.2, 0, I.height - 0.3, I.maxZ + 0.1, wallC);
  // Partitions with door gaps (x -0.8..0.8)
  for (const z of [-7, 2, 8]) {
    solid(2.4, I.height, 0.15, -2.0, I.height / 2, z, wallC);
    solid(2.4, I.height, 0.15, 2.0, I.height / 2, z, wallC);
    solid(1.6, 0.5, 0.15, 0, I.height - 0.25, z, wallC, false);
    parts.push(box(1.7, 0.08, 0.2, 0, I.height - 0.5, z, trimC));
  }
  // Cockpit: seat and consoles
  solid(0.9, 0.5, 0.9, 0, 0.25, -9.1, darkC);
  solid(0.9, 1.1, 0.2, 0, 0.95, -8.6, darkC, false);
  solid(1.2, 0.8, 0.9, -2.3, 0.4, -9.8, darkC);
  solid(1.2, 0.8, 0.9, 2.3, 0.4, -9.8, darkC);
  // Quarters (left): bed and locker
  solid(1.8, 0.5, 2.6, -2.2, 0.25, -4.4, [0.35, 0.4, 0.55]);
  parts.push(box(1.7, 0.15, 2.5, -2.2, 0.55, -4.4, [0.85, 0.85, 0.9]));
  solid(0.8, 2.0, 0.8, -2.7, 1.0, -1.6, [0.55, 0.58, 0.62]);
  // Lab (right): bench and analyser
  solid(1.2, 0.9, 3.0, 2.5, 0.45, -4.2, [0.85, 0.88, 0.9]);
  // Galley (left, aft of quarters)
  solid(1.0, 0.95, 2.2, -2.6, 0.475, 0.4, [0.6, 0.5, 0.42]);
  // Technical bay: engine block in the centre-aft
  solid(2.2, 2.0, 1.8, 0, 1.0, 6.4, [0.3, 0.32, 0.36]);
  parts.push(box(2.25, 0.2, 1.85, 0, 1.4, 6.4, trimC));
  // Workbench right side
  solid(1.0, 0.9, 2.0, 2.65, 0.45, 5.4, [0.5, 0.45, 0.38]);
  // Cargo crates
  solid(1.1, 1.1, 1.1, -2.5, 0.55, 9.5, [0.55, 0.45, 0.25]);
  solid(1.1, 0.9, 1.1, 2.5, 0.45, 9.6, [0.35, 0.45, 0.3]);
  // Floor trim lights
  const lights = [];
  for (let z = -10; z <= 10; z += 2.5) {
    lights.push(box(0.1, 0.03, 1.2, -1.2, 0.02, z, [1, 1, 1]));
    lights.push(box(0.1, 0.03, 1.2, 1.2, 0.02, z, [1, 1, 1]));
  }
  lights.push(box(2.0, 0.05, 0.3, 0, I.height - 0.02, -5, [1, 1, 1]));
  lights.push(box(2.0, 0.05, 0.3, 0, I.height - 0.02, 1, [1, 1, 1]));
  lights.push(box(2.0, 0.05, 0.3, 0, I.height - 0.02, 5, [1, 1, 1]));
  const intMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
  const intMesh = new THREE.Mesh(merge(parts), intMat);
  intMesh.receiveShadow = true;
  interior.add(intMesh);
  const stripMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0, emissive: new THREE.Color(0.6, 0.85, 1.0), emissiveIntensity: 1.5 });
  interior.add(new THREE.Mesh(merge(lights), stripMat));
  // Cockpit window (inside view)
  // Unlit tinted glass: very glossy PBR glass produced NaNs that bloom smeared across the screen.
  const windowMat = new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(I.maxX - I.minX, 1.95), windowMat);
  win.position.set(0, 1.83, I.minZ - 0.1);
  interior.add(win);
  // Console screens
  const screenMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.0), toneMapped: false });
  for (const [x, z] of [[-2.3, -9.35], [2.3, -9.35], [0, -8.49]]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.4), screenMat);
    s.position.set(x, x === 0 ? 1.2 : 0.9, z);
    s.rotation.x = x === 0 ? 0 : -0.8;
    if (x === 0) s.rotation.y = Math.PI;
    interior.add(s);
  }
  // Engine core glow
  const coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.7, 1.0).multiplyScalar(2), toneMapped: false });
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 12), coreMat);
  core.rotation.z = Math.PI / 2;
  core.position.set(0, 1.0, 5.45);
  interior.add(core);
  // Engine compartment panel with a hinged door and the Nitro slot behind it
  const panel = new THREE.Group();
  panel.position.set(I.minX + 0.02, 1.25, 4.0);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.1, 1.3), new THREE.MeshStandardMaterial({ color: 0x2a2e34, metalness: 0.6, roughness: 0.4 }));
  housing.position.x = 0.1;
  panel.add(housing);
  const slot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.8, 12), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.3 }));
  slot.rotation.x = Math.PI / 2;
  slot.position.x = 0.22;
  panel.add(slot);
  const canister = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.72, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.85, 1.0).multiplyScalar(2), toneMapped: false }));
  canister.rotation.x = Math.PI / 2;
  canister.position.x = 0.24;
  canister.visible = false;
  panel.add(canister);
  const doorPivot = new THREE.Group();
  doorPivot.position.set(0.22, 0, -0.65);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.05, 1.28), new THREE.MeshStandardMaterial({ color: 0xe07a2a, metalness: 0.4, roughness: 0.5 }));
  door.position.set(0.02, 0, 0.64);
  doorPivot.add(door);
  panel.add(doorPivot);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.12), screenMat);
  label.rotation.y = Math.PI / 2;
  label.position.set(0.23, 0.68, 0);
  panel.add(label);
  interior.add(panel);
  // Repair console on the opposite wall
  const repair = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 1.0), new THREE.MeshStandardMaterial({ color: 0x2a2e34, metalness: 0.6, roughness: 0.4 }));
  repair.position.set(I.maxX - 0.1, 1.3, 3.2);
  interior.add(repair);
  const rscreen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.0, 0.4), toneMapped: false }));
  rscreen.rotation.y = -Math.PI / 2;
  rscreen.position.set(I.maxX - 0.21, 1.35, 3.2);
  interior.add(rscreen);
  const lamp = new THREE.PointLight(0xcfe6ff, 0, 16, 1);
  lamp.position.set(0, 2.3, -3);
  interior.add(lamp);
  const lamp2 = new THREE.PointLight(0xffd9a8, 0, 12, 1);
  lamp2.position.set(0, 2.3, 6);
  interior.add(lamp2);
  // Pilot dashboard with instrument screens
  const dash = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 0.6), new THREE.MeshStandardMaterial({ color: 0x1b1f26, roughness: 0.6, metalness: 0.4 }));
  dash.position.set(0, 0.86, -10.5);
  dash.rotation.x = 0.35;
  interior.add(dash);
  for (const [x, w, c, kind] of [[-1.05, 0.62, '#2ad4ff', 'radar'], [0, 0.7, '#7dff9a', 'bars'], [1.05, 0.62, '#ffb13d', 'graph']]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.28), new THREE.MeshBasicMaterial({ map: screenTexture(kind, c), toneMapped: false }));
    scr.position.set(x, 0.92, -10.45);
    scr.rotation.x = -Math.PI / 2 + 0.35;
    interior.add(scr);
  }
  const stickMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.45, 8), new THREE.MeshStandardMaterial({ color: 0x333840, metalness: 0.6, roughness: 0.4 }));
  stickMesh.position.set(0.35, 0.72, -9.75);
  interior.add(stickMesh);

  const interactables = [
    { id: 'seat', pos: new THREE.Vector3(0, 1, -8.9), radius: 1.3 },
    { id: 'quarters', pos: new THREE.Vector3(-2.0, 1, -4.4), radius: 1.6 },
    { id: 'lab', pos: new THREE.Vector3(2.2, 1, -4.2), radius: 1.6 },
    { id: 'galley', pos: new THREE.Vector3(-2.3, 1, 0.4), radius: 1.4 },
    { id: 'nitro_panel', pos: new THREE.Vector3(I.minX + 0.6, 1, 4.0), radius: 1.4 },
    { id: 'repair_panel', pos: new THREE.Vector3(I.maxX - 0.6, 1, 3.2), radius: 1.4 },
    { id: 'workbench', pos: new THREE.Vector3(2.4, 1, 5.6), radius: 1.2 },
    { id: 'cargo', pos: new THREE.Vector3(0, 1, 9.3), radius: 1.8 },
    { id: 'hatch', pos: new THREE.Vector3(0, 1, 10.5), radius: 1.1 },
  ];

  return {
    root, exterior, interior, shell, flames, gear, ramp, field, fieldMat, canopy, colliders, interactables, lamps: [lamp, lamp2], stick: stickMesh,
    nitro: { panel, doorPivot, canister, open: false, openT: 0 },
    cockpitEye: new THREE.Vector3(0, 1.62, -9.1),
    materials: [hullMat, canopyMat, glowMat, flameMat, gearMat, intMat, stripMat, windowMat, screenMat, coreMat],
  };
}

// Exterior collision shape: capsule-ish box in ship space.
export function shipHullContains(local, margin = 0) {
  const x = local.x, y = local.y, z = local.z;
  if (z < -19.5 - margin || z > 16 + margin) return false;
  if (Math.abs(x) < 4.4 + margin && y > -1.2 - margin && y < 4.2 + margin) return true;
  if (Math.abs(x) < 15.5 + margin && Math.abs(y - 0.9) < 0.6 + margin && z > -2.5 && z < 10.5) return true;
  return false;
}
