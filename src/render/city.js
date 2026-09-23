// A procedural Veyari city: terraced dome towers, market, lab, hospital,
// workshops, spaceport. Citizens follow daily schedules (sleep, work,
// market, home) driven by the planet's real day/night cycle.
import * as THREE from 'three';
import { RNG, hashString } from '../core/rng.js';
import { tangentFrame, offsetOnSphere } from '../world/planetGen.js';
import { generateCitizens, CIVILIZATIONS } from '../world/civGen.js';
import { colorize, merge, humanoidModel, animateHumanoid } from './models.js';
import { animatedInstance, CHARACTER_MODELS } from './modelLib.js';
import { orientOnSurface } from './fauna.js';

const LAYOUT = [
  { ring: 78, kinds: ['market', 'restaurant', 'hotel', 'hospital', 'lab', 'market'] },
  { ring: 145, kinds: ['workshop', 'residential', 'factory', 'residential', 'workshop', 'residential', 'lab', 'residential'] },
  { ring: 215, kinds: ['residential', 'farm', 'residential', 'residential', 'farm', 'residential', 'residential', 'residential', 'residential', 'residential'] },
];

export const CITY_RADIUS = 260;

export class City {
  constructor(body, site, { name = 'City', civIndex = 0, seed = 1, npcCount = 22 } = {}) {
    this.body = body;
    this.name = name;
    this.civ = CIVILIZATIONS[civIndex] || CIVILIZATIONS[0];
    this.dir = site.dir;
    this.height = site.height;
    this.R = body.surface.radius;
    this.groundR = this.R + this.height;
    this.frame = tangentFrame(this.dir);
    this.origin = new THREE.Vector3(...this.dir).multiplyScalar(this.groundR);
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.rng = new RNG(seed);
    this.buildings = [];
    this.colliders = [];
    this.interactables = [];
    this.lamps = [];
    this.layout();
    this.buildMeshes();
    this.citizens = generateCitizens(civIndex, seed, npcCount, this.buildings);
    this.npcs = this.citizens.map((c) => this.spawnNpc(c));
    // Spaceport pad sits outside the ring.
    this.pad = { x: 0, z: -CITY_RADIUS - 70, radius: 34 };
  }

  toLocal(x, z, y = 0, out = new THREE.Vector3()) {
    const d = offsetOnSphere(this.dir, this.frame, x, z, this.R);
    return out.set(d[0], d[1], d[2]).multiplyScalar(this.groundR + y);
  }

  layout() {
    let index = 0;
    const rng = this.rng;
    const sizes = {
      residential: [9, 13, 18, 34], market: [14, 16, 6, 9], restaurant: [8, 9, 6, 8], hotel: [9, 10, 34, 46],
      hospital: [12, 14, 12, 16], lab: [13, 16, 12, 16], workshop: [10, 13, 8, 10], factory: [14, 17, 10, 13], farm: [12, 15, 6, 8],
    };
    for (const ringDef of LAYOUT) {
      const n = ringDef.kinds.length;
      const offset = rng.range(0, Math.PI * 2);
      ringDef.kinds.forEach((kind, i) => {
        const a = offset + (i / n) * Math.PI * 2;
        const [r0, r1, h0, h1] = sizes[kind];
        const radius = rng.range(r0, r1);
        const x = Math.cos(a) * ringDef.ring, z = Math.sin(a) * ringDef.ring;
        const len = Math.hypot(x, z);
        const b = {
          index: index++, kind, x, z, radius, height: rng.range(h0, h1), angle: a,
          door: { x: x - (x / len) * (radius + 1.5), z: z - (z / len) * (radius + 1.5) },
        };
        this.buildings.push(b);
        this.colliders.push({ x, z, r: radius });
      });
    }
    // Plaza monument
    this.colliders.push({ x: 0, z: 0, r: 3 });
  }

  buildMeshes() {
    const wall = [], glow = [], glass = [];
    const [c0, c1, c2] = this.civ.colors;
    const rng = this.rng;
    const put = (list, geo, color, x, z, rotY = 0) => {
      if (rotY) geo.rotateY(rotY);
      geo.translate(x, 0, z);
      list.push(color ? colorize(geo, color) : colorize(geo, [1, 1, 1]));
    };
    for (const b of this.buildings) {
      const { x, z, radius: r, height: h } = b;
      switch (b.kind) {
        case 'residential':
        case 'hotel': {
          const tiers = b.kind === 'hotel' ? 5 : rng.int(2, 4);
          let y = 0, rr = r;
          for (let t = 0; t < tiers; t++) {
            const th = h / tiers;
            const g = new THREE.CylinderGeometry(rr * 0.9, rr, th, 16);
            g.translate(0, y + th / 2, 0);
            put(wall, g, c0.map((v) => v * (1 - t * 0.04)), x, z);
            const band = new THREE.CylinderGeometry(rr * 0.905, rr * 0.93, th * 0.18, 16, 1, true);
            band.translate(0, y + th * 0.55, 0);
            put(glow, band, null, x, z);
            y += th;
            rr *= 0.82;
          }
          const dome = new THREE.SphereGeometry(rr, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
          dome.translate(0, y, 0);
          put(wall, dome, c1, x, z);
          break;
        }
        case 'market': {
          const base = new THREE.CylinderGeometry(r, r, 1, 20);
          base.translate(0, 0.5, 0);
          put(wall, base, [0.6, 0.55, 0.48], x, z);
          for (let s = 0; s < 6; s++) {
            const a = (s / 6) * Math.PI * 2;
            const post = new THREE.CylinderGeometry(0.15, 0.15, 4, 5);
            post.translate(Math.cos(a) * r * 0.6, 3, Math.sin(a) * r * 0.6);
            put(wall, post, [0.3, 0.3, 0.3], x, z);
            const can = new THREE.ConeGeometry(3.2, 1.6, 6);
            can.translate(Math.cos(a) * r * 0.6, 5.6, Math.sin(a) * r * 0.6);
            put(wall, can, s % 2 ? c2 : c1, x, z);
            const stall = new THREE.BoxGeometry(2.4, 1.1, 1.2);
            stall.translate(Math.cos(a) * r * 0.6, 1.55, Math.sin(a) * r * 0.6);
            put(wall, stall, [0.55, 0.4, 0.28], x, z);
          }
          break;
        }
        case 'lab': {
          const base = new THREE.CylinderGeometry(r, r, 3, 20);
          base.translate(0, 1.5, 0);
          put(wall, base, [0.85, 0.88, 0.9], x, z);
          const dome = new THREE.SphereGeometry(r * 0.95, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
          dome.scale(1, h / r, 1); dome.translate(0, 3, 0);
          put(glass, dome, [0.6, 0.85, 1.0], x, z);
          const core = new THREE.CylinderGeometry(r * 0.2, r * 0.25, h * 0.8, 10);
          core.translate(0, 3 + h * 0.4, 0);
          put(glow, core, null, x, z);
          const ring = new THREE.TorusGeometry(r * 1.02, 0.4, 6, 32);
          ring.rotateX(Math.PI / 2); ring.translate(0, 3, 0);
          put(wall, ring, c1, x, z);
          break;
        }
        case 'hospital': {
          const g = new THREE.BoxGeometry(r * 1.6, h, r * 1.2);
          g.translate(0, h / 2, 0);
          put(wall, g, [0.95, 0.96, 0.97], x, z, -b.angle);
          const w = new THREE.BoxGeometry(r * 1.62, h * 0.12, r * 1.22);
          w.translate(0, h * 0.6, 0);
          put(glow, w, null, x, z, -b.angle);
          const crossA = new THREE.BoxGeometry(0.8, 4, 0.8); crossA.translate(0, h + 2.2, 0);
          const crossB = new THREE.BoxGeometry(4, 0.8, 0.8); crossB.translate(0, h + 2.2, 0);
          put(wall, crossA, [0.2, 0.85, 0.75], x, z, -b.angle);
          put(wall, crossB, [0.2, 0.85, 0.75], x, z, -b.angle);
          break;
        }
        case 'restaurant': {
          const g = new THREE.SphereGeometry(r * 0.8, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
          g.scale(1, h / (r * 0.8), 1);
          put(wall, g, c2, x, z);
          const awn = new THREE.CylinderGeometry(r * 1.05, r * 1.05, 0.3, 16, 1, false, 0, Math.PI);
          awn.translate(0, 2.8, 0);
          put(wall, awn, [0.8, 0.25, 0.2], x, z, -b.angle + Math.PI / 2);
          const w = new THREE.CylinderGeometry(r * 0.78, r * 0.8, 1, 14, 1, true);
          w.translate(0, 1.6, 0);
          put(glow, w, null, x, z);
          break;
        }
        case 'workshop':
        case 'factory': {
          const g = new THREE.BoxGeometry(r * 1.7, h, r * 1.4);
          g.translate(0, h / 2, 0);
          put(wall, g, b.kind === 'factory' ? [0.45, 0.43, 0.4] : [0.62, 0.55, 0.45], x, z, -b.angle);
          const roof = new THREE.CylinderGeometry(r * 0.72, r * 0.72, r * 1.7, 3, 1);
          roof.rotateZ(Math.PI / 2); roof.scale(1, 0.4, 1); roof.translate(0, h + r * 0.14, 0);
          put(wall, roof, c1.map((v) => v * 0.7), x, z, -b.angle);
          if (b.kind === 'factory') {
            for (const off of [-0.4, 0.3]) {
              const ch = new THREE.CylinderGeometry(1.2, 1.6, h * 1.6, 8);
              ch.translate(off * r, h * 0.8, r * 0.3);
              put(wall, ch, [0.35, 0.33, 0.32], x, z, -b.angle);
            }
          }
          const door = new THREE.BoxGeometry(r * 0.8, h * 0.6, 0.3);
          door.translate(0, h * 0.3, -r * 0.71);
          put(glow, door, null, x, z, -b.angle + Math.PI / 2);
          break;
        }
        case 'farm': {
          for (let i = 0; i < 3; i++) {
            const g = new THREE.SphereGeometry(r * 0.45, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            g.translate((i - 1) * r * 0.9, 0, 0);
            put(glass, g, [0.7, 1.0, 0.8], x, z, -b.angle);
            const crop = new THREE.CylinderGeometry(r * 0.4, r * 0.4, 1.2, 12);
            crop.translate((i - 1) * r * 0.9, 0.6, 0);
            put(wall, crop, [0.25, 0.6, 0.2], x, z, -b.angle);
          }
          break;
        }
        default:
          break;
      }
    }
    // Plaza paving and monument
    const pave = new THREE.RingGeometry(0.5, 50, 48, 8);
    pave.rotateX(-Math.PI / 2); pave.translate(0, 0.08, 0);
    wall.push(colorize(pave, [0.72, 0.68, 0.6]));
    const street = new THREE.RingGeometry(50, CITY_RADIUS, 64, 14);
    street.rotateX(-Math.PI / 2); street.translate(0, 0.05, 0);
    wall.push(colorize(street, [0.52, 0.5, 0.47]));
    const spire = new THREE.CylinderGeometry(0.4, 2.2, 22, 6);
    spire.translate(0, 11, 0);
    wall.push(colorize(spire, c1));
    const crystal = new THREE.OctahedronGeometry(2.4, 0);
    crystal.scale(1, 1.6, 1); crystal.translate(0, 25, 0);
    glow.push(colorize(crystal, [1, 1, 1]));
    // Street lamps on two rings
    for (const [ring, count] of [[50, 12], [112, 20], [180, 26]]) {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + ring;
        const px = Math.cos(a) * ring, pz = Math.sin(a) * ring;
        const post = new THREE.CylinderGeometry(0.08, 0.12, 4.5, 5);
        post.translate(px, 2.25, pz);
        wall.push(colorize(post, [0.25, 0.25, 0.28]));
        const bulb = new THREE.SphereGeometry(0.35, 6, 4);
        bulb.translate(px, 4.6, pz);
        glow.push(colorize(bulb, [1, 1, 1]));
      }
    }
    // Spaceport pad with control tower
    const padZ = -CITY_RADIUS - 70;
    const pad = new THREE.RingGeometry(0.5, 34, 40, 6);
    pad.rotateX(-Math.PI / 2); pad.translate(0, 0.12, padZ);
    wall.push(colorize(pad, [0.3, 0.32, 0.36]));
    const padRing = new THREE.RingGeometry(24, 26, 40, 1);
    padRing.rotateX(-Math.PI / 2); padRing.translate(0, 0.16, padZ);
    glow.push(colorize(padRing, [1, 1, 1]));
    const road = new THREE.PlaneGeometry(8, 60, 1, 10);
    road.rotateX(-Math.PI / 2); road.translate(0, 0.1, -CITY_RADIUS - 10 + 22);
    wall.push(colorize(road, [0.35, 0.35, 0.38]));
    const tower = new THREE.CylinderGeometry(2, 3, 18, 8);
    tower.translate(30, 9, padZ + 30);
    wall.push(colorize(tower, [0.8, 0.8, 0.82]));
    const cab = new THREE.CylinderGeometry(4, 3, 3, 8);
    cab.translate(30, 19.5, padZ + 30);
    glow.push(colorize(cab, [1, 1, 1]));
    this.colliders.push({ x: 30, z: padZ + 30, r: 3.2 });

    const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
    this.glowMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x000000, emissive: new THREE.Color(1.0, 0.82, 0.5), emissiveIntensity: 0.2, roughness: 0.4 });
    const glassMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.3 });
    for (const [list, mat, shadows] of [[wall, wallMat, true], [glow, this.glowMat, false], [glass, glassMat, false]]) {
      if (!list.length) continue;
      const geo = merge(list);
      this.bend(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(this.origin);
      mesh.castShadow = shadows;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.materials = [wallMat, this.glowMat, glassMat];
  }

  // Map flat city-space geometry onto the curved planet surface.
  bend(geo) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const v = new THREE.Vector3();
    const { east, up, north } = this.frame;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      this.toLocal(x, z, y, v).sub(this.origin);
      pos.setXYZ(i, v.x, v.y, v.z);
      if (nor) {
        const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
        nor.setXYZ(i, east[0] * nx + up[0] * ny + north[0] * nz, east[1] * nx + up[1] * ny + north[1] * nz, east[2] * nx + up[2] * ny + north[2] * nz);
      }
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  spawnNpc(c) {
    // Citizens are animated astronauts; a few are service robots.
    const hsh = hashString(c.name + c.home) >>> 0;
    const robot = hsh % 10 === 0;
    const name = robot ? (hsh % 20 === 0 ? 'usk_Mech' : 'usk_Mech-D5wW2jDO42') : CHARACTER_MODELS[hsh % CHARACTER_MODELS.length];
    const anim = animatedInstance(name, robot ? c.height * 1.25 : c.height, { yaw: Math.PI });
    let model;
    if (anim) model = anim.root;
    else {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true });
      model = humanoidModel([c.color, [0.75, 0.62, 0.55]], c.height, mat);
    }
    this.group.add(model);
    const home = this.buildings[c.home];
    return { c, model, anim, x: home.door.x, z: home.door.z, tx: home.door.x, tz: home.door.z, state: 'sleep', speed: 0, wander: 0, t: Math.random() * 10, talkTimer: 0, heading: 0 };
  }

  // hour: local solar time 0..24
  activityFor(c, hour) {
    const s = c.schedule;
    if (hour < s.wake || hour >= s.sleep) return 'sleep';
    if (hour < s.workStart) return 'commute';
    if (hour < s.workEnd) return 'work';
    if (hour < s.marketUntil) return 'market';
    return 'social';
  }

  update(dt, hour, playerLocal) {
    const night = hour < 6.2 || hour > 18.8;
    const dusk = Math.min(1, Math.max(0, Math.abs(hour - 12) - 5.5));
    this.glowMat.emissiveIntensity = night ? 1.3 : 0.15 + dusk * 0.5;
    const tmp = new THREE.Vector3();
    const up = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    for (const n of this.npcs) {
      const act = this.activityFor(n.c, hour);
      n.t += dt;
      if (act === 'sleep') {
        n.model.visible = false;
        const home = this.buildings[n.c.home];
        n.x = home.door.x; n.z = home.door.z;
        n.state = 'sleep';
        continue;
      }
      n.model.visible = true;
      // Choose a destination for the current activity.
      n.wander -= dt;
      if (n.state !== act || n.wander <= 0) {
        n.state = act;
        n.wander = 6 + Math.random() * 10;
        let dest;
        if (act === 'work') dest = this.buildings[n.c.work].door;
        else if (act === 'market') dest = this.buildings.find((b) => b.kind === 'market').door;
        else if (act === 'commute') dest = this.buildings[n.c.work].door;
        else dest = { x: 0, z: 0 };
        const spread = act === 'social' ? 38 : 6;
        const a = Math.random() * Math.PI * 2;
        n.tx = dest.x + Math.cos(a) * Math.random() * spread;
        n.tz = dest.z + Math.sin(a) * Math.random() * spread;
      }
      if (n.talkTimer > 0) { n.talkTimer -= dt; n.speed = 0; }
      else {
        let dx = n.tx - n.x, dz = n.tz - n.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.6) {
          dx /= d; dz /= d;
          // Steer around buildings.
          for (const col of this.colliders) {
            const ox = n.x - col.x, oz = n.z - col.z;
            const od = Math.hypot(ox, oz);
            const lim = col.r + 2.5;
            if (od < lim && od > 0.01) {
              const k = (lim - od) / lim;
              dx += (ox / od) * k * 2.2 + (-oz / od) * k * 1.4;
              dz += (oz / od) * k * 2.2 + (ox / od) * k * 1.4;
            }
          }
          const l = Math.hypot(dx, dz) || 1;
          n.speed = act === 'commute' ? 1.8 : 1.3;
          n.x += (dx / l) * n.speed * dt;
          n.z += (dz / l) * n.speed * dt;
          n.heading = Math.atan2(dx / l, dz / l);
        } else {
          n.speed = 0;
        }
      }
      this.toLocal(n.x, n.z, 0, tmp);
      n.model.position.copy(tmp);
      up.copy(tmp).normalize();
      const f = offsetOnSphere(this.dir, this.frame, n.x + Math.sin(n.heading), n.z + Math.cos(n.heading), this.R);
      fwd.set(f[0], f[1], f[2]).multiplyScalar(this.groundR).sub(tmp).normalize();
      orientOnSurface(n.model, up, fwd);
      if (n.anim) {
        const near = !playerLocal || tmp.distanceToSquared(playerLocal) < 250 * 250;
        n.anim.play(n.talkTimer > 0 ? 'wave' : n.speed > 0.1 ? 'walk' : 'idle', 0.3, n.speed > 0.1 ? n.speed / 1.6 : 1);
        n.animAcc = (n.animAcc || 0) + dt;
        if (near || n.animAcc > 0.2) { n.anim.update(n.animAcc); n.animAcc = 0; }
      } else animateHumanoid(n.model, n.t, n.speed);
    }
  }

  // Nearest visible NPC to the player within range.
  npcNear(local, range = 3.5) {
    let best = null, bd = range;
    for (const n of this.npcs) {
      if (!n.model.visible) continue;
      const d = n.model.position.distanceTo(local);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // City-plane coordinates for a local position (approx).
  toCity(local) {
    const d = local.clone().normalize();
    const { east, north } = this.frame;
    const rx = d.x - this.dir[0], ry = d.y - this.dir[1], rz = d.z - this.dir[2];
    return { x: (rx * east[0] + ry * east[1] + rz * east[2]) * this.R, z: (rx * north[0] + ry * north[1] + rz * north[2]) * this.R };
  }

  collide(local, radius) {
    const p = this.toCity(local);
    if (Math.hypot(p.x, p.z) > CITY_RADIUS + 120) return null;
    let px = 0, pz = 0;
    for (const c of this.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      const lim = c.r + radius;
      if (d < lim && d > 1e-4) { px += (dx / d) * (lim - d); pz += (dz / d) * (lim - d); }
    }
    if (!px && !pz) return null;
    const { east, north } = this.frame;
    return new THREE.Vector3(east[0] * px + north[0] * pz, east[1] * px + north[1] * pz, east[2] * px + north[2] * pz);
  }

  buildingAt(local, range = 6) {
    const p = this.toCity(local);
    for (const b of this.buildings) {
      if (Math.hypot(p.x - b.door.x, p.z - b.door.z) < range) return b;
    }
    return null;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
  }
}
