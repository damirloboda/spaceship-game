/**
 * Ground scenery — vegetation, rocks, cities, creatures (§21, §59, §71, §115).
 *
 * Everything here is instanced: one draw call per prop type regardless of how
 * many copies are on screen. Placement is deterministic from the planet seed,
 * so the same boulder is in the same place every time you walk past it, and
 * nothing has to be stored.
 *
 * Props are scattered on a jittered grid over the near terrain patch, with
 * density and species chosen by the biome underfoot — a forest actually looks
 * like a forest, a desert stays sparse, and a crystalline world grows shards
 * instead of trees.
 */
import * as THREE from '../../vendor/three.module.js';
import { RNG, hashInts } from '../core/rng.js';
import { BIOMES } from '../gen/planet.js';
import { tangentBasis } from './terrain.js';
import { foliageTexture, surfaceTexture, facadeTexture, metalTexture } from './textures.js';

/* ------------------------------------------------------------------ */
/* Prop geometry                                                       */
/* ------------------------------------------------------------------ */

/**
 * Low-poly prop geometries, built once and shared. Each is modelled with its
 * base at y=0 and unit-ish height so instance matrices can scale freely.
 */
function buildPropGeometries() {
  const geo = {};

  // Conifer: stacked cones on a trunk.
  {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.06, 0.09, 0.42, 4);
    trunk.translate(0, 0.21, 0);
    parts.push(trunk);
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      const c = new THREE.ConeGeometry(0.34 - t * 0.09, 0.46, 6);
      c.translate(0, 0.42 + t * 0.3 + 0.23, 0);
      parts.push(c);
    }
    geo.conifer = mergeGeometries(parts);
  }

  // Broadleaf: trunk with a lumpy canopy.
  {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.07, 0.11, 0.55, 4);
    trunk.translate(0, 0.275, 0);
    parts.push(trunk);
    const canopy = new THREE.IcosahedronGeometry(0.36, 0);
    canopy.scale(1, 0.78, 1);
    canopy.translate(0, 0.82, 0);
    parts.push(canopy);
    geo.broadleaf = mergeGeometries(parts);
  }

  // Palm-ish: bare stalk with a burst of fronds.
  {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.05, 0.09, 0.9, 4);
    trunk.translate(0, 0.45, 0);
    parts.push(trunk);
    for (let i = 0; i < 5; i++) {
      const frond = new THREE.ConeGeometry(0.07, 0.5, 3);
      frond.rotateZ(Math.PI * 0.42);
      frond.rotateY((i / 5) * Math.PI * 2);
      frond.translate(Math.cos((i / 5) * Math.PI * 2) * 0.2, 0.92, Math.sin((i / 5) * Math.PI * 2) * 0.2);
      parts.push(frond);
    }
    geo.palm = mergeGeometries(parts);
  }

  // Shrub / grass tuft: a few crossed cones.
  {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const blade = new THREE.ConeGeometry(0.09, 0.42, 3);
      blade.rotateZ((i - 1.5) * 0.22);
      blade.translate((i - 1.5) * 0.07, 0.21, (i % 2) * 0.06);
      parts.push(blade);
    }
    geo.shrub = mergeGeometries(parts);
  }

  // Boulder: distorted icosahedron.
  {
    const rock = new THREE.IcosahedronGeometry(0.5, 0);
    const pos = rock.attributes.position;
    const rng = new RNG(4242);
    for (let i = 0; i < pos.count; i++) {
      const f = 0.72 + rng.next() * 0.55;
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.72, pos.getZ(i) * f);
    }
    rock.computeVertexNormals();
    rock.translate(0, 0.22, 0);
    geo.rock = rock;
  }

  // Crystal shard cluster.
  {
    const parts = [];
    for (let i = 0; i < 3; i++) {
      const shard = new THREE.ConeGeometry(0.12 - i * 0.02, 0.7 - i * 0.15, 4);
      shard.rotateZ((i - 1) * 0.3);
      shard.translate((i - 1) * 0.14, (0.7 - i * 0.15) / 2, (i - 1) * 0.1);
      parts.push(shard);
    }
    geo.crystal = mergeGeometries(parts);
  }

  // Mushroom: stalk plus cap.
  {
    const parts = [];
    const stalk = new THREE.CylinderGeometry(0.06, 0.09, 0.5, 4);
    stalk.translate(0, 0.25, 0);
    parts.push(stalk);
    const cap = new THREE.SphereGeometry(0.28, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.62, 1);
    cap.translate(0, 0.5, 0);
    parts.push(cap);
    geo.fungus = mergeGeometries(parts);
  }

  return geo;
}

/** Minimal geometry merge — vendored three build has no BufferGeometryUtils. */
function mergeGeometries(list) {
  let vertexCount = 0, indexCount = 0;
  for (const g of list) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const index = new Uint32Array(indexCount);
  let vo = 0, io = 0, base = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    position.set(p, vo * 3);
    normal.set(n, vo * 3);
    const count = g.attributes.position.count;
    if (g.index) {
      const gi = g.index.array;
      for (let i = 0; i < gi.length; i++) index[io + i] = gi[i] + base;
      io += gi.length;
    } else {
      for (let i = 0; i < count; i++) index[io + i] = i + base;
      io += count;
    }
    vo += count;
    base += count;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setIndex(new THREE.BufferAttribute(index, 1));
  return merged;
}

let PROP_GEO = null;
function propGeometries() {
  if (!PROP_GEO) PROP_GEO = buildPropGeometries();
  return PROP_GEO;
}

/* ------------------------------------------------------------------ */
/* Biome → prop rules                                                  */
/* ------------------------------------------------------------------ */

/**
 * What grows where. `density` is props per 100m x 100m cell; `types` is a
 * weighted list of [propKind, weight, minScale, maxScale].
 */
const BIOME_PROPS = {
  forest:  { density: 26, types: [['conifer', 5, 5, 12], ['broadleaf', 4, 4.5, 10], ['shrub', 4, 0.7, 1.8], ['rock', 1, 0.7, 2.2]] },
  jungle:  { density: 30, types: [['broadleaf', 5, 6, 15], ['palm', 4, 5, 12], ['shrub', 5, 0.8, 2.4], ['fungus', 1, 0.6, 1.6]] },
  grass:   { density: 14, types: [['shrub', 8, 0.5, 1.4], ['broadleaf', 1, 3.5, 8], ['rock', 1.5, 0.5, 1.6]] },
  savanna: { density: 9,  types: [['shrub', 6, 0.6, 1.6], ['palm', 1.5, 5, 11], ['rock', 2, 0.6, 2]] },
  beach:   { density: 3,  types: [['rock', 3, 0.4, 1.4], ['shrub', 1, 0.4, 0.9]] },
  desert:  { density: 3,  types: [['rock', 5, 0.6, 2.6], ['shrub', 1, 0.4, 1.1]] },
  dunes:   { density: 1,  types: [['rock', 3, 0.5, 1.6]] },
  rock:    { density: 7,  types: [['rock', 8, 0.6, 3.4], ['shrub', 1, 0.4, 1]] },
  mountain:{ density: 6,  types: [['rock', 9, 0.8, 4.5]] },
  snow:    { density: 4,  types: [['rock', 5, 0.6, 2.6], ['conifer', 2, 5, 12]] },
  ice:     { density: 2,  types: [['rock', 4, 0.5, 2], ['crystal', 1, 1.2, 3]] },
  tundra:  { density: 7,  types: [['shrub', 5, 0.4, 1.1], ['rock', 3, 0.5, 2]] },
  crystal: { density: 12, types: [['crystal', 8, 1.5, 6], ['rock', 2, 0.6, 2.4]] },
  fungal:  { density: 20, types: [['fungus', 8, 1.5, 7], ['shrub', 2, 0.6, 1.6]] },
  biolum:  { density: 18, types: [['fungus', 5, 1.2, 5], ['broadleaf', 3, 5, 12], ['shrub', 3, 0.6, 1.8]] },
  toxic:   { density: 10, types: [['fungus', 4, 1, 4], ['shrub', 3, 0.5, 1.5], ['rock', 2, 0.5, 2]] },
  basalt:  { density: 5,  types: [['rock', 9, 0.7, 3.2]] },
  ash:     { density: 4,  types: [['rock', 8, 0.6, 2.4]] },
  regolith:{ density: 4,  types: [['rock', 9, 0.5, 2.8]] },
  irradiated:{ density: 6, types: [['rock', 6, 0.6, 2.6], ['crystal', 2, 1, 3]] },
  metal:   { density: 3,  types: [['rock', 6, 0.6, 2.2], ['crystal', 2, 1, 2.5]] },
};

/* ------------------------------------------------------------------ */
/* Scatter field                                                       */
/* ------------------------------------------------------------------ */

/**
 * Instanced ground cover around a point on the surface.
 *
 * Rebuilt whenever the near terrain ring is rebuilt, which is rare enough
 * (every ~260 m of travel) that the cost is invisible.
 */
export class SceneryField {
  constructor(scene, surface, planet, opts = {}) {
    this.scene = scene;
    this.surface = surface;
    this.planet = planet;
    // Coverage and budget are tuned against a mobile triangle budget (§105):
    // vegetation is by far the largest triangle consumer in a surface scene.
    this.radius = opts.radius || 700;       // metres of coverage around the player
    this.cell = opts.cell || 13;            // metres between scatter candidates
    this.maxPerType = opts.maxPerType || 550;
    this.center = null;
    this.meshes = {};
    /** [{pos:{x,y,z}, radius}] world-space areas kept clear of props. */
    this.exclusions = [];

    const foliage = foliageTexture((planet.seed >>> 0) % 9973);
    const rockTex = surfaceTexture(`prop${(planet.seed >>> 0) % 9973}`, {
      seed: planet.seed, grain: 0.5, contrast: 0.6,
    });

    // One material per prop kind; instance colour supplies the variation.
    this.materials = {
      conifer: new THREE.MeshStandardMaterial({ map: foliage, roughness: 0.9, vertexColors: false }),
      broadleaf: new THREE.MeshStandardMaterial({ map: foliage, roughness: 0.9 }),
      palm: new THREE.MeshStandardMaterial({ map: foliage, roughness: 0.9 }),
      shrub: new THREE.MeshStandardMaterial({ map: foliage, roughness: 0.95 }),
      rock: new THREE.MeshStandardMaterial({ map: rockTex, roughness: 0.98, metalness: 0.02 }),
      crystal: new THREE.MeshStandardMaterial({
        roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.85,
        emissive: new THREE.Color(0.1, 0.25, 0.4), emissiveIntensity: 0.5,
      }),
      fungus: new THREE.MeshStandardMaterial({ map: foliage, roughness: 0.85 }),
    };

    // Bioluminescent worlds glow at night (§10).
    if (planet.class === 'bioluminescent') {
      for (const k of ['fungus', 'shrub', 'broadleaf']) {
        this.materials[k].emissive = new THREE.Color(0.05, 0.5, 0.6);
        this.materials[k].emissiveIntensity = 0.9;
      }
    }
  }

  /** Keep these world-space areas free of scenery (landing pads, ships). */
  setExclusions(list) {
    this.exclusions = list || [];
  }

  /** True when the player has moved far enough to justify a rebuild. */
  needsRebuild(dir) {
    if (!this.center) return true;
    const dot = Math.max(-1, Math.min(1, dir.x * this.center.x + dir.y * this.center.y + dir.z * this.center.z));
    return Math.acos(dot) * this.surface.radius > this.radius * 0.32;
  }

  /**
   * Rebuild the scatter around `dir`.
   * @returns {{x,y,z}} the world-space centre the instances are relative to
   */
  rebuild(dir) {
    const { up, east, north } = tangentBasis(dir);
    const surface = this.surface;
    const R = surface.radius;

    const centerR = surface.radiusAt(up.x, up.y, up.z);
    const worldCenter = { x: up.x * centerR, y: up.y * centerR, z: up.z * centerR };

    // Collect instance transforms per prop kind.
    const buckets = {};
    const geoms = propGeometries();
    for (const k of Object.keys(geoms)) buckets[k] = [];

    const steps = Math.floor((this.radius * 2) / this.cell);
    const half = this.radius;
    // Seeded by the patch centre so the same ground always grows the same trees.
    const baseSeed = hashInts(surface.seed, Math.round(dir.x * 8192), Math.round(dir.y * 8192), Math.round(dir.z * 8192));

    for (let j = 0; j < steps; j++) {
      for (let i = 0; i < steps; i++) {
        const rng = new RNG(hashInts(baseSeed, i, j));
        // Jittered grid: avoids the visual banding of a regular lattice.
        const u = -half + (i + rng.next()) * this.cell;
        const v = -half + (j + rng.next()) * this.cell;
        if (u * u + v * v > half * half) continue;

        const px = up.x * R + east.x * u + north.x * v;
        const py = up.y * R + east.y * u + north.y * v;
        const pz = up.z * R + east.z * u + north.z * v;
        const pl = Math.hypot(px, py, pz) || 1;
        const dx = px / pl, dy = py / pl, dz = pz / pl;

        const elevation = surface.elevation(dx, dy, dz);
        if (surface.hasOcean && elevation < surface.seaLevel) continue;   // no trees at sea

        // Landing clearings: nothing grows where the player set down.
        if (this.exclusions.length) {
          const groundR0 = surface.radiusAt(dx, dy, dz);
          const wx = dx * groundR0, wy = dy * groundR0, wz = dz * groundR0;
          let blocked = false;
          for (const ex of this.exclusions) {
            const d2 = (wx - ex.pos.x) ** 2 + (wy - ex.pos.y) ** 2 + (wz - ex.pos.z) ** 2;
            if (d2 < ex.radius * ex.radius) { blocked = true; break; }
          }
          if (blocked) continue;
        }

        const biome = surface.biomeAt(dx, dy, dz);
        const rule = BIOME_PROPS[biome];
        if (!rule) continue;

        // rule.density is per 100x100m; convert to a probability for this cell.
        const cellArea = this.cell * this.cell;
        const chance = (rule.density / 10000) * cellArea;
        if (rng.next() > chance) continue;

        // Steep ground grows nothing but rock.
        const slope = surface.slopeAt(dx, dy, dz);
        let choices = rule.types;
        if (slope > 0.5) choices = choices.filter((t) => t[0] === 'rock' || t[0] === 'crystal');
        if (!choices.length) continue;

        const pick = rng.weighted(choices.map((t) => [t, t[1]]));
        const [kind, , minScale, maxScale] = pick;
        if (buckets[kind].length >= this.maxPerType) continue;

        const scale = rng.range(minScale, maxScale);
        const groundR = surface.radiusAt(dx, dy, dz);

        buckets[kind].push({
          // position relative to the field centre
          x: dx * groundR - worldCenter.x,
          y: dy * groundR - worldCenter.y,
          z: dz * groundR - worldCenter.z,
          up: { x: dx, y: dy, z: dz },
          scale,
          yaw: rng.range(0, Math.PI * 2),
          tint: rng.range(0.72, 1.18),
          biome,
        });
      }
    }

    this._commit(buckets);
    this.center = { x: dir.x, y: dir.y, z: dir.z };
    this.worldCenter = worldCenter;
    return worldCenter;
  }

  /** Turn collected transforms into InstancedMeshes. */
  _commit(buckets) {
    const geoms = propGeometries();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const upVec = new THREE.Vector3(0, 1, 0);
    const target = new THREE.Vector3();
    const scaleVec = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const color = new THREE.Color();

    for (const [kind, list] of Object.entries(buckets)) {
      const existing = this.meshes[kind];
      if (existing) {
        this.scene.remove(existing);
        existing.dispose();
        delete this.meshes[kind];
      }
      if (!list.length) continue;

      const mesh = new THREE.InstancedMesh(geoms[kind], this.materials[kind], list.length);
      mesh.frustumCulled = false;       // instances span the whole patch
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        // Stand the prop up along the local surface normal, then spin it.
        target.set(it.up.x, it.up.y, it.up.z);
        q.setFromUnitVectors(upVec, target);
        const spin = new THREE.Quaternion().setFromAxisAngle(target, it.yaw);
        q.premultiply(spin);
        pos.set(it.x, it.y, it.z);
        scaleVec.set(it.scale, it.scale, it.scale);
        m.compose(pos, q, scaleVec);
        mesh.setMatrixAt(i, m);

        // Biome colours are ground tints and are deliberately dark; used raw
        // they made every tree a black silhouette once the greyscale foliage
        // map multiplied them again. Lift them into a foliage range instead.
        const base = (BIOMES[it.biome] || BIOMES.rock).color;
        const lift = kind === 'rock' ? 2.0 : 2.35;
        color.setRGB(
          Math.min(1, base[0] * it.tint * lift + 0.10),
          Math.min(1, base[1] * it.tint * lift + 0.14),
          Math.min(1, base[2] * it.tint * lift + 0.08),
        );
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
      this.meshes[kind] = mesh;
    }
  }

  /** Position for this frame's floating origin. */
  place(origin) {
    if (!this.worldCenter) return;
    for (const mesh of Object.values(this.meshes)) {
      mesh.position.set(
        this.worldCenter.x - origin.x,
        this.worldCenter.y - origin.y,
        this.worldCenter.z - origin.z,
      );
    }
  }

  setVisible(v) {
    for (const mesh of Object.values(this.meshes)) mesh.visible = v;
  }

  dispose() {
    for (const mesh of Object.values(this.meshes)) {
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.meshes = {};
    this.center = null;
  }
}

/* ------------------------------------------------------------------ */
/* Cities                                                              */
/* ------------------------------------------------------------------ */

/**
 * Build a city as instanced towers plus a landing pad (§21).
 *
 * The city layout already exists in `gen/city.js` — typed buildings with real
 * footprints, heights and rotations. This just turns it into geometry, with
 * lit windows via an emissive facade texture so a city reads as inhabited
 * from the air at night.
 */
export function buildCityMesh(city, surface) {
  const group = new THREE.Group();
  const { up, east, north } = tangentBasis(city.dir);
  const R = surface.radius;
  const centerR = surface.radiusAt(city.dir.x, city.dir.y, city.dir.z);
  const worldCenter = { x: city.dir.x * centerR, y: city.dir.y * centerR, z: city.dir.z * centerR };

  const accent = `rgb(${Math.round(city.accent[0] * 255)},${Math.round(city.accent[1] * 255)},${Math.round(city.accent[2] * 255)})`;
  const facade = facadeTexture(city.seed >>> 0, accent);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(city.color[0], city.color[1], city.color[2]),
    roughness: 0.72,
    metalness: 0.15,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    map: facade,
    emissiveMap: facade,
    emissive: new THREE.Color(1, 1, 1),
    emissiveIntensity: 1.4,
    roughness: 0.4,
    metalness: 0.1,
  });

  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);            // base at y=0

  const bodies = new THREE.InstancedMesh(box, bodyMat, city.buildings.length);
  const windows = new THREE.InstancedMesh(box, windowMat, city.buildings.length);
  bodies.frustumCulled = false;
  windows.frustumCulled = false;

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const upVec = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let i = 0; i < city.buildings.length; i++) {
    const b = city.buildings[i];
    // Project the building's local (x,z) onto the sphere.
    const px = up.x * R + east.x * b.x + north.x * b.z;
    const py = up.y * R + east.y * b.x + north.y * b.z;
    const pz = up.z * R + east.z * b.x + north.z * b.z;
    const pl = Math.hypot(px, py, pz) || 1;
    const dx = px / pl, dy = py / pl, dz = pz / pl;
    const groundR = surface.radiusAt(dx, dy, dz);

    const nrm = new THREE.Vector3(dx, dy, dz);
    q.setFromUnitVectors(upVec, nrm);
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(nrm, b.rotation || 0));

    pos.set(dx * groundR - worldCenter.x, dy * groundR - worldCenter.y, dz * groundR - worldCenter.z);
    scl.set(b.width, b.height, b.depth);
    m.compose(pos, q, scl);
    bodies.setMatrixAt(i, m);

    // Window shell sits fractionally proud of the body so it never z-fights.
    scl.set(b.width * 1.006, b.height * 0.985, b.depth * 1.006);
    m.compose(pos, q, scl);
    windows.setMatrixAt(i, m);
  }
  bodies.instanceMatrix.needsUpdate = true;
  windows.instanceMatrix.needsUpdate = true;
  group.add(bodies, windows);

  // Landing pads at the spaceport.
  if (city.pads && city.pads.length) {
    const padGeo = new THREE.CylinderGeometry(1, 1, 0.6, 16);
    padGeo.translate(0, 0.3, 0);
    const padMat = new THREE.MeshStandardMaterial({
      color: 0x2a3138, roughness: 0.6, metalness: 0.2,
      emissive: new THREE.Color(city.accent[0], city.accent[1], city.accent[2]),
      emissiveIntensity: 0.35,
    });
    const pads = new THREE.InstancedMesh(padGeo, padMat, city.pads.length);
    pads.frustumCulled = false;
    for (let i = 0; i < city.pads.length; i++) {
      const p = city.pads[i];
      const px = up.x * R + east.x * p.x + north.x * p.z;
      const py = up.y * R + east.y * p.x + north.y * p.z;
      const pz = up.z * R + east.z * p.x + north.z * p.z;
      const pl = Math.hypot(px, py, pz) || 1;
      const dx = px / pl, dy = py / pl, dz = pz / pl;
      const groundR = surface.radiusAt(dx, dy, dz);
      const nrm = new THREE.Vector3(dx, dy, dz);
      q.setFromUnitVectors(upVec, nrm);
      pos.set(dx * groundR - worldCenter.x, dy * groundR - worldCenter.y, dz * groundR - worldCenter.z);
      scl.set(p.radius, 1, p.radius);
      m.compose(pos, q, scl);
      pads.setMatrixAt(i, m);
    }
    pads.instanceMatrix.needsUpdate = true;
    group.add(pads);
  }

  group.userData.worldCenter = worldCenter;
  return group;
}

/* ------------------------------------------------------------------ */
/* Creatures                                                           */
/* ------------------------------------------------------------------ */

/**
 * Visible wildlife (§17, §71, §72).
 *
 * Bodies are assembled from the species' own generated parameters — leg count,
 * body mass, head size, neck length — so a 20-tonne six-legged apex predator
 * really does tower over a 1 kg grazer standing next to it.
 */
export function buildCreatureMesh(species) {
  const group = new THREE.Group();
  const [h, s, l] = species.color;
  const color = new THREE.Color().setHSL(h, s, l);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: species.skin === 'crystalline' ? 0.2 : 0.85,
    metalness: species.skin === 'plated' || species.skin === 'crystalline' ? 0.4 : 0.05,
    emissive: species.glows && species.glowColor
      ? new THREE.Color().setHSL(species.glowColor[0], species.glowColor[1], species.glowColor[2] * 0.5)
      : new THREE.Color(0, 0, 0),
    emissiveIntensity: species.glows ? 0.8 : 0,
  });

  const H = species.height;
  const bodyLen = H * 1.25;
  const bodyRad = H * 0.32;

  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), mat);
  body.scale.set(bodyRad, bodyRad * 0.88, bodyLen * 0.5);
  body.position.y = H * 0.62;
  group.add(body);

  // Head on a short neck.
  const headSize = H * species.headSize;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
  head.scale.setScalar(headSize);
  head.position.set(0, H * 0.78, bodyLen * 0.5 + headSize * 0.6);
  group.add(head);

  // Eyes — a dark sphere each, which is what makes a creature read as alive.
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0f, roughness: 0.15, metalness: 0.1,
    emissive: species.glows ? new THREE.Color(0.6, 0.9, 1) : new THREE.Color(0, 0, 0),
    emissiveIntensity: species.glows ? 1.2 : 0,
  });
  const eyeCount = Math.min(8, species.eyes || 2);
  for (let i = 0; i < eyeCount; i++) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(headSize * 0.2, 6, 5), eyeMat);
    const side = i % 2 === 0 ? 1 : -1;
    const row = Math.floor(i / 2);
    eye.position.set(
      side * headSize * 0.55,
      head.position.y + headSize * (0.25 - row * 0.3),
      head.position.z + headSize * 0.65,
    );
    group.add(eye);
  }

  // Legs.
  const legs = Math.min(8, species.legs || 0);
  if (legs > 0) {
    const legLen = H * 0.55;
    const legGeo = new THREE.CylinderGeometry(H * 0.05, H * 0.035, legLen, 5);
    legGeo.translate(0, -legLen / 2, 0);
    for (let i = 0; i < legs; i++) {
      const leg = new THREE.Mesh(legGeo, mat);
      const pair = Math.floor(i / 2);
      const side = i % 2 === 0 ? 1 : -1;
      const along = legs <= 2 ? 0 : (pair / (legs / 2 - 1 || 1) - 0.5) * bodyLen * 0.72;
      leg.position.set(side * bodyRad * 0.78, H * 0.55, along);
      group.add(leg);
    }
  }

  // Tail.
  if (species.tail) {
    const tailLen = H * 0.8;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(H * 0.1, tailLen, 6), mat);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, H * 0.68, -bodyLen * 0.5 - tailLen * 0.4);
    group.add(tail);
  }

  // Horns.
  for (let i = 0; i < Math.min(4, species.horns || 0); i++) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(headSize * 0.14, headSize * 0.9, 5), mat);
    const side = i % 2 === 0 ? 1 : -1;
    horn.position.set(side * headSize * 0.45, head.position.y + headSize * 0.8, head.position.z - headSize * 0.2);
    horn.rotation.z = side * -0.3;
    group.add(horn);
  }

  // Wings.
  if (species.wings > 0) {
    const wingGeo = new THREE.ConeGeometry(H * 0.12, H * 1.3, 4);
    for (let i = 0; i < Math.min(4, species.wings); i++) {
      const wing = new THREE.Mesh(wingGeo, mat);
      const side = i % 2 === 0 ? 1 : -1;
      wing.rotation.z = side * Math.PI * 0.42;
      wing.position.set(side * bodyRad * 1.1, H * 0.8, -Math.floor(i / 2) * bodyLen * 0.3);
      group.add(wing);
    }
  }

  group.userData.species = species;
  return group;
}

/**
 * A small population of wandering animals around the player. Creatures are
 * pooled and repositioned rather than created and destroyed.
 */
export class CreatureField {
  constructor(scene, surface, species, opts = {}) {
    this.scene = scene;
    this.surface = surface;
    this.species = species;
    this.max = opts.max || 14;
    this.radius = opts.radius || 420;
    this.agents = [];
    this.center = null;
  }

  /** Populate around a surface direction. */
  rebuild(dir) {
    for (const a of this.agents) this.scene.remove(a.mesh);
    this.agents = [];
    if (!this.species.length) return;

    const { up, east, north } = tangentBasis(dir);
    const R = this.surface.radius;
    const rng = new RNG(hashInts(this.surface.seed, Math.round(dir.x * 4096), Math.round(dir.z * 4096)));

    // Ground-dwelling species only; fliers and swimmers need their own handling.
    const walkers = this.species.filter((s) => s.habitat === 'ground' || s.habitat === 'air');
    if (!walkers.length) return;

    const count = Math.min(this.max, 4 + Math.floor(rng.next() * this.max));
    for (let i = 0; i < count; i++) {
      const sp = rng.pick(walkers);
      const u = rng.range(-this.radius, this.radius);
      const v = rng.range(-this.radius, this.radius);
      const px = up.x * R + east.x * u + north.x * v;
      const py = up.y * R + east.y * u + north.y * v;
      const pz = up.z * R + east.z * u + north.z * v;
      const pl = Math.hypot(px, py, pz) || 1;
      const d = { x: px / pl, y: py / pl, z: pz / pl };
      if (this.surface.hasOcean && this.surface.elevation(d.x, d.y, d.z) < this.surface.seaLevel) continue;

      const mesh = buildCreatureMesh(sp);
      this.scene.add(mesh);
      this.agents.push({
        mesh, species: sp, dir: d,
        heading: rng.range(0, Math.PI * 2),
        speed: sp.speed * rng.range(0.25, 0.6),
        phase: rng.range(0, Math.PI * 2),
        // Fliers cruise above the ground.
        hover: sp.habitat === 'air' ? rng.range(8, 45) : 0,
      });
    }
    this.center = dir;
  }

  needsRebuild(dir) {
    if (!this.center) return true;
    const dot = Math.max(-1, Math.min(1, dir.x * this.center.x + dir.y * this.center.y + dir.z * this.center.z));
    return Math.acos(dot) * this.surface.radius > this.radius * 0.6;
  }

  /** Walk the animals and place them for this frame's floating origin. */
  update(dt, origin, timeS) {
    const upVec = new THREE.Vector3(0, 1, 0);
    const nrm = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (const a of this.agents) {
      // Wander: drift the heading and step along the tangent plane.
      a.heading += Math.sin(timeS * 0.21 + a.phase) * dt * 0.35;
      const { up, east, north } = tangentBasis(a.dir);
      const step = a.speed * dt;
      const ex = Math.cos(a.heading) * step, nz = Math.sin(a.heading) * step;
      const R = this.surface.radius;
      const px = up.x * R + east.x * ex + north.x * nz;
      const py = up.y * R + east.y * ex + north.y * nz;
      const pz = up.z * R + east.z * ex + north.z * nz;
      const pl = Math.hypot(px, py, pz) || 1;
      a.dir = { x: px / pl, y: py / pl, z: pz / pl };

      const groundR = this.surface.radiusAt(a.dir.x, a.dir.y, a.dir.z) + a.hover;
      const wx = a.dir.x * groundR, wy = a.dir.y * groundR, wz = a.dir.z * groundR;
      a.mesh.position.set(wx - origin.x, wy - origin.y, wz - origin.z);

      nrm.set(a.dir.x, a.dir.y, a.dir.z);
      q.setFromUnitVectors(upVec, nrm);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(nrm, -a.heading));
      a.mesh.quaternion.copy(q);

      // A little bob so they don't look like statues sliding around.
      const bob = Math.sin(timeS * (2 + a.species.speed * 0.4) + a.phase) * a.species.height * 0.035;
      a.mesh.position.addScaledVector(nrm, bob);
    }
  }

  setVisible(v) {
    for (const a of this.agents) a.mesh.visible = v;
  }

  dispose() {
    for (const a of this.agents) this.scene.remove(a.mesh);
    this.agents = [];
    this.center = null;
  }
}
