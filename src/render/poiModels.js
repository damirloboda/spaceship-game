// Procedural models for points of interest. Each builder returns
// { group, loot: [{ pos, key }], update(dt, t, near) } in a local frame
// where +Y is up and the origin sits on the ground.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RNG } from '../core/rng.js';
import { texture } from './textures.js';
import { paintedPanel, brushedMetal, carbonMaterial, decalMaterial } from './materialsLib.js';
import { Particles } from './jetpackModel.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mats = {};

function stone(color) {
  const key = `stone${color}`;
  if (!mats[key]) {
    mats[key] = new THREE.MeshStandardMaterial({
      // The photo map is dark grey: lift the tint so sandstone reads as sandstone.
      color: new THREE.Color(color).multiplyScalar(1.9), roughness: 0.95, metalness: 0,
      map: texture('asteroid_diff.jpg', { srgb: true, repeat: 1 }),
      normalMap: texture('asteroid_nor.jpg', { repeat: 1 }),
      normalScale: new THREE.Vector2(1.2, 1.2),
    });
  }
  return mats[key];
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Alien glyph columns, glowing.
function glyphMaterial(color) {
  const key = `glyph${color}`;
  if (mats[key]) return mats[key];
  const tex = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.lineCap = 'round';
    const rng = new RNG(77);
    for (let y = 20; y < h - 20; y += 44) {
      g.beginPath();
      const x0 = 30 + rng.range(-6, 6);
      g.moveTo(x0, y);
      for (let k = 0; k < 4; k++) g.lineTo(30 + rng.range(0, 68), y + rng.range(0, 34));
      g.stroke();
      if (rng.next() < 0.6) { g.beginPath(); g.arc(64 + rng.range(-20, 20), y + 18, rng.range(4, 9), 0, Math.PI * 2); g.stroke(); }
    }
  });
  mats[key] = new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.4, metalness: 0.3, emissive: new THREE.Color(color), emissiveMap: tex, emissiveIntensity: 2.2 });
  return mats[key];
}

function scorchMaterial() {
  if (mats.scorch) return mats.scorch;
  const tex = canvasTex(256, 256, (g) => {
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    grd.addColorStop(0, 'rgba(10,8,6,0.95)');
    grd.addColorStop(0.55, 'rgba(25,18,12,0.7)');
    grd.addColorStop(1, 'rgba(30,22,15,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  });
  mats.scorch = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4 });
  return mats.scorch;
}

const keep = (m) => { m.userData.keep = true; return m; };
// Its own material instance (animated), kept out of the static merge.
function glowGlyph(color) { const m = glyphMaterial(color).clone(); return m; }
const glow = (c, i = 3) => new THREE.MeshStandardMaterial({ color: 0x080808, emissive: new THREE.Color(c), emissiveIntensity: i });

function add(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  if (s !== 1) m.scale.setScalar(s);
  m.castShadow = true; m.receiveShadow = true;
  g.add(m);
  return m;
}

// Soft light column seen from the air: guides the player to the site.
function beaconPillar(color, height = 260, radius = 3) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.4), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.4, radius, height, 16, 1, true).translate(0, height / 2, 0), mat);
  m.frustumCulled = false;
  m.renderOrder = 3;
  return m;
}

// ---------------------------------------------------------------------------
// Ancient temple ruins: stepped platform, a ring of fluted columns (some
// broken or toppled), a gateway arch and a glowing glyph obelisk on an altar.
function ruins(rng, ctx) {
  const g = new THREE.Group();
  const col = ctx.stone || 0xb8a88a;
  const S = stone(col), S2 = stone(new THREE.Color(col).multiplyScalar(0.8).getHex());
  for (let i = 0; i < 3; i++) add(g, new THREE.BoxGeometry(30 - i * 7, 1.1, 30 - i * 7), i % 2 ? S2 : S, 0, 0.55 + i * 1.1, 0);
  const top = 3.3;
  const colGeo = new THREE.CylinderGeometry(0.75, 0.85, 1, 12);
  const capGeo = new THREE.BoxGeometry(2.1, 0.5, 2.1);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const x = Math.cos(a) * 12.5, z = Math.sin(a) * 12.5;
    const broken = rng.next() < 0.45;
    const h = broken ? rng.range(2, 6) : 9;
    if (rng.next() < 0.18) {
      // Toppled column lying in pieces.
      const ang = rng.range(0, Math.PI * 2);
      for (let k = 0; k < 3; k++) {
        const seg = add(g, colGeo, S, x + Math.cos(ang) * (1.6 + k * 3.1), 0.8, z + Math.sin(ang) * (1.6 + k * 3.1), 0, -ang, Math.PI / 2 + rng.range(-0.15, 0.15));
        seg.scale.y = 2.9;
      }
      continue;
    }
    const c = add(g, colGeo, S, x, 0.5 + h / 2, z, rng.range(-0.04, 0.04), 0, rng.range(-0.04, 0.04));
    c.scale.y = h;
    if (!broken) add(g, capGeo, S2, x, h + 0.25, z);
  }
  // Gateway arch facing +Z
  for (const x of [-4, 4]) add(g, new THREE.BoxGeometry(1.8, 11, 1.8), S2, x, 5.5, 15.5);
  add(g, new THREE.BoxGeometry(11.5, 1.6, 2.2), S, 0, 11.6, 15.5, 0, 0, 0.04);
  add(g, new THREE.BoxGeometry(6.2, 0.6, 0.3), glyphMaterial(ctx.glow || 0x7fe8ff), 0, 11.6, 16.65);
  // Steps up the platform on the arch side
  for (let i = 0; i < 4; i++) add(g, new THREE.BoxGeometry(7, 0.8, 1.2), S2, 0, 0.4 + i * 0.8, 15.2 - i * 1.2);
  // Altar and obelisk
  add(g, new THREE.BoxGeometry(4, 1.2, 2.4), S2, 0, top + 0.6, -2);
  const ob = add(g, new THREE.CylinderGeometry(0.55, 1.0, 7, 4, 1), glowGlyph(ctx.glow || 0x7fe8ff), 0, top + 4.7, -2, 0, Math.PI / 4, 0);
  keep(ob);
  // Scattered blocks and rubble
  const block = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(8, 24);
    const b = add(g, block, rng.next() < 0.5 ? S : S2, Math.cos(a) * d, 0.3, Math.sin(a) * d, rng.range(0, 0.5), rng.range(0, 3), rng.range(0, 0.5));
    b.scale.set(rng.range(0.6, 2.2), rng.range(0.4, 1.2), rng.range(0.6, 2));
  }
  const pillar = beaconPillar(ctx.glow || 0x7fe8ff, 220, 1.1);
  pillar.position.set(0, top + 8.3, -2);
  g.add(pillar);
  return {
    group: g,
    loot: [{ pos: V(0, top + 0.6, 0), key: 'altar' }],
    update(dt, t) { ob.material.emissiveIntensity = 1.8 + Math.sin(t * 1.3) * 0.6; pillar.material.opacity = 0.1 + Math.sin(t * 0.7) * 0.04; },
  };
}

// Crashed ship: a tilted, broken fuselage in a scorched furrow, a torn wing,
// debris and a smoke column visible from far away.
function crash(rng, ctx) {
  const g = new THREE.Group();
  const hull = paintedPanel(rng.pick([0x6b737e, 0x8a5a3a, 0x3f5a6e, 0x7a7a70]), 0.7);
  const dark = carbonMaterial(2);
  const metal = brushedMetal(0x9aa0a8, 0.4);
  const scorch = new THREE.Mesh(new THREE.PlaneGeometry(46, 70).rotateX(-Math.PI / 2), scorchMaterial());
  scorch.position.set(0, 0.08, -6);
  g.add(scorch);
  const body = new THREE.Group();
  body.position.set(0, 1.4, 0);
  body.rotation.set(0.16, 0, 0.32);
  g.add(body);
  add(body, new RoundedBoxGeometry(6, 3.6, 16, 4, 0.8), hull, 0, 0, 0);
  add(body, new THREE.CylinderGeometry(1.7, 3.0, 5, 12, 1, false).rotateX(Math.PI / 2), hull, 0, 0.1, -10);
  add(body, new RoundedBoxGeometry(3.4, 1.4, 4, 3, 0.5), new THREE.MeshPhysicalMaterial({ color: 0x0a1016, roughness: 0.08, metalness: 0.2, clearcoat: 1 }), 0, 1.9, -6);
  // Torn open rear with exposed frame
  for (let i = 0; i < 5; i++) add(body, new THREE.BoxGeometry(0.25, 3.2, 0.25), metal, -2.6 + i * 1.3, 0, 8.3 + rng.range(-0.3, 0.3), 0, 0, rng.range(-0.4, 0.4));
  add(body, new THREE.CylinderGeometry(1.2, 1.5, 2, 16).rotateX(Math.PI / 2), dark, -1.8, -0.3, 8.8);
  const wing = add(g, new THREE.BoxGeometry(9, 0.35, 4.5), hull, 9, 0.6, 5, 0.1, 0.7, 0.25);
  add(g, new THREE.BoxGeometry(0.35, 0.36, 4.4), glow(0xff3b2b, 1.2), 13.4, 1.2, 7.7, 0.1, 0.7, 0.25);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.2), decalMaterial({ lines: ['UCS-' + rng.int(100, 999), 'KESTREL CLASS'], accent: '#ff5d3d' }));
  label.position.set(3.02, 0.4, -1); label.rotation.y = Math.PI / 2;
  body.add(label);
  // Debris field along the furrow
  const chunk = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 22; i++) {
    const z = rng.range(-40, 10), x = rng.range(-10, 10) * (1 + Math.max(0, -z) / 30);
    const c = add(g, chunk, rng.next() < 0.5 ? hull : metal, x, 0.25, z, rng.range(0, 3), rng.range(0, 3), rng.range(0, 3));
    c.scale.set(rng.range(0.3, 2), rng.range(0.1, 0.6), rng.range(0.3, 1.6));
  }
  // Black box beacon: blinking red
  const box = add(g, new RoundedBoxGeometry(0.7, 0.5, 0.9, 2, 0.08), paintedPanel(0xff7a1a, 0.3), -3.6, 0.25, 4.5, 0, 0.5, 0);
  const led = keep(add(g, new THREE.SphereGeometry(0.09, 8, 6), glow(0xff2020, 4), -3.6, 0.55, 4.5));
  const fire = new Particles(90, { additive: true });
  const smoke = new Particles(140);
  g.add(fire.points, smoke.points);
  const firePos = V(-1.6, 3.4, 9);
  let acc = 0;
  return {
    group: g,
    loot: [{ pos: V(-3.6, 0.3, 4.5), key: 'blackbox' }, { pos: V(5.5, 0.3, -6), key: 'salvage' }],
    update(dt, t, near) {
      led.material.emissiveIntensity = (t % 1.2) < 0.15 ? 6 : 0.2;
      acc += dt;
      const rate = near ? 1 / 30 : 1 / 8;
      while (acc > rate) {
        acc -= rate;
        smoke.emit(firePos.clone().add(V(rng.range(-1, 1), 0, rng.range(-1, 1))), V(rng.range(-0.5, 0.5) + 1.2, rng.range(4, 6), rng.range(-0.5, 0.5)), { color: [0.12, 0.11, 0.1], size: 5, life: 14, grow: 5, drag: 0.08 });
        if (near) fire.emit(firePos.clone().add(V(rng.range(-0.8, 0.8), 0, rng.range(-0.8, 0.8))), V(0, rng.range(2, 4), 0), { color: [1, 0.45, 0.12], size: 1.4, life: 0.7, grow: -0.6 });
      }
      smoke.update(dt, V(0.25, 0.3, 0));
      fire.update(dt, V(0, 1, 0));
    },
    dispose() { fire.dispose(); smoke.dispose(); },
  };
}

// Abandoned research outpost: habitat modules on legs, a connecting tube,
// solar array, antenna with a blinking light, supply crates.
function outpost(rng, ctx) {
  const g = new THREE.Group();
  const white = paintedPanel(0xd9dde2, 0.5), orange = paintedPanel(0xe07a2e, 0.5);
  const metal = brushedMetal(0xa8adb4, 0.35), dark = carbonMaterial(2);
  add(g, new THREE.CylinderGeometry(14, 14, 0.3, 32), stone(0x6d6a66), 0, 0.15, 0);
  const hab = (x, z, ry, len, mat) => {
    const m = new THREE.Group();
    m.position.set(x, 0, z); m.rotation.y = ry;
    add(m, new THREE.CapsuleGeometry(2.3, len, 6, 20).rotateZ(Math.PI / 2), mat, 0, 3.2, 0);
    for (const s of [-1, 1]) for (const e of [-1, 1]) add(m, new THREE.CylinderGeometry(0.15, 0.2, 1.4, 8), metal, s * len * 0.35, 0.7, e * 1.5);
    for (let i = 0; i < 3; i++) add(m, new THREE.CircleGeometry(0.45, 16), new THREE.MeshPhysicalMaterial({ color: 0x0b1118, roughness: 0.1, clearcoat: 1, emissive: new THREE.Color(0x3aa0ff), emissiveIntensity: i === 1 ? 0.6 : 0.05 }), -len * 0.3 + i * len * 0.3, 3.6, 2.28);
    add(m, new THREE.BoxGeometry(len + 2, 0.12, 0.12), glow(0x39d0ff, 1.5), 0, 1.6, 2.1);
    g.add(m);
    return m;
  };
  hab(-3, -2, 0.1, 7, white);
  hab(6, 5, 1.4, 4, orange);
  add(g, new THREE.CylinderGeometry(0.9, 0.9, 6, 12).rotateZ(Math.PI / 2), white, 2, 3, 2, 0, -0.75, 0);
  // Solar array
  const panelTex = canvasTex(128, 128, (c) => { c.fillStyle = '#0d1a33'; c.fillRect(0, 0, 128, 128); c.strokeStyle = '#6f86b0'; c.lineWidth = 2; for (let i = 0; i <= 128; i += 16) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, 128); c.moveTo(0, i); c.lineTo(128, i); c.stroke(); } });
  const panelMat = new THREE.MeshPhysicalMaterial({ map: panelTex, roughness: 0.2, metalness: 0.4, clearcoat: 1 });
  for (let i = 0; i < 3; i++) {
    add(g, new THREE.CylinderGeometry(0.08, 0.08, 2, 6), metal, -9 + i * 3.6, 1, -8);
    add(g, new THREE.BoxGeometry(3.2, 0.06, 2), panelMat, -9 + i * 3.6, 2.1, -8, 0.5, 0, 0);
  }
  // Antenna mast
  add(g, new THREE.CylinderGeometry(0.12, 0.2, 14, 8), metal, 9, 7, -6);
  add(g, new THREE.SphereGeometry(1.4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), white, 9, 12.5, -6, 0.6, 0, 0);
  const beacon = keep(add(g, new THREE.SphereGeometry(0.2, 8, 6), glow(0xff3030, 5), 9, 14.2, -6));
  // Crates
  const crate = new RoundedBoxGeometry(1.4, 1, 1, 2, 0.06);
  for (let i = 0; i < 6; i++) add(g, crate, i % 2 ? orange : dark, -6 + (i % 3) * 1.6, 0.8 + Math.floor(i / 3), 6 + rng.range(-0.2, 0.2), 0, rng.range(-0.3, 0.3), 0);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2), decalMaterial({ lines: ['OUTPOST ' + rng.int(2, 19), 'SURVEY CORPS'], accent: '#39d0ff' }));
  sign.position.set(-3, 5.9, 0.3); sign.rotation.set(-0.4, 0.1, 0);
  g.add(sign);
  return {
    group: g,
    loot: [{ pos: V(-4.4, 0.4, 6), key: 'supplies' }, { pos: V(-1.5, 0.4, 0.8), key: 'datalog' }],
    update(dt, t) { beacon.material.emissiveIntensity = Math.sin(t * 3) > 0.6 ? 6 : 0.3; },
  };
}

// Nomad camp: hide tents around a fire, lanterns, a totem and a trade stall.
function camp(rng, ctx) {
  const g = new THREE.Group();
  const fabricCols = [0xb4553a, 0xd9b36c, 0x6f8c5a, 0x8a4e6e, 0xc47d3a];
  const pole = new THREE.MeshStandardMaterial({ color: 0x5a3d25, roughness: 0.8 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3, d = 11;
    const fab = new THREE.MeshStandardMaterial({ color: fabricCols[i], roughness: 0.92, side: THREE.DoubleSide });
    const tent = add(g, new THREE.ConeGeometry(3.4, 5.2, 9, 1, true), fab, Math.cos(a) * d, 2.6, Math.sin(a) * d, 0, a, 0);
    tent.scale.set(1, 1, 0.9);
    add(g, new THREE.CylinderGeometry(0.06, 0.06, 6.4, 5), pole, Math.cos(a) * d, 3.2, Math.sin(a) * d);
    // Door flap glow at night
    add(g, new THREE.PlaneGeometry(1.2, 1.8), glow(0xffb060, 0.8), Math.cos(a) * (d - 3), 0.95, Math.sin(a) * (d - 3), 0, -a - Math.PI / 2, 0);
  }
  // Fire pit
  const ring = new THREE.BoxGeometry(0.6, 0.35, 0.4);
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; add(g, ring, stone(0x777066), Math.cos(a) * 1.3, 0.18, Math.sin(a) * 1.3, 0, -a, 0); }
  for (let i = 0; i < 4; i++) add(g, new THREE.CylinderGeometry(0.1, 0.12, 1.6, 6), pole, 0, 0.25, 0, Math.PI / 2, (i * Math.PI) / 4, 0.3);
  const embers = keep(add(g, new THREE.CircleGeometry(0.9, 16).rotateX(-Math.PI / 2), glow(0xff5a1a, 3), 0, 0.12, 0));
  // Lantern posts
  const lanterns = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    add(g, new THREE.CylinderGeometry(0.07, 0.09, 3, 6), pole, Math.cos(a) * 6, 1.5, Math.sin(a) * 6);
    lanterns.push(keep(add(g, new THREE.SphereGeometry(0.28, 10, 8), glow(0xffc070, 2.5), Math.cos(a) * 6, 3.1, Math.sin(a) * 6)));
  }
  // Totem with glyphs
  add(g, new THREE.CylinderGeometry(0.5, 0.7, 6, 6), glyphMaterial(0xffb13d), 0, 3, -6);
  add(g, new THREE.BoxGeometry(3, 0.3, 0.3), pole, 0, 5.2, -6);
  // Trade stall with awning and goods
  add(g, new THREE.BoxGeometry(3.5, 1.1, 1.3), pole, 7, 0.55, 5, 0, -0.8, 0);
  add(g, new THREE.BoxGeometry(4, 0.08, 2.4), new THREE.MeshStandardMaterial({ color: 0x3e7fa0, roughness: 0.9, side: THREE.DoubleSide }), 7, 2.6, 5, 0.2, -0.8, 0);
  for (let i = 0; i < 4; i++) add(g, new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: rng.pick([0xffb13d, 0x72e08a, 0xff5d5d, 0xc78bff]), roughness: 0.5 }), 6 + i * 0.5, 1.3, 5 - i * 0.4);
  const fire = new Particles(80, { additive: true });
  const smoke = new Particles(60);
  g.add(fire.points, smoke.points);
  let acc = 0;
  return {
    group: g,
    loot: [{ pos: V(6.5, 0.5, 5.5), key: 'trade' }, { pos: V(0, 0.4, -4.8), key: 'totem' }],
    update(dt, t, near) {
      embers.material.emissiveIntensity = 2.5 + Math.sin(t * 7) * 0.6 + Math.sin(t * 13) * 0.4;
      for (const [i, l] of lanterns.entries()) l.material.emissiveIntensity = 2.2 + Math.sin(t * 5 + i) * 0.3;
      if (!near) return;
      acc += dt;
      while (acc > 1 / 25) {
        acc -= 1 / 25;
        fire.emit(V(rng.range(-0.5, 0.5), 0.3, rng.range(-0.5, 0.5)), V(rng.range(-0.3, 0.3), rng.range(1.5, 3), rng.range(-0.3, 0.3)), { color: [1, 0.5, 0.15], size: 0.9, life: 0.8, grow: -0.7 });
        if (rng.next() < 0.3) smoke.emit(V(0, 1.6, 0), V(0.3, 1.5, 0), { color: [0.3, 0.28, 0.26], size: 1.2, life: 6, grow: 1.4, drag: 0.1 });
      }
      fire.update(dt, V(0, 0.8, 0));
      smoke.update(dt, V(0.1, 0.1, 0));
    },
    dispose() { fire.dispose(); smoke.dispose(); },
  };
}

// Monolith: a towering obsidian slab with floating glyph rings and a light
// column that reaches the clouds.
function monolith(rng, ctx) {
  const g = new THREE.Group();
  const obs = new THREE.MeshPhysicalMaterial({ color: 0x07070a, roughness: 0.12, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.02 });
  add(g, new THREE.CylinderGeometry(9, 11, 1.2, 8), stone(0x4a4750), 0, 0.6, 0);
  add(g, new THREE.BoxGeometry(4, 26, 1.6), obs, 0, 14.2, 0);
  add(g, new THREE.BoxGeometry(0.4, 22, 0.05), glyphMaterial(ctx.glow || 0xc78bff), 0, 14, 0.83);
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = keep(add(g, new THREE.TorusGeometry(4.5 + i * 1.6, 0.14, 8, 64), glow(ctx.glow || 0xc78bff, 2.5), 0, 9 + i * 6, 0, Math.PI / 2 + rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)));
    rings.push(r);
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(g, new THREE.BoxGeometry(0.8, rng.range(1.5, 4), 0.8), obs, Math.cos(a) * 8, 1.8, Math.sin(a) * 8, 0, a, rng.range(-0.1, 0.1));
  }
  const pillar = beaconPillar(ctx.glow || 0xc78bff, 600, 1.6);
  pillar.position.y = 27.5;
  g.add(pillar);
  return {
    group: g,
    loot: [{ pos: V(0, 1.2, 2.2), key: 'touch' }],
    update(dt, t) {
      rings.forEach((r, i) => { r.rotation.z += dt * (0.3 + i * 0.15) * (i % 2 ? -1 : 1); r.position.y = 9 + i * 6 + Math.sin(t * 0.8 + i) * 0.5; });
      pillar.material.opacity = 0.12 + Math.sin(t * 0.9) * 0.05;
    },
  };
}

// Giant fossil: the skeleton of a long-dead leviathan half-buried in the ground.
function fossil(rng, ctx) {
  const g = new THREE.Group();
  const bone = new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.8, map: texture('asteroid_diff.jpg', { srgb: true, repeat: 1 }), normalMap: texture('asteroid_nor.jpg', { repeat: 2 }), normalScale: new THREE.Vector2(0.8, 0.8) });
  bone.color.multiplyScalar(1.7);
  // The spine arcs out of the ground and back in.
  const curve = new THREE.CatmullRomCurve3([V(-30, -2, 0), V(-18, 2.2, 3), V(-4, 3.8, 0), V(10, 3.2, -3), V(22, 1.2, -1), V(30, -0.2, 2)]);
  const body = new THREE.CylinderGeometry(0.55, 0.65, 1, 8);
  const spike = new THREE.ConeGeometry(0.22, 1, 6);
  for (let i = 0; i <= 40; i++) {
    const u = i / 40;
    const p = curve.getPoint(u), tan = curve.getTangent(u);
    const s = 0.6 + Math.sin(u * Math.PI) * 0.8;
    const vert = new THREE.Group();
    vert.position.copy(p);
    vert.quaternion.setFromUnitVectors(V(0, 1, 0), tan);
    add(vert, body, bone, 0, 0, 0).scale.set(s, 0.55, s);
    g.add(vert);
    // Dorsal spine pointing up, tilted back along the body.
    const sp = add(g, spike, bone, p.x - tan.x * 0.4, p.y + 1.3 * s, p.z - tan.z * 0.4, tan.z * 0.4, 0, tan.x * 0.4);
    sp.scale.set(s, 2.4 * s, s);
    if (u > 0.18 && u < 0.72 && i % 2 === 0) {
      // A pair of curved ribs hanging down from the vertebra.
      const size = 3 + Math.sin(((u - 0.18) / 0.54) * Math.PI) * 4.5;
      const rib = new THREE.TorusGeometry(size, 0.18 + size * 0.02, 6, 20, Math.PI * 0.9);
      const r = new THREE.Mesh(rib, bone);
      r.position.copy(p).add(V(0, -size * 0.02, 0));
      r.lookAt(p.clone().add(tan));
      r.rotateZ(Math.PI * 1.05 + rng.range(-0.08, 0.08));
      r.castShadow = true;
      g.add(r);
    }
  }
  // Skull with jaw, eye sockets and horns
  const head = curve.getPoint(1);
  const skull = new THREE.Group();
  skull.position.set(head.x + 3, head.y + 0.6, head.z);
  skull.rotation.z = -0.35;
  add(skull, new THREE.SphereGeometry(2.6, 18, 12), bone, 0, 0, 0).scale.set(1.7, 0.85, 1);
  add(skull, new THREE.ConeGeometry(1.4, 5, 10), bone, 4.2, -0.2, 0, 0, 0, -Math.PI / 2).scale.set(1, 1, 0.8);
  add(skull, new THREE.BoxGeometry(6, 0.6, 1.8), bone, 3.2, -2, 0, 0, 0, 0.25);
  for (let k = 0; k < 7; k++) for (const s of [-1, 1]) add(skull, new THREE.ConeGeometry(0.14, 0.9, 5), bone, 1.6 + k * 0.7, -1.1, s * 0.7, Math.PI, 0, 0);
  for (const s of [-1, 1]) add(skull, new THREE.SphereGeometry(0.7, 10, 8), new THREE.MeshStandardMaterial({ color: 0x0a0806, roughness: 1 }), 1.4, 0.8, s * 1.9);
  for (const s of [-1, 1]) add(skull, new THREE.ConeGeometry(0.45, 5.5, 8), bone, -1.2, 2.6, s * 1.6, s * 0.45, 0, 0.7);
  g.add(skull);
  // Scattered bone fragments
  for (let i = 0; i < 12; i++) add(g, body, bone, rng.range(-25, 25), 0.2, rng.range(6, 14) * (rng.next() < 0.5 ? -1 : 1), Math.PI / 2, rng.range(0, 3), 0).scale.set(0.5, rng.range(1, 3), 0.5);
  g.scale.setScalar(1.2);
  return { group: g, loot: [{ pos: V(-2, 0.5, 5), key: 'fossil' }], update() {} };
}

// Crystal grove: giant faceted prisms glowing from within.
function crystals(rng, ctx) {
  const g = new THREE.Group();
  const color = new THREE.Color(ctx.crystal || rng.pick([0x7fe8ff, 0xc78bff, 0x6bffb0, 0xff7ad1]));
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.08, metalness: 0.05, clearcoat: 1, transparent: true, opacity: 0.88, emissive: color.clone().multiplyScalar(0.55), emissiveIntensity: 1, flatShading: true });
  const prism = new THREE.CylinderGeometry(0.6, 1, 1, 6, 1);
  const tip = new THREE.ConeGeometry(1, 1, 6);
  const crystalsList = [];
  for (let i = 0; i < 28; i++) {
    const a = rng.range(0, Math.PI * 2), d = Math.pow(rng.next(), 0.7) * 14;
    const h = rng.range(3, 16) * (1 - d / 22), w = rng.range(0.6, 1.8);
    const c = new THREE.Group();
    c.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    c.rotation.set(rng.range(-0.45, 0.45), rng.range(0, 3), rng.range(-0.45, 0.45));
    const body = add(c, prism, mat, 0, h / 2, 0); body.scale.set(w, h, w);
    const tp = add(c, tip, mat, 0, h + w * 0.8, 0); tp.scale.set(w * 0.6, w * 1.6, w * 0.6);
    g.add(c);
    crystalsList.push(c);
  }
  add(g, new THREE.CircleGeometry(16, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(0.5), transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.1, 0);
  return { group: g, loot: [{ pos: V(2, 0.5, 2), key: 'crystal' }], update(dt, t) { mat.emissiveIntensity = 0.8 + Math.sin(t * 0.9) * 0.25; } };
}

export const POI_BUILDERS = { ruins, crash, outpost, camp, monolith, fossil, crystals };

// Planet-flavoured palette for stone, glow and crystal colours.
export function poiContext(def) {
  const t = def.type;
  return {
    stone: t === 'desert' ? 0xd2b48a : t === 'ice' ? 0xb8c8d8 : t === 'lava' ? 0x4a4040 : t === 'fungal' ? 0x9a8aa0 : 0xb0a58e,
    glow: t === 'lava' ? 0xff7a3d : t === 'toxic' ? 0x9dff5a : t === 'ice' ? 0x7fe8ff : 0x7fe8ff,
    crystal: t === 'ice' ? 0x9fe8ff : t === 'lava' ? 0xff6a2a : t === 'toxic' ? 0x9dff5a : null,
  };
}
