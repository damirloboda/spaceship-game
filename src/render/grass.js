// Dense, wind-animated grass around the player. Blades live in small tiles on
// the planet surface; tiles are generated once (deterministically) and the
// instance buffer is rebuilt from cached tiles when the player moves.
import * as THREE from 'three';
import { RNG, hashInts } from '../core/rng.js';

// Blades per m² and blade height (m) per biome.
const GRASSY = {
  grassland: { d: 1, h: 0.55 }, savanna: { d: 0.9, h: 0.8 }, forest: { d: 0.6, h: 0.45 },
  wetland: { d: 0.8, h: 0.9 }, mire: { d: 0.6, h: 0.7 }, tundra: { d: 0.35, h: 0.25 },
  toxicflat: { d: 0.5, h: 0.5 }, fungal: { d: 0.55, h: 0.4 }, sporefield: { d: 0.7, h: 0.5 },
  glowmoss: { d: 0.6, h: 0.3 },
};

const TILE = 6;
const up = new THREE.Vector3(0, 1, 0);

function bladeGeometry() {
  // A clump of thin tapered blades (3 segments each), 1 unit tall, curved and
  // leaning outwards. One instance = one clump, so fields look dense.
  const rng = new RNG(7);
  const segs = 3, blades = 6;
  const pos = [], uv = [], nor = [], idx = [];
  for (let b = 0; b < blades; b++) {
    const a = rng.next() * Math.PI * 2;
    const ox = Math.cos(a) * rng.next() * 0.14, oz = Math.sin(a) * rng.next() * 0.14;
    const yaw = rng.next() * Math.PI * 2, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const hgt = 0.6 + rng.next() * 0.45, w = 0.022 + rng.next() * 0.012;
    const lean = 0.08 + rng.next() * 0.18;
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const ww = w * (1 - t * 0.9);
      const bend = t * t * lean;
      for (const side of [-1, 1]) {
        const lx = side * ww, lz = bend;
        pos.push(ox + lx * cy - lz * sy, t * hgt, oz + lx * sy + lz * cy);
        uv.push(side > 0 ? 1 : 0, t * hgt);
        nor.push(0, 1, 0);
      }
    }
    for (let i = 0; i < segs; i++) {
      const q = base + i * 2;
      idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Normals point up so blades shade like the ground they grow from.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export class GrassField {
  constructor(body, { radius = 36, perTile = 200 } = {}) {
    this.body = body;
    this.surface = body.surface;
    this.radius = radius;
    this.perTile = perTile;
    this.tiles = new Map();
    this.pending = [];
    this.focus = new THREE.Vector3(Infinity, 0, 0);
    this.time = { value: 0 };
    const maxTiles = Math.ceil((Math.PI * (radius + TILE) ** 2) / (TILE * TILE)) + 8;
    this.cap = maxTiles * perTile;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const time = this.time;
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vH;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vH = position.y;
          #ifdef USE_INSTANCING
            vec3 ip = instanceMatrix[3].xyz;
          #else
            vec3 ip = vec3(0.0);
          #endif
          float gust = sin(uTime * 1.3 + ip.x * 0.07 + ip.z * 0.05) * 0.5 + 0.5;
          float wave = sin(uTime * 2.6 + ip.x * 0.9 + ip.y * 0.7 + ip.z * 0.8);
          float k = position.y * position.y;
          transformed.z += (0.12 + gust * 0.2) * k + wave * 0.05 * k;
          transformed.x += (0.05 + gust * 0.08) * k + wave * 0.04 * k;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vH;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          // Darker roots, sunlit tips.
          diffuseColor.rgb *= mix(0.6, 1.45, smoothstep(0.0, 1.0, vH));
          diffuseColor.rgb += vec3(0.05, 0.06, 0.0) * smoothstep(0.5, 1.0, vH);`);
    };
    this.mesh = new THREE.InstancedMesh(bladeGeometry(), this.material, this.cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'grass';
    body.spin.add(this.mesh);
    this.dirty = false;
  }

  // Tiles are latitude/longitude cells about TILE metres across, so they tile
  // the sphere without gaps or overlaps.
  wanted(focus) {
    const R = this.surface.radius;
    const u = focus.clone().normalize();
    const dLat = TILE / R;
    const lat = Math.asin(THREE.MathUtils.clamp(u.y, -1, 1));
    const lon = Math.atan2(u.z, u.x);
    const i0 = Math.floor(lat / dLat);
    const n = Math.ceil(this.radius / TILE) + 1;
    const keys = new Map();
    const p = new THREE.Vector3();
    const fR = u.clone().multiplyScalar(R);
    for (let i = i0 - n; i <= i0 + n; i++) {
      const la = (i + 0.5) * dLat;
      if (Math.abs(la) > Math.PI / 2) continue;
      const cl = Math.max(0.05, Math.cos(la));
      const dLon = dLat / cl;
      const j0 = Math.floor(lon / dLon);
      const nj = Math.ceil(n / cl) + 1;
      for (let j = j0 - nj; j <= j0 + nj; j++) {
        const lo = (j + 0.5) * dLon;
        p.set(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)).multiplyScalar(R);
        if (p.distanceTo(fR) > this.radius + TILE) continue;
        keys.set(`${i},${j}`, { center: p.clone(), la, lo, dLat, dLon });
      }
    }
    return keys;
  }

  buildTile(key, cell) {
    const s = this.surface;
    const R = s.radius;
    const [a, b] = key.split(',').map(Number);
    const rng = new RNG(hashInts(this.body.def.seed, hashInts(a, b)));
    const mats = [], cols = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), yaw = new THREE.Quaternion(), sc = new THREE.Vector3();
    const dir = new THREE.Vector3(), pos = new THREE.Vector3();
    const col = [0, 0, 0];
    // No grass on paved ground: city plazas, spaceport pads, ruins.
    const zones = (s.flatZones || []).filter((z) => z.radius >= 40);
    for (let i = 0; i < this.perTile; i++) {
      const la = cell.la + (rng.next() - 0.5) * cell.dLat;
      const lo = cell.lo + (rng.next() - 0.5) * cell.dLon;
      dir.set(Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo));
      let paved = false;
      for (const z of zones) {
        const d = dir.x * z.x + dir.y * z.y + dir.z * z.z;
        if (Math.acos(Math.min(1, d)) * R < z.radius * 0.9) { paved = true; break; }
      }
      if (paved) continue;
      const h = s.heightAt(dir.x, dir.y, dir.z);
      if (s.hasOcean && h < 0.6) continue;
      const biome = s.biomeAt(dir.x, dir.y, dir.z, h, 0);
      const g = GRASSY[biome];
      if (!g || rng.next() > g.d) continue;
      s.colorAt(dir.x, dir.y, dir.z, h, 0, col, 0);
      pos.copy(dir).multiplyScalar(R + h - 0.08);
      q.setFromUnitVectors(up, dir);
      yaw.setFromAxisAngle(up, rng.next() * Math.PI * 2);
      q.multiply(yaw);
      const hh = g.h * (0.55 + rng.next() * 0.9);
      const wide = 0.8 + rng.next() * 0.5;
      sc.set(wide, hh, wide);
      m.compose(pos, q, sc);
      mats.push(...m.elements);
      const v = (0.9 + rng.next() * 0.35) * 1.3;
      // A touch of yellow at random, like dry stalks among green.
      const dry = rng.next() < 0.12 ? 0.35 : 0;
      cols.push(col[0] * v * (1 + dry), col[1] * v * (1 + dry * 0.4), col[2] * v * (1 - dry * 0.5));
    }
    return { matrices: new Float32Array(mats), colors: new Float32Array(cols), center: cell.center, count: cols.length / 3 };
  }

  update(dt, focus, budgetMs = 2) {
    this.time.value += dt;
    if (!focus) { this.mesh.visible = false; return; }
    const d = focus.clone().normalize();
    const alt = focus.length() - this.surface.radius - this.surface.heightAt(d.x, d.y, d.z);
    this.mesh.visible = alt < 60;
    if (!this.mesh.visible) return;
    if (focus.distanceToSquared(this.focus) > 9) {
      this.focus.copy(focus);
      this.want = this.wanted(focus);
      const fR = focus.clone().normalize().multiplyScalar(this.surface.radius);
      this.pending = [...this.want.entries()].filter(([k]) => !this.tiles.has(k)).sort((x, y) => x[1].center.distanceToSquared(fR) - y[1].center.distanceToSquared(fR));
      for (const k of this.tiles.keys()) if (!this.want.has(k)) this.tiles.delete(k);
      this.dirty = true;
    }
    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < budgetMs) {
      const [k, c] = this.pending.shift();
      this.tiles.set(k, this.buildTile(k, c));
      this.dirty = true;
    }
    if (this.dirty) this.rebuild();
  }

  flush(focus) {
    this.update(0, focus, 1e9);
  }

  rebuild() {
    const im = this.mesh.instanceMatrix.array, ic = this.mesh.instanceColor.array;
    let n = 0;
    for (const t of this.tiles.values()) {
      if (n + t.count > this.cap) break;
      im.set(t.matrices, n * 16);
      ic.set(t.colors, n * 3);
      n += t.count;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.dirty = false;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
