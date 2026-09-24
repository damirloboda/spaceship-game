// Detailed furniture for the ship's cabin: bunk with bedding, fridge, galley
// counter with sink and food synthesiser, dining table, workbench with a
// pegboard of tools, lab bench, pilot seat and cargo crates. Each builder
// returns a group whose origin sits on the deck; +X is towards the corridor
// for props on the port wall (builders are mirrored for the starboard side).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { paintedPanel, brushedMetal, carbonMaterial, decalMaterial, gaugeMaterial } from './materialsLib.js';
import { mergeStatic } from './mergeStatic.js';

let M = null;
function mats() {
  if (M) return M;
  const fabric = (color, sheen = 0x8899aa) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.92, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(sheen) });
  M = {
    shell: paintedPanel(0xb8bec7, 0.9),
    darkPanel: paintedPanel(0x3a4049, 0.9),
    orange: paintedPanel(0xe07a2e, 0.8),
    steel: brushedMetal(0xc9ced6, 0.24),
    darkSteel: brushedMetal(0x5a6068, 0.35),
    carbon: carbonMaterial(3),
    sheet: fabric(0xe9edf2, 0xbfd4ff),
    blanket: fabric(0x2c4677, 0x6f8fd0),
    blanketFold: fabric(0xd9dee6, 0xbfd4ff),
    leather: new THREE.MeshPhysicalMaterial({ color: 0x1d2027, roughness: 0.55, clearcoat: 0.4, clearcoatRoughness: 0.4, sheen: 0.4, sheenColor: new THREE.Color(0x445066) }),
    counter: new THREE.MeshPhysicalMaterial({ color: 0x1b1f25, roughness: 0.25, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, roughness: 0.05, transparent: true, opacity: 0.25, clearcoat: 1 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.45, metalness: 0.2 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2b632, roughness: 0.45, metalness: 0.2 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.35 }),
    glowCyan: new THREE.MeshStandardMaterial({ color: 0x081018, emissive: new THREE.Color(0x39d0ff), emissiveIntensity: 2 }),
    glowWarm: new THREE.MeshStandardMaterial({ color: 0x100a04, emissive: new THREE.Color(0xffc27a), emissiveIntensity: 2.2 }),
    glowGreen: new THREE.MeshStandardMaterial({ color: 0x06100a, emissive: new THREE.Color(0x3ef0b0), emissiveIntensity: 2 }),
    glowOrange: new THREE.MeshStandardMaterial({ color: 0x100600, emissive: new THREE.Color(0xff7a2a), emissiveIntensity: 1.6 }),
  };
  return M;
}

function add(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}
const RB = (w, h, d, r = 0.03, s = 3) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));

function canvasMat(w, h, draw, emissive = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return emissive ? new THREE.MeshBasicMaterial({ map: t, toneMapped: false }) : new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
}

function finish(g) {
  mergeStatic(g);
  return g;
}

// ---------------------------------------------------------------------------
// Bunk along the port wall: storage base with drawers, mattress, sheet,
// blanket folded back, pillow, padded headboard with a reading light and a
// shelf with books. Length along Z (head towards -Z), 1.8 x 2.6 footprint.
export function bed() {
  const m = mats(), g = new THREE.Group();
  add(g, RB(1.8, 0.34, 2.6, 0.04), m.darkPanel, 0, 0.17, 0);
  add(g, new THREE.BoxGeometry(1.6, 0.02, 2.4), m.glowCyan, 0, 0.012, 0);
  for (const z of [-0.6, 0.6]) {
    add(g, RB(0.03, 0.22, 1.05, 0.01), m.shell, 0.905, 0.17, z);
    add(g, RB(0.02, 0.03, 0.34, 0.01), m.steel, 0.93, 0.22, z);
  }
  // Mattress, sheet and blanket
  add(g, RB(1.7, 0.22, 2.46, 0.08, 4), m.sheet, 0, 0.45, 0.02);
  add(g, RB(1.74, 0.07, 1.55, 0.03, 3), m.blanket, 0, 0.585, 0.43);
  add(g, RB(1.76, 0.08, 0.3, 0.035, 3), m.blanketFold, 0, 0.6, -0.3);
  for (const s of [-1, 1]) add(g, RB(0.06, 0.2, 1.5, 0.03, 3), m.blanket, s * 0.87, 0.5, 0.43);
  // Pillow, slightly squashed
  const pillow = add(g, RB(0.72, 0.15, 0.42, 0.07, 4), m.sheet, 0.05, 0.62, -0.95, 0, 0.05, 0.04);
  pillow.scale.set(1, 0.9, 1);
  // Headboard with padding and a reading light
  add(g, RB(1.8, 0.95, 0.08, 0.03), m.shell, 0, 0.72, -1.32);
  for (const x of [-0.45, 0.45]) add(g, RB(0.8, 0.45, 0.09, 0.08, 4), m.leather, x, 0.9, -1.27);
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.35, 6), m.darkSteel, 0.7, 1.25, -1.2, 0.9, 0, 0);
  add(g, new THREE.ConeGeometry(0.06, 0.08, 16, 1, true), m.darkSteel, 0.7, 1.33, -1.04, 2.2, 0, 0);
  add(g, new THREE.CircleGeometry(0.05, 16), m.glowWarm, 0.7, 1.305, -1.01, -Math.PI / 2 + 0.6, 0, 0);
  // Wall shelf with books and a photo frame
  add(g, RB(0.25, 0.03, 1.6, 0.01), m.shell, -0.78, 1.55, 0.1);
  const bookCols = [0xb4553a, 0x3a6a9a, 0xd9b36c, 0x5a8a5a, 0x7a4a7a];
  for (let i = 0; i < 7; i++) add(g, new THREE.BoxGeometry(0.16, 0.2 + (i % 3) * 0.03, 0.035), new THREE.MeshStandardMaterial({ color: bookCols[i % 5], roughness: 0.8 }), -0.78, 1.67 + (i % 3) * 0.015, -0.4 + i * 0.045);
  const photo = canvasMat(128, 96, (c) => { const grd = c.createLinearGradient(0, 0, 0, 96); grd.addColorStop(0, '#6fa8ff'); grd.addColorStop(0.6, '#ffd08a'); grd.addColorStop(1, '#3a7a4a'); c.fillStyle = grd; c.fillRect(0, 0, 128, 96); c.fillStyle = '#1a2a1a'; c.beginPath(); c.moveTo(0, 96); c.lineTo(40, 55); c.lineTo(70, 80); c.lineTo(100, 50); c.lineTo(128, 96); c.fill(); }, false);
  add(g, RB(0.03, 0.2, 0.26, 0.01), m.darkSteel, -0.78, 1.67, 0.5);
  add(g, new THREE.PlaneGeometry(0.22, 0.16), photo, -0.76, 1.67, 0.5, 0, Math.PI / 2, 0);
  return finish(g);
}

// Where a sleeper's hips rest on the bed (bed-local).
export const BED_SLEEP = { hips: new THREE.Vector3(0.05, 0.57, -0.1), headDir: new THREE.Vector3(0, 0, -1) };

// Tall stainless fridge with a freezer drawer, handles, a display and an
// ice dispenser. Front faces +X.
export function fridge() {
  const m = mats(), g = new THREE.Group();
  add(g, RB(0.78, 2.0, 0.78, 0.04), m.steel, 0, 1.0, 0);
  add(g, new THREE.BoxGeometry(0.01, 0.02, 0.74), m.rubber, 0.395, 0.62, 0);
  add(g, new THREE.BoxGeometry(0.01, 1.4, 0.01), m.rubber, 0.395, 1.32, 0);
  for (const z of [-0.07, 0.07]) add(g, RB(0.035, 0.9, 0.035, 0.012), m.darkSteel, 0.42, 1.25, z);
  add(g, RB(0.035, 0.03, 0.4, 0.012), m.darkSteel, 0.42, 0.52, 0);
  add(g, RB(0.02, 0.32, 0.2, 0.02), m.rubber, 0.4, 1.12, -0.24);
  add(g, new THREE.BoxGeometry(0.01, 0.05, 0.12), m.glowCyan, 0.405, 1.2, -0.24);
  const disp = canvasMat(160, 96, (c) => {
    c.fillStyle = '#031018'; c.fillRect(0, 0, 160, 96);
    c.fillStyle = '#7fe8ff'; c.font = 'bold 38px monospace'; c.fillText('3°C', 20, 50);
    c.font = '16px monospace'; c.fillStyle = '#3ef0b0'; c.fillText('FRESH  -18°', 20, 80);
  });
  add(g, new THREE.PlaneGeometry(0.2, 0.12), disp, 0.401, 1.55, 0.24, 0, Math.PI / 2, 0);
  add(g, new THREE.PlaneGeometry(0.3, 0.1), decalMaterial({ lines: ['CRYO-FRESH', 'GALLEY 02'], accent: '#39d0ff' }), 0.401, 1.85, -0.18, 0, Math.PI / 2, 0);
  add(g, new THREE.BoxGeometry(0.7, 0.04, 0.72), m.rubber, 0, 0.02, 0);
  return finish(g);
}

// Galley counter against the port wall: cabinets, stone worktop, sink with
// faucet, food synthesiser, mugs and a kettle, wall cabinets with an
// under-cabinet light. Depth along X (front faces +X), length along Z.
export function galley(len = 2.2) {
  const m = mats(), g = new THREE.Group();
  add(g, new THREE.BoxGeometry(0.9, 0.1, len), m.rubber, -0.02, 0.05, 0);
  add(g, RB(0.92, 0.82, len, 0.02), m.shell, 0, 0.51, 0);
  const n = 3;
  for (let i = 0; i < n; i++) {
    const z = -len / 2 + (i + 0.5) * (len / n);
    add(g, RB(0.02, 0.7, len / n - 0.05, 0.01), m.white, 0.465, 0.5, z);
    add(g, RB(0.03, 0.02, 0.24, 0.01), m.darkSteel, 0.485, 0.8, z);
  }
  add(g, RB(1.0, 0.05, len + 0.04, 0.012), m.counter, 0.02, 0.945, 0);
  // Sink and faucet
  add(g, RB(0.44, 0.02, 0.5, 0.01), m.steel, 0.05, 0.972, 0.45);
  add(g, new THREE.BoxGeometry(0.38, 0.015, 0.44), m.darkSteel, 0.05, 0.975, 0.45);
  const tap = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.28, 0.97, 0.45), new THREE.Vector3(-0.28, 1.25, 0.45), new THREE.Vector3(-0.15, 1.32, 0.45), new THREE.Vector3(-0.05, 1.2, 0.45)]);
  add(g, new THREE.TubeGeometry(tap, 16, 0.015, 8, false), m.steel);
  // Food synthesiser
  add(g, RB(0.5, 0.36, 0.55, 0.03), m.darkPanel, -0.12, 1.15, -0.45);
  add(g, RB(0.02, 0.22, 0.34, 0.02), m.glowOrange, 0.135, 1.15, -0.5);
  for (let i = 0; i < 3; i++) add(g, new THREE.CylinderGeometry(0.018, 0.018, 0.01, 12), i === 0 ? m.glowGreen : m.glowCyan, 0.14, 1.26 - i * 0.07, -0.22, 0, 0, Math.PI / 2);
  // Mugs and kettle
  for (const [x, z, c] of [[0.25, -0.1, m.white], [0.3, 0.05, m.orange]]) {
    add(g, new THREE.CylinderGeometry(0.04, 0.035, 0.1, 16), c, x, 1.02, z);
    add(g, new THREE.TorusGeometry(0.03, 0.007, 6, 12), c, x, 1.03, z + 0.045, 0, Math.PI / 2, 0);
  }
  add(g, new THREE.CylinderGeometry(0.07, 0.085, 0.2, 18), m.steel, -0.2, 1.07, 0.95);
  add(g, new THREE.TorusGeometry(0.06, 0.01, 6, 14, Math.PI), m.rubber, -0.2, 1.17, 0.95, 0, Math.PI / 2, 0);
  // Wall cabinets with an under-cabinet light
  add(g, RB(0.42, 0.6, len, 0.02), m.shell, -0.26, 1.95, 0);
  for (let i = 0; i < n; i++) add(g, RB(0.02, 0.52, len / n - 0.05, 0.01), m.white, -0.045, 1.95, -len / 2 + (i + 0.5) * (len / n));
  add(g, new THREE.BoxGeometry(0.06, 0.015, len - 0.1), m.glowWarm, -0.1, 1.64, 0);
  return finish(g);
}

// Round dining table on a pedestal with two stools.
export function diningTable() {
  const m = mats(), g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.46, 0.46, 0.04, 40), m.counter, 0, 0.74, 0);
  add(g, new THREE.TorusGeometry(0.46, 0.012, 6, 40), m.steel, 0, 0.74, 0, Math.PI / 2, 0, 0);
  add(g, new THREE.CylinderGeometry(0.05, 0.06, 0.72, 16), m.steel, 0, 0.37, 0);
  add(g, new THREE.CylinderGeometry(0.28, 0.3, 0.03, 24), m.darkSteel, 0, 0.015, 0);
  for (const z of [-0.62, 0.62]) {
    add(g, new THREE.CylinderGeometry(0.19, 0.17, 0.07, 24), m.leather, 0, 0.5, z);
    add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.47, 10), m.steel, 0, 0.24, z);
    add(g, new THREE.TorusGeometry(0.14, 0.01, 6, 20), m.steel, 0, 0.2, z, Math.PI / 2, 0, 0);
    add(g, new THREE.CylinderGeometry(0.18, 0.2, 0.02, 20), m.darkSteel, 0, 0.01, z);
  }
  // A tray with a plate and a bottle
  add(g, new THREE.CylinderGeometry(0.12, 0.1, 0.02, 24), m.white, 0.12, 0.77, 0.1);
  add(g, new THREE.CylinderGeometry(0.03, 0.035, 0.2, 12), new THREE.MeshPhysicalMaterial({ color: 0x4a8a5a, roughness: 0.1, transparent: true, opacity: 0.7, clearcoat: 1 }), -0.15, 0.86, -0.12);
  return finish(g);
}

// Workbench against the starboard wall: steel top, drawer unit, vice,
// pegboard with tools, a lamp arm and a tablet. Front faces -X.
export function workbench(len = 2.0) {
  const m = mats(), g = new THREE.Group();
  add(g, RB(0.95, 0.06, len, 0.01), m.steel, 0, 0.88, 0);
  for (const [x, z] of [[-0.42, -len / 2 + 0.06], [-0.42, len / 2 - 0.06], [0.42, -len / 2 + 0.06], [0.42, len / 2 - 0.06]]) add(g, new THREE.BoxGeometry(0.05, 0.85, 0.05), m.darkSteel, x, 0.43, z);
  add(g, new THREE.BoxGeometry(0.9, 0.04, len - 0.1), m.darkSteel, 0, 0.18, 0);
  // Drawer unit with orange handles
  add(g, RB(0.85, 0.66, 0.6, 0.02), m.darkPanel, 0.02, 0.5, 0.55);
  for (let i = 0; i < 4; i++) {
    add(g, RB(0.02, 0.14, 0.56, 0.01), m.shell, -0.42, 0.28 + i * 0.155, 0.55);
    add(g, RB(0.03, 0.025, 0.2, 0.01), m.orange, -0.44, 0.3 + i * 0.155, 0.55);
  }
  // Vice
  add(g, RB(0.18, 0.1, 0.22, 0.01), m.darkSteel, -0.35, 0.96, -len / 2 + 0.25);
  add(g, RB(0.06, 0.12, 0.2, 0.01), m.red, -0.44, 1.01, -len / 2 + 0.25);
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.26, 8), m.steel, -0.52, 0.99, -len / 2 + 0.25, 0, 0, Math.PI / 2);
  // Pegboard with tools on the wall
  const peg = canvasMat(256, 256, (c) => { c.fillStyle = '#3d4450'; c.fillRect(0, 0, 256, 256); c.fillStyle = '#1b1f26'; for (let y = 8; y < 256; y += 16) for (let x = 8; x < 256; x += 16) { c.beginPath(); c.arc(x, y, 2.4, 0, Math.PI * 2); c.fill(); } }, false);
  add(g, new THREE.PlaneGeometry(len - 0.1, 0.9), peg, 0.44, 1.55, 0, 0, -Math.PI / 2, 0);
  // Wrench
  const w = new THREE.Group();
  add(w, new THREE.BoxGeometry(0.02, 0.28, 0.035), m.steel, 0, 0, 0);
  add(w, new THREE.TorusGeometry(0.035, 0.012, 6, 14, Math.PI * 1.5), m.steel, 0, 0.16, 0, 0, Math.PI / 2, 0);
  w.position.set(0.42, 1.6, -0.6); g.add(w);
  // Screwdrivers
  for (const [z, c] of [[-0.35, m.red], [-0.28, m.yellow], [-0.21, m.orange]]) {
    add(g, new THREE.CylinderGeometry(0.018, 0.02, 0.1, 10), c, 0.42, 1.72, z);
    add(g, new THREE.CylinderGeometry(0.005, 0.005, 0.16, 6), m.steel, 0.42, 1.59, z);
  }
  // Hammer
  add(g, new THREE.CylinderGeometry(0.014, 0.014, 0.3, 8), m.wood, 0.42, 1.5, 0.05);
  add(g, RB(0.04, 0.05, 0.14, 0.01), m.darkSteel, 0.42, 1.66, 0.05);
  // Pliers
  for (const s of [-1, 1]) add(g, RB(0.015, 0.22, 0.02, 0.006), m.red, 0.42, 1.52, 0.3 + s * 0.02, 0, 0, 0, s * 0.12);
  // Shelf with a toolbox and parts bins
  add(g, RB(0.3, 0.03, len - 0.2, 0.01), m.shell, 0.3, 2.08, 0);
  add(g, RB(0.26, 0.16, 0.5, 0.02), m.red, 0.3, 2.18, -0.5);
  add(g, RB(0.3, 0.03, 0.2, 0.01), m.darkSteel, 0.3, 2.28, -0.5);
  for (let i = 0; i < 4; i++) add(g, RB(0.2, 0.1, 0.16, 0.01), [m.yellow, m.orange, m.white, m.yellow][i], 0.3, 2.15, 0.05 + i * 0.2);
  // Lamp arm
  add(g, new THREE.CylinderGeometry(0.05, 0.06, 0.03, 14), m.darkSteel, 0.3, 0.925, 0.9);
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), m.darkSteel, 0.2, 1.15, 0.9, 0, 0, 0.45);
  add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.4, 8), m.darkSteel, -0.02, 1.38, 0.9, 0, 0, -0.9);
  add(g, new THREE.ConeGeometry(0.08, 0.1, 18, 1, true), m.darkSteel, -0.17, 1.36, 0.9, 0, 0, 2.6);
  add(g, new THREE.CircleGeometry(0.065, 18), m.glowWarm, -0.2, 1.32, 0.9, 0, 0, 2.6 - Math.PI / 2);
  // Tablet, bolts and a part on the bench
  const tab = canvasMat(160, 110, (c) => { c.fillStyle = '#04121c'; c.fillRect(0, 0, 160, 110); c.strokeStyle = '#4fe0ff'; c.lineWidth = 2; c.strokeRect(20, 20, 60, 70); c.beginPath(); c.arc(115, 55, 25, 0, Math.PI * 2); c.stroke(); c.fillStyle = '#ffb13d'; c.font = '12px monospace'; c.fillText('PART 7A', 90, 100); });
  add(g, RB(0.24, 0.015, 0.34, 0.01), m.rubber, -0.15, 0.92, -0.1, 0, 0.2, 0);
  add(g, new THREE.PlaneGeometry(0.21, 0.3), tab, -0.15, 0.93, -0.1, -Math.PI / 2, 0, -0.2);
  for (let i = 0; i < 6; i++) add(g, new THREE.CylinderGeometry(0.01, 0.01, 0.04, 6), m.steel, -0.1 + (i % 3) * 0.05, 0.93, 0.25 + Math.floor(i / 3) * 0.05, Math.PI / 2, 0, i);
  add(g, new THREE.TorusGeometry(0.06, 0.02, 8, 18), m.darkSteel, 0.05, 0.935, -0.55, Math.PI / 2, 0, 0);
  return finish(g);
}

// Lab bench along the starboard wall: white bench with cabinets, a
// microscope, a rack of glowing sample tubes, a monitor and a glass cabinet.
// Front faces -X.
export function labBench(len = 3.0) {
  const m = mats(), g = new THREE.Group();
  add(g, RB(1.15, 0.84, len, 0.02), m.white, 0, 0.42, 0);
  for (let i = 0; i < 4; i++) add(g, RB(0.02, 0.66, len / 4 - 0.05, 0.01), m.shell, -0.585, 0.42, -len / 2 + (i + 0.5) * (len / 4));
  add(g, RB(1.2, 0.05, len + 0.04, 0.012), m.counter, 0, 0.865, 0);
  // Microscope
  const scope = new THREE.Group();
  add(scope, RB(0.22, 0.04, 0.3, 0.01), m.white, 0, 0.02, 0);
  add(scope, RB(0.06, 0.34, 0.06, 0.02), m.white, 0.07, 0.2, 0);
  add(scope, new THREE.CylinderGeometry(0.03, 0.035, 0.22, 16), m.darkSteel, 0.0, 0.33, 0, 0, 0, 0.6);
  add(scope, new THREE.CylinderGeometry(0.018, 0.018, 0.08, 12), m.darkSteel, -0.08, 0.45, 0, 0, 0, 0.6);
  add(scope, RB(0.14, 0.015, 0.14, 0.005), m.darkSteel, -0.02, 0.14, 0);
  scope.position.set(-0.15, 0.89, -0.9); g.add(scope);
  // Sample rack with glowing tubes
  add(g, RB(0.16, 0.06, 0.5, 0.01), m.darkPanel, -0.2, 0.92, 0.05);
  const tubeCols = [m.glowGreen, m.glowCyan, m.glowOrange, m.glowGreen, m.glowCyan];
  for (let i = 0; i < 5; i++) {
    add(g, new THREE.CylinderGeometry(0.016, 0.016, 0.18, 10), m.glass, -0.2, 1.0, -0.15 + i * 0.1);
    add(g, new THREE.CylinderGeometry(0.013, 0.013, 0.1, 10), tubeCols[i], -0.2, 0.97, -0.15 + i * 0.1);
  }
  // Monitor
  const mon = canvasMat(256, 160, (c) => {
    c.fillStyle = '#031018'; c.fillRect(0, 0, 256, 160);
    c.strokeStyle = '#3ef0b0'; c.lineWidth = 2; c.beginPath();
    for (let x = 0; x < 256; x += 3) c.lineTo(x, 90 + Math.sin(x * 0.08) * 22 * Math.sin(x * 0.013));
    c.stroke();
    c.fillStyle = '#7fe8ff'; c.font = 'bold 16px monospace'; c.fillText('GENOME SCAN 68%', 12, 24);
    c.fillStyle = '#39d0ff'; c.fillRect(12, 136, 150, 8); c.fillStyle = '#123'; c.fillRect(162, 136, 80, 8);
  });
  add(g, RB(0.04, 0.34, 0.54, 0.01), m.rubber, 0.3, 1.17, 0.85);
  add(g, new THREE.PlaneGeometry(0.5, 0.3), mon, 0.278, 1.17, 0.85, 0, -Math.PI / 2, 0);
  add(g, new THREE.CylinderGeometry(0.015, 0.02, 0.12, 8), m.darkSteel, 0.33, 0.95, 0.85);
  // Glass wall cabinet with jars
  add(g, RB(0.35, 0.6, len - 0.6, 0.02), m.shell, 0.4, 1.95, -0.2);
  add(g, new THREE.PlaneGeometry(len - 0.7, 0.52), m.glass, 0.222, 1.95, -0.2, 0, -Math.PI / 2, 0);
  for (let i = 0; i < 6; i++) add(g, new THREE.CylinderGeometry(0.05, 0.05, 0.14, 14), i % 2 ? m.glowGreen : m.glass, 0.4, 1.82, -1.1 + i * 0.35);
  return finish(g);
}

// Pilot seat facing -Z: pedestal, cushion, backrest with headrest,
// armrests with control pads.
export function pilotSeat() {
  const m = mats(), g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(0.3, 0.36, 0.05, 24), m.darkSteel, 0, 0.025, 0);
  add(g, new THREE.CylinderGeometry(0.07, 0.09, 0.4, 14), m.steel, 0, 0.23, 0);
  add(g, RB(0.66, 0.12, 0.62, 0.05, 4), m.carbon, 0, 0.46, 0);
  add(g, RB(0.58, 0.1, 0.56, 0.05, 4), m.leather, 0, 0.55, -0.02);
  add(g, RB(0.62, 0.9, 0.12, 0.06, 4), m.carbon, 0, 1.02, 0.32, -0.12, 0, 0);
  add(g, RB(0.52, 0.72, 0.08, 0.05, 4), m.leather, 0, 1.0, 0.26, -0.12, 0, 0);
  add(g, RB(0.34, 0.2, 0.1, 0.05, 4), m.leather, 0, 1.58, 0.36, -0.12, 0, 0);
  add(g, new THREE.BoxGeometry(0.02, 0.6, 0.01), m.glowOrange, 0, 1.0, 0.22, -0.12, 0, 0);
  for (const s of [-1, 1]) {
    add(g, RB(0.1, 0.08, 0.5, 0.03), m.carbon, s * 0.36, 0.72, -0.05);
    add(g, RB(0.04, 0.2, 0.06, 0.02), m.darkSteel, s * 0.36, 0.6, 0.12);
    add(g, RB(0.08, 0.02, 0.14, 0.01), m.glowCyan, s * 0.36, 0.765, -0.18);
  }
  return finish(g);
}

// Cargo crate with a steel frame, straps and a stencilled label.
export function crate(size = 1.1, color = 0x6a7a4a, label = 'CARGO') {
  const m = mats(), g = new THREE.Group();
  const s = size;
  add(g, RB(s, s, s, 0.04), paintedPanel(color, 0.9), 0, s / 2, 0);
  // Steel edge frame: 4 edges along X, 4 along Z, 4 uprights.
  for (const y of [0.03, s - 0.03]) {
    for (const z of [-s / 2, s / 2]) add(g, new THREE.BoxGeometry(s + 0.02, 0.05, 0.05), m.darkSteel, 0, y, z);
    for (const x of [-s / 2, s / 2]) add(g, new THREE.BoxGeometry(0.05, 0.05, s + 0.02), m.darkSteel, x, y, 0);
  }
  for (const x of [-s / 2, s / 2]) for (const z of [-s / 2, s / 2]) add(g, new THREE.BoxGeometry(0.05, s, 0.05), m.darkSteel, x, s / 2, z);
  for (const x of [-s * 0.25, s * 0.25]) add(g, new THREE.BoxGeometry(0.06, s + 0.01, s + 0.012), new THREE.MeshStandardMaterial({ color: 0xd9a030, roughness: 0.8 }), x, s / 2, 0);
  add(g, new THREE.PlaneGeometry(s * 0.45, s * 0.22), decalMaterial({ lines: [label, 'MAX 400 KG'], accent: '#ffb13d' }), 0, s * 0.62, s / 2 + 0.008);
  return finish(g);
}
