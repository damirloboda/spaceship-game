// The starter explorer ship "Pathfinder": exterior hull plus a walkable
// interior (cockpit, quarters, lab, galley, technical bay with the engine
// compartment and Nitro slot, cargo hold and rear hatch).
// Ship-local axes: forward = -Z, up = +Y, interior deck at y = 0.
import * as THREE from 'three';
import { colorize, merge } from './models.js';
import { createFieldMaterial } from './shaders.js';

export const INTERIOR = { minX: -3.2, maxX: 3.2, minZ: -10.8, maxZ: 10.8, height: 2.8 };
export const GEAR_HEIGHT = 2.6; // distance from deck (y=0) to the ground when landed
export const RAMP_EXIT = new THREE.Vector3(0, -GEAR_HEIGHT, 14.2); // where the player steps off
export const RAMP_OPEN = 0.25;
export const RAMP_CLOSED = -0.35;

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
  const hull = [];
  const fus = new THREE.CapsuleGeometry(3.2, 21, 6, 18);
  fus.rotateX(Math.PI / 2); fus.scale(1.25, 0.95, 1); fus.translate(0, 1.3, 0.4);
  hull.push(colorize(fus, colorRGB));
  const stripe = new THREE.CapsuleGeometry(3.25, 21, 3, 18, 1);
  stripe.rotateX(Math.PI / 2); stripe.scale(1.26, 0.2, 1.001); stripe.translate(0, 1.0, 0.4);
  hull.push(colorize(stripe, [0.95, 0.45, 0.15]));
  for (const side of [-1, 1]) {
    const wing = new THREE.BoxGeometry(10, 0.45, 6.5);
    wing.translate(side * 5, 0, 0);
    const p = wing.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      // sweep and taper
      p.setZ(i, p.getZ(i) * (1 - Math.abs(x) / 14) + Math.abs(x) * 0.45);
    }
    wing.translate(side * 3.2, 0.4, 1.8);
    hull.push(colorize(wing, colorRGB.map((v) => v * 0.92)));
    const tip = box(0.4, 2.2, 3, side * 13.1, 1.2, 6.2, [0.95, 0.45, 0.15]);
    hull.push(tip);
    const eng = new THREE.CylinderGeometry(1.25, 1.45, 5, 12);
    eng.rotateX(Math.PI / 2); eng.translate(side * 2.8, 1.2, 11.5);
    hull.push(colorize(eng, [0.35, 0.36, 0.4]));
    const pod = new THREE.CylinderGeometry(0.7, 0.8, 4, 10);
    pod.rotateX(Math.PI / 2); pod.translate(side * 9.5, 0.5, 5.5);
    hull.push(colorize(pod, [0.35, 0.36, 0.4]));
  }
  const fin = new THREE.BoxGeometry(0.4, 3.5, 5);
  fin.translate(0, 5.4, 9);
  hull.push(colorize(fin, colorRGB));
  const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.55 });
  const hullMesh = new THREE.Mesh(merge(hull), hullMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  exterior.add(hullMesh);
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1a3550, roughness: 0.18, metalness: 0.7, transparent: true, opacity: 0.55 });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), canopyMat);
  canopy.scale.set(1.05, 0.7, 1.6);
  canopy.position.set(0, 2.25, -8.6);
  exterior.add(canopy);
  // Engine glow and exhaust
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.8, 1.0).multiplyScalar(1.4), toneMapped: false });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.7, 1.0), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const flames = [];
  for (const side of [-1, 1]) {
    const g = new THREE.Mesh(new THREE.CircleGeometry(1.15, 16), glowMat);
    g.position.set(side * 2.8, 1.2, 14.05);
    exterior.add(g);
    const f = new THREE.Mesh(new THREE.ConeGeometry(1.1, 8, 12, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 4), flameMat);
    f.position.set(side * 2.8, 1.2, 14.1);
    exterior.add(f);
    flames.push(f);
  }
  // Landing gear
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x555a60, roughness: 0.5, metalness: 0.7 });
  const gear = new THREE.Group();
  for (const [x, z] of [[0, -7], [-3.2, 6], [3.2, 6]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.2, 6), gearMat);
    leg.position.set(x, -1.4, z);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 10), gearMat);
    foot.position.set(x, -2.5, z);
    gear.add(leg, foot);
  }
  exterior.add(gear);
  // Belly ramp between the engines (opens when landed)
  const ramp = new THREE.Group();
  ramp.position.set(0, -1.6, 8.8);
  const rampMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 4.2).translate(0, 0, 2.1), gearMat);
  ramp.add(rampMesh);
  exterior.add(ramp);
  // Navigation lights
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
  navR.position.set(-13.3, 2.3, 6.2);
  const navG = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 4), new THREE.MeshBasicMaterial({ color: 0x20ff40 }));
  navG.position.set(13.3, 2.3, 6.2);
  exterior.add(navR, navG);
  // Energy field for Overdrive / Lightbreak
  const fieldMat = createFieldMaterial();
  const field = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), fieldMat);
  field.scale.set(16, 8, 22);
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
    root, exterior, interior, flames, gear, ramp, field, fieldMat, canopy, colliders, interactables, lamps: [lamp, lamp2], stick: stickMesh,
    nitro: { panel, doorPivot, canister, open: false, openT: 0 },
    cockpitEye: new THREE.Vector3(0, 1.62, -9.1),
    materials: [hullMat, canopyMat, glowMat, flameMat, gearMat, intMat, stripMat, windowMat, screenMat, coreMat],
  };
}

// Exterior collision shape: capsule-ish box in ship space.
export function shipHullContains(local, margin = 0) {
  const x = local.x, y = local.y, z = local.z;
  if (z < -13 - margin || z > 14 + margin) return false;
  if (Math.abs(x) < 4 + margin && y > -1.8 - margin && y < 4.3 + margin) return true;
  if (Math.abs(x) < 13.3 + margin && Math.abs(y - 0.4) < 0.6 + margin && z > -1.5 && z < 9) return true;
  return false;
}
