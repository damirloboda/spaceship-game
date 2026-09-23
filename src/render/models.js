// Procedural low-poly geometry builders (plants, rocks, creatures, props).
// Everything is generated in code: no external or unlicensed assets.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function colorize(geo, rgb) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  const c = new THREE.Color(rgb[0], rgb[1], rgb[2]).convertSRGBToLinear();
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function prep(geo) {
  // Normalise attribute sets so geometries can be merged.
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

export function merge(list) {
  return mergeGeometries(list.map(prep), false);
}

export function plantGeometry(sp) {
  const H = sp.height, W = sp.width;
  const trunk = sp.trunk, leaf = sp.leaf;
  const parts = [];
  const cyl = (rt, rb, h, y, c, seg = 6) => { const g = new THREE.CylinderGeometry(rt, rb, h, seg); g.translate(0, y, 0); return colorize(g, c); };
  switch (sp.form) {
    case 'conifer':
      parts.push(cyl(0.12 * W, 0.22 * W, H * 0.35, H * 0.17, trunk));
      for (let i = 0; i < 3; i++) {
        const g = new THREE.ConeGeometry(W * (1.6 - i * 0.4), H * 0.42, 7);
        g.translate(0, H * (0.4 + i * 0.2), 0);
        parts.push(colorize(g, leaf.map((v) => v * (1 - i * 0.08))));
      }
      break;
    case 'broadleaf': {
      parts.push(cyl(0.15 * W, 0.28 * W, H * 0.55, H * 0.27, trunk));
      const g = new THREE.IcosahedronGeometry(W * 1.7, 0);
      g.scale(1, 0.8, 1); g.translate(0, H * 0.72, 0);
      parts.push(colorize(g, leaf));
      const g2 = new THREE.IcosahedronGeometry(W * 1.1, 0);
      g2.translate(W * 0.9, H * 0.6, 0.3);
      parts.push(colorize(g2, leaf.map((v) => v * 0.9)));
      break;
    }
    case 'palm': {
      parts.push(cyl(0.1 * W, 0.18 * W, H * 0.9, H * 0.45, trunk, 5));
      for (let i = 0; i < 6; i++) {
        const g = new THREE.BoxGeometry(W * 2.2, 0.05, W * 0.45);
        g.translate(W * 1.1, 0, 0); g.rotateZ(-0.35); g.rotateY((i / 6) * Math.PI * 2); g.translate(0, H * 0.9, 0);
        parts.push(colorize(g, leaf));
      }
      break;
    }
    case 'mushroom': {
      parts.push(cyl(0.18 * W, 0.28 * W, H * 0.7, H * 0.35, [0.85, 0.82, 0.75], 8));
      const g = new THREE.SphereGeometry(W * 1.8, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 0.55, 1); g.translate(0, H * 0.68, 0);
      parts.push(colorize(g, leaf));
      break;
    }
    case 'crystal': {
      for (let i = 0; i < 4; i++) {
        const g = new THREE.OctahedronGeometry(W * (0.5 + (i % 2) * 0.3), 0);
        g.scale(0.5, H * 0.4 / W, 0.5); g.rotateZ((i - 1.5) * 0.25); g.translate((i - 1.5) * W * 0.4, H * 0.3, (i % 2) * 0.3);
        parts.push(colorize(g, leaf));
      }
      break;
    }
    case 'frond': {
      for (let i = 0; i < 5; i++) {
        const g = new THREE.ConeGeometry(W * 0.25, H, 4);
        g.translate(0, H / 2, 0); g.rotateZ(0.3); g.rotateY((i / 5) * Math.PI * 2);
        parts.push(colorize(g, leaf));
      }
      break;
    }
    case 'cactus': {
      parts.push(cyl(W * 0.3, W * 0.35, H, H / 2, leaf, 8));
      const arm = new THREE.CylinderGeometry(W * 0.18, W * 0.2, H * 0.4, 6);
      arm.translate(W * 0.55, H * 0.6, 0);
      parts.push(colorize(arm, leaf));
      break;
    }
    case 'coral': {
      for (let i = 0; i < 6; i++) {
        const g = new THREE.CylinderGeometry(W * 0.06, W * 0.12, H, 5);
        g.translate(0, H / 2, 0); g.rotateZ((i - 2.5) * 0.18); g.rotateY(i * 1.1);
        parts.push(colorize(g, leaf));
      }
      break;
    }
    case 'bulb': {
      parts.push(cyl(0.05 * W, 0.08 * W, H * 0.6, H * 0.3, trunk, 5));
      const g = new THREE.SphereGeometry(W * 0.55, 8, 6);
      g.translate(0, H * 0.7, 0);
      parts.push(colorize(g, leaf));
      break;
    }
    case 'spire': {
      const g = new THREE.ConeGeometry(W * 0.6, H, 5);
      g.translate(0, H / 2, 0);
      parts.push(colorize(g, leaf));
      break;
    }
    case 'reed': {
      for (let i = 0; i < 5; i++) {
        const g = new THREE.CylinderGeometry(0.02, 0.05, H, 3);
        g.translate((i - 2) * 0.15 * W, H / 2, ((i * 7) % 3 - 1) * 0.15 * W);
        parts.push(colorize(g, leaf));
      }
      break;
    }
    default: { // bush
      const g = new THREE.IcosahedronGeometry(W * 0.9, 0);
      g.scale(1, H / (W * 1.8), 1); g.translate(0, H * 0.45, 0);
      parts.push(colorize(g, leaf));
      const g2 = new THREE.IcosahedronGeometry(W * 0.6, 0);
      g2.translate(W * 0.6, H * 0.3, W * 0.2);
      parts.push(colorize(g2, leaf.map((v) => v * 0.85)));
    }
  }
  return merge(parts);
}

export const DEPOSIT_TYPES = {
  ferrite: { color: [0.55, 0.57, 0.6], glow: 0, shape: 'rock', yield: [4, 9] },
  carbon: { color: [0.22, 0.18, 0.14], glow: 0, shape: 'rock', yield: [5, 10] },
  cobalt: { color: [0.25, 0.5, 1.0], glow: 0.6, shape: 'crystal', yield: [3, 7] },
  oxyite: { color: [1.0, 0.35, 0.3], glow: 0.5, shape: 'crystal', yield: [3, 6] },
  aurum: { color: [1.0, 0.78, 0.25], glow: 0.8, shape: 'crystal', yield: [1, 3] },
  ice: { color: [0.8, 0.92, 1.0], glow: 0.1, shape: 'rock', yield: [5, 10] },
};

export function depositGeometry(type) {
  const d = DEPOSIT_TYPES[type];
  const parts = [];
  if (d.shape === 'crystal') {
    for (let i = 0; i < 5; i++) {
      const g = new THREE.OctahedronGeometry(0.35 + (i % 3) * 0.15, 0);
      g.scale(0.6, 1.8, 0.6); g.rotateZ((i - 2) * 0.35); g.rotateY(i * 1.3); g.translate((i - 2) * 0.25, 0.5, ((i * 3) % 5 - 2) * 0.15);
      parts.push(colorize(g, d.color));
    }
    const base = new THREE.DodecahedronGeometry(0.6, 0);
    base.scale(1.2, 0.5, 1.2);
    parts.push(colorize(base, [0.3, 0.3, 0.32]));
  } else {
    const g = new THREE.DodecahedronGeometry(0.9, 0);
    g.scale(1.3, 0.8, 1.1); g.translate(0, 0.35, 0);
    parts.push(colorize(g, d.color));
    const g2 = new THREE.DodecahedronGeometry(0.5, 0);
    g2.translate(0.8, 0.2, 0.3);
    parts.push(colorize(g2, d.color.map((v) => v * 0.85)));
  }
  return merge(parts);
}

// Creature built from its genome: a static merged body plus animated legs and wings.
export function creatureModel(sp, material) {
  const S = sp.size;
  const L = sp.bodyLength * S, Hh = sp.bodyHeight * S * 0.6, W = S * 0.55;
  const legLen = sp.flying ? S * 0.3 : sp.legLength * S * 0.7;
  const bodyY = sp.flying ? 0 : legLen + Hh * 0.5;
  const parts = [];
  const body = new THREE.SphereGeometry(1, 10, 8);
  body.scale(W, Hh, L * 0.5); body.translate(0, bodyY, 0);
  parts.push(colorize(body, sp.skin));
  const headR = sp.headSize * S * 0.5;
  const headZ = -L * 0.5 - headR * 0.6 - sp.neck * S * 0.3;
  const headY = bodyY + Hh * 0.3 + sp.neck * S * 0.3;
  const head = new THREE.SphereGeometry(headR, 8, 6);
  head.translate(0, headY, headZ);
  parts.push(colorize(head, sp.skin.map((v) => v * 0.92)));
  if (sp.neck > 0.2) {
    const neck = new THREE.CylinderGeometry(headR * 0.45, headR * 0.6, sp.neck * S * 0.6, 6);
    neck.rotateX(0.9); neck.translate(0, bodyY + Hh * 0.2 + sp.neck * S * 0.15, -L * 0.45 - sp.neck * S * 0.12);
    parts.push(colorize(neck, sp.skin));
  }
  const eyeColor = sp.glow ? sp.accent : [0.05, 0.05, 0.05];
  for (let e = 0; e < sp.eyes; e++) {
    const eye = new THREE.SphereGeometry(headR * 0.18, 6, 4);
    const side = sp.eyes === 1 ? 0 : ((e % 2) ? 1 : -1) * (0.35 + Math.floor(e / 2) * 0.12);
    eye.translate(side * headR, headY + headR * (0.25 + Math.floor(e / 2) * 0.18), headZ - headR * 0.82);
    parts.push(colorize(eye, eyeColor));
  }
  for (let h = 0; h < sp.horns; h++) {
    const horn = new THREE.ConeGeometry(headR * 0.18, headR * 1.1, 5);
    horn.rotateX(-0.5); horn.translate((h - (sp.horns - 1) / 2) * headR * 0.6, headY + headR * 0.9, headZ);
    parts.push(colorize(horn, [0.9, 0.88, 0.8]));
  }
  if (sp.tail > 0) {
    const tail = new THREE.ConeGeometry(W * 0.35, sp.tail * S, 5);
    tail.rotateX(-Math.PI / 2 - 0.3); tail.translate(0, bodyY + Hh * 0.1, L * 0.5 + sp.tail * S * 0.4);
    parts.push(colorize(tail, sp.skin.map((v) => v * 0.85)));
  }
  if (sp.shell) {
    const shell = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    shell.scale(W * 1.15, Hh * 1.2, L * 0.55); shell.translate(0, bodyY + Hh * 0.1, 0);
    parts.push(colorize(shell, sp.accent.map((v) => v * 0.7)));
  }
  // Accent stripe on the back
  const stripe = new THREE.BoxGeometry(W * 0.3, Hh * 0.1, L * 0.8);
  stripe.translate(0, bodyY + Hh * 0.97, 0);
  parts.push(colorize(stripe, sp.accent));
  const group = new THREE.Group();
  const bodyMesh = new THREE.Mesh(merge(parts), material);
  bodyMesh.castShadow = true;
  group.add(bodyMesh);
  const legs = [];
  const legGeo = colorize(new THREE.CylinderGeometry(S * 0.06, S * 0.09, legLen, 5).translate(0, -legLen / 2, 0), sp.skin.map((v) => v * 0.7));
  const pairs = sp.legs / 2;
  for (let p = 0; p < pairs; p++) {
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, material);
      const z = pairs === 1 ? 0 : -L * 0.35 + (p / (pairs - 1)) * L * 0.7;
      leg.position.set(side * W * 0.7, bodyY - Hh * 0.3, z);
      leg.userData.phase = (p % 2 === 0 ? 0 : Math.PI) + (side > 0 ? Math.PI : 0);
      group.add(leg);
      legs.push(leg);
    }
  }
  const wings = [];
  if (sp.wings) {
    const wg = colorize(new THREE.BoxGeometry(S * 1.6, S * 0.03, L * 0.5).translate(S * 0.8, 0, 0), sp.accent);
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wg, material);
      w.position.set(side * W * 0.6, bodyY + Hh * 0.6, 0);
      w.scale.x = side;
      group.add(w);
      wings.push(w);
    }
  }
  // Indices (not objects) so clones can resolve their own animated parts;
  // userData is deep-copied by clone() and must stay plain data.
  group.userData = { legIdx: legs.map((l) => group.children.indexOf(l)), wingIdx: wings.map((w) => group.children.indexOf(w)), bodyY, height: bodyY + Hh, radius: Math.max(W, L * 0.5) };
  return group;
}

export function humanoidModel(colors, height = 1.8, material) {
  const [primary, secondary] = colors;
  const s = height / 1.8;
  const parts = [];
  const torso = new THREE.CapsuleGeometry(0.22 * s, 0.5 * s, 3, 8); torso.translate(0, 1.2 * s, 0);
  parts.push(colorize(torso, primary));
  const head = new THREE.SphereGeometry(0.16 * s, 10, 8); head.translate(0, 1.72 * s, 0);
  parts.push(colorize(head, secondary || [0.8, 0.7, 0.6]));
  const collar = new THREE.TorusGeometry(0.15 * s, 0.04 * s, 5, 10); collar.rotateX(Math.PI / 2); collar.translate(0, 1.52 * s, 0);
  parts.push(colorize(collar, secondary || primary));
  const g = new THREE.Group();
  const body = new THREE.Mesh(merge(parts), material);
  body.castShadow = true;
  g.add(body);
  const limb = (r, len, color) => colorize(new THREE.CapsuleGeometry(r, len, 2, 6).translate(0, -len / 2 - r, 0), color);
  const legGeo = limb(0.08 * s, 0.62 * s, primary.map((v) => v * 0.7));
  const armGeo = limb(0.06 * s, 0.5 * s, primary.map((v) => v * 0.9));
  const limbs = {};
  for (const [name, geo, x, y] of [['legL', legGeo, -0.11, 0.85], ['legR', legGeo, 0.11, 0.85], ['armL', armGeo, -0.3, 1.46], ['armR', armGeo, 0.3, 1.46]]) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x * s, y * s, 0);
    m.castShadow = true;
    g.add(m);
    limbs[name] = m;
  }
  g.limbs = limbs;
  return g;
}

// Animate a humanoid walk cycle; speed in m/s.
export function animateHumanoid(model, t, speed) {
  const l = model.limbs;
  if (!l) return;
  const k = Math.min(1, speed / 3);
  const a = Math.sin(t * (4 + speed)) * 0.7 * k;
  l.legL.rotation.x = a; l.legR.rotation.x = -a;
  l.armL.rotation.x = -a * 0.8; l.armR.rotation.x = a * 0.8;
}
