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
    conifer: ['PineTree_1', 'PineTree_2', 'PineTree_3', 'PineTree_4'],
    broadleaf: ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'CommonTree_4', 'CommonTree_5', 'BirchTree_1', 'BirchTree_2', 'BirchTree_3', 'Willow_1', 'Willow_2'],
    palm: ['ph_quiver_tree_01', 'ph_quiver_tree_02'],
    bush: ['ph_fern_02#0', 'ph_fern_02#1', 'ph_fern_02#2', 'ph_fern_02#3', 'ph_shrub_04', 'ph_shrub_03#0', 'ph_shrub_03#1', 'BushBerries_1'],
    reed: ['Grass', 'Grass_2', 'Wheat', 'Grass_Short'],
    frond: ['ph_flower_gazania#0', 'ph_flower_gazania#2', 'ph_flower_gazania#4', 'ph_periwinkle_plant#0', 'ph_periwinkle_plant#2', 'ph_periwinkle_plant#4', 'ph_dandelion_01#0', 'ph_dandelion_01#2', 'ph_celandine_01#0', 'ph_fern_02#1'],
    coral: ['ph_fern_02#2', 'ph_periwinkle_plant#1', 'Lilypad'],
    rock: ['ph_rock_moss_set_01#0', 'ph_rock_moss_set_01#1', 'ph_rock_moss_set_01#2', 'ph_rock_moss_set_01#3', 'ph_rock_moss_set_02#0', 'ph_rock_moss_set_02#1', 'ph_rock_moss_set_02#4', 'ph_rock_moss_set_02#6', 'ph_boulder_01', 'ph_namaqualand_boulder_02'],
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
    bush: ['ph_shrub_04', 'ph_shrub_03#2'],
    spire: ['ph_quiver_tree_01', 'ph_quiver_tree_02', 'CommonTree_Dead_1'],
    palm: ['ph_quiver_tree_01', 'ph_quiver_tree_02'],
    rock: ['ph_namaqualand_boulder_02', 'ph_boulder_01'],
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
    rock: ['ph_boulder_01', 'ph_namaqualand_boulder_02', 'ph_rock_moss_set_02#4'],
  },
};

// Planet type -> flora style (first match wins, then 'alien').
const FLORA_STYLE = { terran: ['terran'], ocean: ['terran'], ice: ['ice', 'terran'], desert: ['desert', 'dead'], lava: ['lava', 'alien'], radioactive: ['dead', 'alien'], barren: ['dead'] };

// Real-world heights (m) of photoscanned plants and rocks; others use the
// species height.
const MODEL_HEIGHT = {
  ph_fern_02: 0.9, ph_shrub_04: 1.3, ph_shrub_03: 0.8, ph_flower_gazania: 0.28, ph_periwinkle_plant: 0.3,
  ph_dandelion_01: 0.3, ph_celandine_01: 0.25, ph_rock_moss_set_01: 0.9, ph_rock_moss_set_02: 1.0,
  ph_boulder_01: 2.4, ph_namaqualand_boulder_02: 1.8,
};
export function modelHeight(name) { return MODEL_HEIGHT[baseName(name)]; }

// Level of detail for heavy photoscans (a simplified copy beyond `dist` m)
// and draw distances for small plants.
const MODEL_LOD = {
  ph_quiver_tree_01: { lod: 'ph_quiver_tree_01_lod', dist: 170 },
  ph_quiver_tree_02: { lod: 'ph_quiver_tree_02_lod', dist: 170 },
  ph_boulder_01: { lod: 'ph_boulder_01_lod', dist: 140 },
  ph_namaqualand_boulder_02: { lod: 'ph_namaqualand_boulder_02_lod', dist: 140 },
};
const MODEL_CULL = {
  ph_flower_gazania: 90, ph_periwinkle_plant: 90, ph_dandelion_01: 90, ph_celandine_01: 80, ph_fern_02: 200,
  ph_shrub_03: 170, ph_shrub_04: 240, ph_rock_moss_set_01: 450, ph_rock_moss_set_02: 450,
};
// Stylised trees, cacti and bushes ship a *_lod copy with ~12% of the triangles.
const AUTO_LOD = /^(PineTree|CommonTree|BirchTree|Willow|usk_Tree_|Cactus_|CactusFlowers|usk_Bush)/;
export function modelLod(name) {
  const b = baseName(name);
  if (MODEL_LOD[b]) return MODEL_LOD[b];
  return AUTO_LOD.test(b) && hasModel(`${b}_lod`) ? { lod: `${b}_lod`, dist: 150 } : null;
}
export function modelCull(name) { return MODEL_CULL[baseName(name)] || 0; }
export function baseName(name) { return name.split('#')[0]; }

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
  for (const style of Object.values(FLORA_MODELS)) for (const list of Object.values(style)) list.forEach((n) => names.add(baseName(n)));
  for (const l of Object.values(MODEL_LOD)) names.add(l.lod);
  for (const n of [...names]) if (AUTO_LOD.test(n)) names.add(`${n}_lod`);
  return [...names];
}

// ---------------------------------------------------------------------------
const cache = new Map(); // name -> { scene, animations, info }
let loader = null;

// Hosts that cannot serve .glb get the same files as base64 text (.glb.txt).
let format = null; // 'glb' | 'txt'

// Bundles: models.json lists chunk files, each a JSON map name -> base64 GLB.
let bundleIndex = null;
const chunkCache = new Map();
async function bundled(name, base) {
  if (!bundleIndex) {
    bundleIndex = fetch(`${base}models.json`).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  }
  const index = await bundleIndex;
  const chunk = index.files[name];
  if (!chunk) throw new Error(`${name} not in bundle`);
  if (!chunkCache.has(chunk)) chunkCache.set(chunk, fetch(`${base}${chunk}`).then((r) => r.json()));
  return (await chunkCache.get(chunk))[name];
}

async function fetchModel(name, base) {
  const tryGlb = async () => {
    const r = await fetch(`${base}${name}.glb`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  };
  const tryTxt = async () => {
    const b64 = await bundled(name, base);
    const bin = atob(b64);
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

export function hasModel(name) { return cache.has(baseName(name)); }
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
// `name#i` takes only the i-th mesh of a set (photoscan packs hold several
// variants side by side).
const partsCache = new Map();
export function staticParts(name) {
  if (partsCache.has(name)) return partsCache.get(name);
  const rec = cache.get(baseName(name));
  if (!rec) return null;
  const part = name.includes('#') ? Number(name.split('#')[1]) : -1;
  const meshes = [];
  rec.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const use = part >= 0 ? meshes.filter((_, i) => i === part) : meshes;
  if (!use.length) return null;
  const box = new THREE.Box3();
  for (const o of use) box.union(new THREE.Box3().setFromObject(o));
  const h = Math.max(1e-3, box.max.y - box.min.y);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const norm = new THREE.Matrix4().makeScale(1 / h, 1 / h, 1 / h).multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz));
  const byMat = new Map();
  for (const o of use) {
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
  }
  const parts = [];
  for (const [material, geos] of byMat) {
    // Attribute sets must match to merge.
    const keys = geos.map((g) => Object.keys(g.attributes).sort().join());
    const sameKeys = keys.every((k) => k === keys[0]);
    const geometry = geos.length === 1 ? geos[0] : sameKeys ? mergeGeometries(geos) : geos[0];
    geometry.computeBoundingSphere();
    parts.push({ geometry, material });
  }
  partsCache.set(name, parts);
  return parts;
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

// Glass helmet bubble on a character's Head bone (radius and lift in metres).
export function addHelmet(inst, { radius = 0.33, lift = 0.2, tint = 0x9fd8ff } = {}) {
  let head = null;
  inst.root.traverse((o) => { if (o.isBone && /^head$/i.test(o.name)) head = o; });
  if (!head) return null;
  inst.root.updateMatrixWorld(true);
  const ws = head.getWorldScale(new THREE.Vector3()).x / inst.root.getWorldScale(new THREE.Vector3()).x;
  const mat = new THREE.MeshPhysicalMaterial({
    color: tint, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.22,
    envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false, side: THREE.FrontSide,
  });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(radius / ws, 32, 20), mat);
  glass.position.y = lift / ws;
  glass.renderOrder = 2;
  glass.castShadow = false;
  head.add(glass);
  return glass;
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
