// Library of hand-made CC0 models (Quaternius packs, see assets/models).
// Models are preloaded once at boot; every consumer falls back to the
// procedural geometry in models.js when a file is missing or failed to load,
// so the game still runs offline or with a partial asset set.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { log } from '../core/log.js';

// Flora model sets per planet style and plant form.
export const FLORA_MODELS = {
  terran: {
    conifer: ['PineTree_1', 'PineTree_2', 'PineTree_3', 'PineTree_4', 'PineTree_Autumn_1'],
    broadleaf: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'BirchTree_1', 'BirchTree_2', 'BirchTree_3', 'Willow_1', 'Willow_2', 'CommonTree_Autumn_1', 'CommonTree_Autumn_2'],
    palm: ['PalmTree_1', 'PalmTree_2', 'PalmTree_3'],
    bush: ['Bush_1', 'Bush_2', 'BushBerries_1', 'BushBerries_2'],
    reed: ['Grass', 'Grass_2', 'Wheat', 'Grass_Short'],
    frond: ['Plant_1', 'Plant_2', 'Plant_3', 'Plant_4', 'Flowers'],
    coral: ['Plant_3', 'Plant_4', 'Lilypad'],
    rock: ['Rock_1', 'Rock_2', 'Rock_3', 'Rock_4', 'Rock_Moss_1', 'Rock_Moss_2'],
  },
  ice: {
    conifer: ['PineTree_Snow_1', 'PineTree_Snow_2', 'BirchTree_Snow_1'],
    broadleaf: ['CommonTree_Snow_1', 'BirchTree_Snow_1'],
    bush: ['Bush_Snow_1'],
    spire: ['BirchTree_Dead_1', 'Willow_Dead_1'],
    rock: ['Rock_Snow_1', 'Rock_Snow_2'],
  },
  desert: {
    cactus: ['Cactus_1', 'Cactus_2', 'Cactus_3', 'CactusFlowers_2', 'CactusFlowers_3'],
    bush: ['Bush_2'],
    spire: ['CommonTree_Dead_1', 'Willow_Dead_1'],
  },
  alien: {
    broadleaf: ['usk_Tree_Swirl', 'usk_Tree_Blob', 'usk_Tree_Light', 'usk_Tree_Swirl-iLxXSXIx2t', 'usk_Tree_Blob-QHYRrAnKzW'],
    spire: ['usk_Tree_Spikes', 'usk_Tree_Spiral', 'usk_Tree_Spiral-gI3kqnqg80', 'usk_Tree_Spikes-a6Vo1seJw9'],
    mushroom: ['usk_Tree_Blob-j0byyoIGOv', 'usk_Tree_Floating', 'usk_Tree_Light-om4BJAL82T'],
    bush: ['usk_Bush', 'usk_Bush-RfUP3gXj69', 'usk_Bush-tX1aT9IB1P'],
    frond: ['usk_Plant', 'usk_Plant-VwXvoIpCHP', 'usk_Plant-s0joFFrQoy'],
    bulb: ['usk_Plant-s0joFFrQoy', 'usk_Plant'],
    reed: ['usk_Grass', 'usk_Grass-Db4UVcNWnF', 'usk_Grass-iw6l7gqcdQ'],
    coral: ['usk_Plant-VwXvoIpCHP', 'usk_Tree_Spiral-kBomlgZ5xu'],
    rock: ['usk_Rock', 'usk_Rock-34W5ymEePk', 'usk_Rock-R2UjZAX3By', 'usk_Rock-b7gRkv0cEa', 'usk_Rock_Large', 'usk_Rock_Large-d2VWOdthtR', 'usk_Rock_Large-li0YBlBEMz'],
  },
  lava: {
    spire: ['usk_Tree_Lava', 'usk_Tree_Lava-9gRfmVKx9W', 'usk_Tree_Lava-sTYjmQObr1'],
    bush: ['usk_Tree_Lava-sTYjmQObr1', 'usk_Bush-tX1aT9IB1P'],
  },
  dead: {
    spire: ['CommonTree_Dead_1', 'BirchTree_Dead_1', 'Willow_Dead_1'],
    bush: ['TreeStump', 'WoodLog'],
    bulb: ['usk_Plant-s0joFFrQoy'],
  },
};

// Planet type -> flora style (first match wins, then 'alien').
const FLORA_STYLE = { terran: ['terran'], ocean: ['terran'], ice: ['ice', 'terran'], desert: ['desert', 'dead'], lava: ['lava', 'alien'], radioactive: ['dead', 'alien'], barren: ['dead'] };

export function floraModelFor(planetType, form, rng) {
  const styles = FLORA_STYLE[planetType] || ['alien'];
  for (const s of [...styles, 'alien']) {
    const list = FLORA_MODELS[s]?.[form]?.filter(hasModel);
    if (list?.length) return rng.pick(list);
  }
  return null;
}

// Creature models. yaw turns the model so it faces -Z (the game's forward).
export const CREATURE_MODELS = {
  Cow: { yaw: Math.PI }, Horse: { yaw: Math.PI }, Llama: { yaw: Math.PI }, Pig: { yaw: Math.PI }, Sheep: { yaw: Math.PI },
  Zebra: { yaw: Math.PI }, Pug: { yaw: Math.PI }, Wolf: { yaw: Math.PI / 2 }, Dog: { yaw: Math.PI / 2 }, Cat: { yaw: Math.PI / 2 },
  Eagle: { yaw: 0, flying: true },
  Alien: {}, Alien_Tall: {}, Bat: { flying: true }, Bee: { flying: true }, Cactus: {}, Chicken: {}, Crab: {}, Cthulhu: {},
  Cyclops: {}, Deer: {}, Demon: {}, Ghost: { flying: true }, GreenDemon: {}, Mushroom: {}, Panda: {}, Penguin: {}, Skull: {},
  Tree: {}, YellowDragon: { flying: true }, Yeti: {},
  usk_Enemy_Large: {}, usk_Enemy_Small: {}, usk_Enemy_Flying: { flying: true },
};

const FAUNA_SETS = {
  terran: { herbivore: ['Cow', 'Horse', 'Sheep', 'Llama', 'Zebra', 'Pig'], omnivore: ['Pug', 'Pig', 'Chicken', 'Cat'], predator: ['Wolf', 'Dog', 'Cat'], apex: ['Wolf', 'YellowDragon'], flying: ['Eagle', 'Bee'] },
  ice: { herbivore: ['Penguin', 'Sheep', 'Llama'], omnivore: ['Penguin', 'Panda'], predator: ['Wolf', 'Yeti'], apex: ['Yeti'], flying: ['Eagle', 'Ghost'] },
  desert: { herbivore: ['Cactus', 'Llama', 'Crab'], omnivore: ['Crab', 'Chicken'], predator: ['Demon', 'Skull'], apex: ['usk_Enemy_Large', 'YellowDragon'], flying: ['Bat', 'Bee'] },
  alien: { herbivore: ['Alien', 'Mushroom', 'Alien_Tall', 'Panda', 'Deer', 'Chicken'], omnivore: ['Cyclops', 'Crab', 'usk_Enemy_Small', 'Penguin'], predator: ['Demon', 'GreenDemon', 'Skull', 'usk_Enemy_Small'], apex: ['Cthulhu', 'Tree', 'usk_Enemy_Large'], flying: ['Bat', 'Bee', 'Ghost', 'usk_Enemy_Flying', 'YellowDragon'] },
};
const FAUNA_STYLE = { terran: 'terran', ocean: 'terran', ice: 'ice', desert: 'desert' };

export function creatureModelFor(planetType, sp, rng) {
  const set = FAUNA_SETS[FAUNA_STYLE[planetType] || 'alien'];
  const list = (sp.flying ? set.flying : set[sp.diet] || set.herbivore).filter(hasModel);
  return list.length ? rng.pick(list) : null;
}

export const CHARACTER_MODELS = ['usk_Astronaut', 'usk_Astronaut-0D54W8yfrA', 'usk_Astronaut-OgeSH89Nmx'];
export const SHIP_MODEL = 'usk_Spaceship';
export const SEA_MODELS = ['Fish1', 'Fish2', 'Fish3', 'Manta_ray', 'Dolphin', 'Shark', 'Whale'];

export function allModelNames() {
  const names = new Set([SHIP_MODEL, ...CHARACTER_MODELS, ...SEA_MODELS, ...Object.keys(CREATURE_MODELS), 'usk_Mech', 'usk_Mech-D5wW2jDO42']);
  for (const style of Object.values(FLORA_MODELS)) for (const list of Object.values(style)) list.forEach((n) => names.add(n));
  return [...names];
}

// ---------------------------------------------------------------------------
const cache = new Map(); // name -> { scene, animations, info }
let loader = null;

// Hosts that cannot serve .glb get the same files as base64 text (.glb.txt).
let format = null; // 'glb' | 'txt'

async function fetchModel(name, base) {
  const tryGlb = async () => {
    const r = await fetch(`${base}${name}.glb`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  };
  const tryTxt = async () => {
    const r = await fetch(`${base}${name}.glb.txt`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const bin = atob((await r.text()).trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  };
  if (format === 'glb') return tryGlb();
  if (format === 'txt') return tryTxt();
  try { const b = await tryGlb(); format = 'glb'; return b; } catch { const b = await tryTxt(); format = 'txt'; return b; }
}

export async function preloadModels(names = allModelNames(), onProgress = () => {}, base = 'assets/models/') {
  loader = loader || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let done = 0;
  const loadOne = async (name) => {
    if (cache.has(name)) { onProgress(++done / names.length); return; }
    try {
      const g = await loader.parseAsync(await fetchModel(name, base), '');
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene, true);
      cache.set(name, { scene: g.scene, animations: g.animations || [], box, parts: null });
    } catch (e) {
      log.warn('model', `could not load ${name}: ${e.message}`);
    }
    onProgress(++done / names.length);
  };
  // The first file decides which format this host serves.
  if (names.length) await loadOne(names[0]);
  await Promise.all(names.slice(1).map(loadOne));
}

export function hasModel(name) { return cache.has(name); }
export function modelBox(name) { return cache.get(name)?.box; }

// Plain float copy of the attributes we need (glTF data is quantized).
function toFloat(geo, keep) {
  const out = new THREE.BufferGeometry();
  for (const name of keep) {
    const a = geo.getAttribute(name);
    if (!a) continue;
    const n = a.count, size = a.itemSize, arr = new Float32Array(n * size);
    const get = [a.getX, a.getY, a.getZ, a.getW];
    for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) arr[i * size + k] = get[k].call(a, i);
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (geo.index) out.setIndex(Array.from(geo.index.array));
  return out;
}

// Static meshes baked into one geometry per material, normalized so the model
// stands on y = 0, is centred in XZ and is 1 unit tall. For instancing.
export function staticParts(name) {
  const rec = cache.get(name);
  if (!rec) return null;
  if (rec.parts) return rec.parts;
  const { box } = rec;
  const h = Math.max(1e-3, box.max.y - box.min.y);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const norm = new THREE.Matrix4().makeScale(1 / h, 1 / h, 1 / h).multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz));
  const byMat = new Map();
  rec.scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const base = toFloat(o.geometry, ['position', 'normal', 'uv', 'color']);
    base.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
    const groups = o.geometry.groups.length && mats.length > 1 ? o.geometry.groups : [{ start: 0, count: base.index ? base.index.count : base.attributes.position.count, materialIndex: 0 }];
    for (const g of groups) {
      const m = mats[g.materialIndex] || mats[0];
      let geo = base;
      if (groups.length > 1) {
        geo = base.clone();
        geo.setIndex(Array.from(base.index.array.slice(g.start, g.start + g.count)));
      }
      if (!byMat.has(m)) byMat.set(m, []);
      byMat.get(m).push(geo);
    }
  });
  rec.parts = [];
  for (const [material, geos] of byMat) {
    // Attribute sets must match to merge.
    const keys = geos.map((g) => Object.keys(g.attributes).sort().join());
    const sameKeys = keys.every((k) => k === keys[0]);
    const geometry = geos.length === 1 ? geos[0] : sameKeys ? mergeGeometries(geos) : geos[0];
    geometry.computeBoundingSphere();
    rec.parts.push({ geometry, material });
  }
  rec.height = h;
  return rec.parts;
}

// A skinned, animated instance. Returns { root, mixer, play(state), update(dt) }.
// `size` is the target height in metres (or length along the body for
// long animals when byLength is set).
export function animatedInstance(name, size, { byLength = false, yaw = CREATURE_MODELS[name]?.yaw ?? Math.PI, prefer = {} } = {}) {
  const rec = cache.get(name);
  if (!rec) return null;
  const inner = cloneSkinned(rec.scene);
  inner.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
  });
  meshRelativeSkinning(inner);
  const box = rec.box;
  const dims = box.getSize(new THREE.Vector3());
  const ref = byLength ? Math.max(dims.x, dims.y, dims.z) : dims.y;
  const s = size / Math.max(1e-3, ref);
  const pivot = new THREE.Group();
  inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  pivot.add(inner);
  pivot.scale.setScalar(s);
  pivot.rotation.y = yaw;
  const root = new THREE.Group();
  root.add(pivot);
  root.userData.model = name;
  const mixer = new THREE.AnimationMixer(inner);
  const find = (...res) => {
    for (const re of res) {
      const clip = rec.animations.find((a) => re.test(a.name.split('|').pop()));
      if (clip) return clip;
    }
    return null;
  };
  const clips = {
    fall: find(/^jump_idle$/i, /^jump$/i),
    swim: find(/^run$/i, /swim/i, /walk/i),
    idle: find(/^idle$/i, /idle/i, /^flying$/i, /fly/i, /swim/i),
    walk: find(/^walk$/i, /walk/i, /^flying$/i, /fly/i, /swim/i, /run/i),
    run: find(/^run$/i, /run/i, /gallop/i, /fast_flying/i, /fly/i, /walk/i),
    attack: find(/bite_front/i, /attack/i, /punch/i, /bite/i, /shoot/i),
    death: find(/^death$/i, /death/i),
    jump: find(/^jump$/i, /jump/i),
    wave: find(/wave/i, /yes/i),
    sit: find(/sitting/i, /sit/i),
  };
  for (const [k, re] of Object.entries(prefer)) clips[k] = find(re) || clips[k];
  const actions = {};
  for (const [k, clip] of Object.entries(clips)) if (clip) actions[k] = mixer.clipAction(clip);
  let current = null;
  const inst = {
    root, mixer, actions, height: size, name,
    play(state, fade = 0.25, timeScale = 1) {
      const a = actions[state] || actions.idle || actions.walk;
      if (!a) return;
      a.timeScale = timeScale;
      if (a === current) return;
      if (state === 'death' || state === 'jump' || state === 'wave') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.reset().play();
      if (current) current.crossFadeTo(a, fade, false);
      current = a;
    },
    update(dt) { mixer.update(dt); },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(inner); },
  };
  // Start each instance at a random point of its idle cycle.
  inst.play('idle', 0);
  if (current) current.time = Math.random() * current.getClip().duration;
  return inst;
}

// three.js skins in world space: bone matrices hold world translations, and
// with planets millions of metres from the origin float32 on the GPU shreds
// the mesh. Compute bone matrices relative to the skinned mesh instead (in
// double precision on the CPU) and bind the mesh in 'detached' mode.
const relInv = new THREE.Matrix4();
const relM = new THREE.Matrix4();
const relativeSkeletons = new WeakSet();
function meshRelativeSkinning(root) {
  root.traverse((mesh) => {
    if (!mesh.isSkinnedMesh) return;
    const sk = mesh.skeleton;
    if (!relativeSkeletons.has(sk)) {
      relativeSkeletons.add(sk);
      const B = mesh.bindMatrix.clone();
      sk.boneInverses = sk.boneInverses.map((bi) => bi.clone().multiply(B));
      sk.update = function update() {
        relInv.copy(mesh.matrixWorld).invert();
        for (let i = 0; i < this.bones.length; i++) {
          relM.multiplyMatrices(relInv, this.bones[i].matrixWorld).multiply(this.boneInverses[i]);
          relM.toArray(this.boneMatrices, i * 16);
        }
        if (this.boneTexture !== null) this.boneTexture.needsUpdate = true;
      };
    }
    mesh.bindMode = 'detached';
    mesh.bindMatrix.identity();
    mesh.bindMatrixInverse.identity();
  });
}

// Static (non-skinned) clone scaled to a target height or length.
export function staticInstance(name, size, { byLength = false, yaw = 0 } = {}) {
  const rec = cache.get(name);
  if (!rec) return null;
  const inner = rec.scene.clone(true);
  inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const dims = rec.box.getSize(new THREE.Vector3());
  const ref = byLength ? Math.max(dims.x, dims.y, dims.z) : dims.y;
  const pivot = new THREE.Group();
  inner.position.set(-(rec.box.min.x + rec.box.max.x) / 2, -rec.box.min.y, -(rec.box.min.z + rec.box.max.z) / 2);
  pivot.add(inner);
  pivot.scale.setScalar(size / Math.max(1e-3, ref));
  pivot.rotation.y = yaw;
  const root = new THREE.Group();
  root.add(pivot);
  return root;
}
