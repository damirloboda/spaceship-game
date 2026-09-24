// Procedural PBR surfaces for props (jetpack, shop items): carbon-fibre
// weave, brushed metal, painted panels on the photographed hull maps, and
// canvas decals (warning labels, gauges). Textures are made once and shared.
import * as THREE from 'three';
import { texture } from './textures.js';

const cache = {};

function canvasTex(w, h, draw, { srgb = true, repeat = 1 } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  return t;
}

// 2x2 twill weave: albedo with sheen bands, and a matching normal map.
function carbonMaps() {
  if (cache.carbon) return cache.carbon;
  const N = 256, cell = 16;
  const tow = (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) & 1);
  const img = (fn, srgb) => canvasTex(N, N, (g) => {
    const d = g.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const horiz = tow(x, y);
      const u = horiz ? (y % cell) / cell : (x % cell) / cell;
      fn(d.data, (y * N + x) * 4, horiz, u);
    }
    g.putImageData(d, 0, 0);
  }, { srgb });
  const map = img((a, o, horiz, u) => {
    const v = 18 + Math.sin(u * Math.PI) * (horiz ? 30 : 22) + Math.random() * 4;
    a[o] = v; a[o + 1] = v + 1; a[o + 2] = v + 4; a[o + 3] = 255;
  }, true);
  const normal = img((a, o, horiz, u) => {
    const s = Math.cos(u * Math.PI) * 0.6;
    a[o] = ((horiz ? 0 : s) * 0.5 + 0.5) * 255; a[o + 1] = ((horiz ? s : 0) * 0.5 + 0.5) * 255; a[o + 2] = 235; a[o + 3] = 255;
  }, false);
  cache.carbon = { map, normal };
  return cache.carbon;
}

// Fine directional streaks for brushed metal roughness.
function brushedMap() {
  if (cache.brushed) return cache.brushed;
  cache.brushed = canvasTex(512, 64, (g, w, h) => {
    g.fillStyle = '#6b6b6b'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      const y = Math.random() * h, v = 80 + Math.random() * 90;
      g.fillStyle = `rgba(${v},${v},${v},0.35)`;
      g.fillRect(0, y, w, 0.6 + Math.random());
    }
  }, { srgb: false });
  return cache.brushed;
}

export function carbonMaterial(repeat = 3, tint = 0xffffff) {
  const { map, normal } = carbonMaps();
  const m = map.clone(); m.repeat.set(repeat, repeat); m.needsUpdate = true;
  const n = normal.clone(); n.repeat.set(repeat, repeat); n.needsUpdate = true;
  return new THREE.MeshPhysicalMaterial({ color: tint, map: m, normalMap: n, normalScale: new THREE.Vector2(0.6, 0.6), metalness: 0.25, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
}

export function brushedMetal(color = 0xc9ced6, rough = 0.28) {
  return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: rough, roughnessMap: brushedMap(), envMapIntensity: 1.3 });
}

// Painted hull panels: the photographed plating maps under a paint colour.
export function paintedPanel(color = 0x3b4350, repeat = 1) {
  return new THREE.MeshPhysicalMaterial({
    color,
    map: texture('hull_diff.jpg', { srgb: true, repeat }),
    normalMap: texture('hull_nor.jpg', { repeat }),
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: texture('hull_rough.jpg', { repeat }),
    roughness: 0.85, metalness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 1,
  });
}

// Printed label: stripes, text lines and a serial, on a transparent card.
export function decalMaterial({ lines = [], accent = '#ffb13d', bg = 'rgba(20,24,30,0.92)', w = 256, h = 128, hazard = false } = {}) {
  const tex = canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (hazard) {
      g.save(); g.beginPath(); g.rect(0, h - 22, w, 22); g.clip();
      for (let x = -40; x < w + 40; x += 26) { g.fillStyle = accent; g.beginPath(); g.moveTo(x, h); g.lineTo(x + 13, h); g.lineTo(x + 35, h - 22); g.lineTo(x + 22, h - 22); g.fill(); }
      g.restore();
    }
    g.fillStyle = accent; g.fillRect(0, 0, 8, h - (hazard ? 22 : 0));
    lines.forEach((l, i) => {
      g.fillStyle = i === 0 ? '#ffffff' : 'rgba(220,230,240,0.8)';
      g.font = `${i === 0 ? 'bold 30' : '16'}px monospace`;
      g.fillText(l, 18, 36 + i * 24);
    });
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.1, transparent: true, polygonOffset: true, polygonOffsetFactor: -2 });
}

// Round pressure gauge face with a needle.
export function gaugeMaterial(accent = '#39d0ff') {
  const tex = canvasTex(128, 128, (g) => {
    g.fillStyle = '#e9edf2'; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#1a1d22'; g.lineWidth = 3;
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); g.lineTo(64 + Math.cos(a) * (i % 5 ? 52 : 56), 64 + Math.sin(a) * (i % 5 ? 52 : 56)); g.stroke();
    }
    g.strokeStyle = '#e0433a'; g.lineWidth = 6;
    g.beginPath(); g.arc(64, 64, 50, Math.PI * 1.95, Math.PI * 2.25); g.stroke();
    g.strokeStyle = accent; g.lineWidth = 4;
    g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(-0.5) * 46, 64 + Math.sin(-0.5) * 46); g.stroke();
    g.fillStyle = '#1a1d22'; g.beginPath(); g.arc(64, 64, 6, 0, Math.PI * 2); g.fill();
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02 });
}
