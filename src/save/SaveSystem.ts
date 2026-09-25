import { AntStore } from '../ants/AntStore';
import { CREATURES } from '../creatures/CreatureTypes';
import { P_COUNT } from '../pheromone/PheromoneField';
import { WorldData } from '../procgen/WorldGenerator';
import { modeByKey } from '../sim/Modes';
import { Simulation } from '../sim/Simulation';
import { Terrain } from '../world/Terrain';

const MAGIC = 0x31594f52; // "ROY1"
const VERSION = 1;
const PHER_SCALE = 20;

type Sections = Map<string, Uint8Array>;
/* eslint-disable @typescript-eslint/no-explicit-any */

function bytes(a: ArrayBufferView): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength).slice();
}

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream === 'undefined') return data;
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (data[0] !== 0x1f || data[1] !== 0x8b) return data;
  const s = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/**
 * Сохранение: JSON-описание (колонии, еда, существа, растения, конструкции,
 * стройки, маршруты, погода, состояния ГСЧ) + бинарные секции (клетки мира,
 * SoA муравьёв, квантованные феромоны, память колоний), всё сжато gzip.
 */
export async function serialize(sim: Simulation): Promise<Uint8Array> {
  const t = sim.terrain;
  const sec: Sections = new Map();
  sec.set('t.mat', bytes(t.mat));
  sec.set('t.hp', bytes(t.hp));
  sec.set('t.moist', bytes(t.moist));
  sec.set('t.water', bytes(t.water));
  sec.set('t.stress', bytes(t.stress));
  sec.set('t.flags', bytes(t.flags));
  sec.set('t.plant', bytes(t.plant));
  sec.set('t.temp', bytes(t.temp));
  sec.set('nav.struct', bytes(sim.nav.struct));
  const a = sim.ants;
  const n = a.n;
  const antFields = antFieldNames(a);
  for (const f of antFields) {
    const arr = (a as any)[f] as Uint8Array | Float32Array | Int32Array;
    const per = f === 'thr' ? 5 : 1;
    sec.set('ant.' + f, bytes(arr.subarray(0, n * per)));
  }
  sim.colonies.forEach((col, ci) => {
    for (let c = 0; c < P_COUNT; c++) {
      const src = col.pher.ch[c];
      const q = new Uint8Array(src.length);
      for (let i = 0; i < src.length; i++) q[i] = Math.min(255, Math.round(src[i] * PHER_SCALE));
      sec.set(`c${ci}.ph${c}`, q);
    }
    const tr = new Uint8Array(col.pher.traffic.length);
    for (let i = 0; i < tr.length; i++) tr[i] = Math.min(255, Math.round(col.pher.traffic[i] / 4));
    sec.set(`c${ci}.traffic`, tr);
    sec.set(`c${ci}.fog`, bytes(col.memory.fog));
    sec.set(`c${ci}.explored`, bytes(col.memory.explored));
    sec.set(`c${ci}.mfood`, bytes(col.memory.food));
    sec.set(`c${ci}.mdanger`, bytes(col.memory.danger));
  });
  const w: any = sim.weather;
  const json = {
    v: VERSION,
    params: sim.world.params,
    mode: sim.mode.key,
    time: sim.time,
    tick: sim.tick,
    zones: sim.zones,
    landmarks: sim.landmarks,
    rngs: sim.rngs.map((r) => r.state),
    ants: { n: a.n, count: a.count, free: (a as any).free },
    weather: { kind: w.kind, rain: w.rain, wind: w.wind, fog: w.fog, cloud: w.cloud, tempOffset: w.tempOffset, target: w.target, timer: w.timer },
    colonies: sim.colonies.map((c) => ({
      id: c.id, food: c.food, leaves: c.leaves, residents: c.residents, priorities: c.priorities, xp: c.evo.xp, level: c.evo.level,
      brood: c.brood.cohorts, eggAcc: c.brood.eggAcc, queen: c.queen, stats: c.stats, threats: c.threats, beacons: c.beacons, income: c.income,
      lastRaid: c.lastRaid, roomPriority: c.roomPriority, structureAnts: c.structureAnts, pending: c.pendingDeliveries,
      nest: { ex: c.nest.entranceX, ey: c.nest.entranceY, rooms: c.nest.rooms, sealed: c.nest.sealed },
      exploredCount: c.memory.exploredCount,
    })),
    directors: sim.directors.map((d) => ({ pendingRoomBp: d.pendingRoomBp, sealBp: d.sealBp, sealCells: d.sealCells })),
    food: { items: sim.food.items.filter((i) => !i.removed), next: (sim.food as any).nextId },
    creatures: { list: sim.creatures.list.filter((c) => c.alive).map((c) => ({ ...c, def: undefined })), next: (sim.creatures as any).nextId },
    plants: { list: sim.plants.plants, next: (sim.plants as any).nextId, seeds: [...(sim.plants as any).seeds.entries()] },
    structures: {
      list: [...sim.structures.items.values()].map((s) => ({ ...s, nx: [...s.nx], ny: [...s.ny], cx: [...s.cx], cy: [...s.cy], nodeAnt: [...s.nodeAnt] })),
      next: (sim.structures as any).nextId,
    },
    construction: {
      jobs: [...sim.construction.jobs.values()],
      bps: [...sim.construction.blueprints.values()],
      nextJob: (sim.construction as any).nextJob,
      nextBp: (sim.construction as any).nextBp,
    },
    routes: { list: [...sim.routes.routes.values()], next: (sim.routes as any).nextId },
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  // контейнер
  let size = 12 + jsonBytes.length + 4;
  for (const [k, v] of sec) size += 4 + k.length * 2 + 4 + v.length;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setUint32(o, MAGIC, true); o += 4;
  dv.setUint32(o, VERSION, true); o += 4;
  dv.setUint32(o, jsonBytes.length, true); o += 4;
  out.set(jsonBytes, o); o += jsonBytes.length;
  dv.setUint32(o, sec.size, true); o += 4;
  for (const [k, v] of sec) {
    const kb = new TextEncoder().encode(k);
    dv.setUint32(o, kb.length, true); o += 4;
    out.set(kb, o); o += kb.length;
    dv.setUint32(o, v.length, true); o += 4;
    out.set(v, o); o += v.length;
  }
  return gzip(out.subarray(0, o));
}

function antFieldNames(a: AntStore): string[] {
  return Object.keys(a).filter((k) => ArrayBuffer.isView((a as any)[k]));
}

export async function deserialize(raw: Uint8Array): Promise<Simulation> {
  const data = await gunzip(raw);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  if (dv.getUint32(o, true) !== MAGIC) throw new Error('Это не сохранение РОЯ');
  o += 4;
  const ver = dv.getUint32(o, true); o += 4;
  if (ver > VERSION) throw new Error('Сохранение из более новой версии');
  const jl = dv.getUint32(o, true); o += 4;
  const json = JSON.parse(new TextDecoder().decode(data.subarray(o, o + jl)));
  o += jl;
  const ns = dv.getUint32(o, true); o += 4;
  const sec: Sections = new Map();
  for (let k = 0; k < ns; k++) {
    const kl = dv.getUint32(o, true); o += 4;
    const key = new TextDecoder().decode(data.subarray(o, o + kl)); o += kl;
    const vl = dv.getUint32(o, true); o += 4;
    sec.set(key, data.slice(o, o + vl)); o += vl;
  }
  const p = json.params;
  const t = new Terrain(p.width, p.height);
  const put = (dst: ArrayBufferView, key: string) => {
    const s = sec.get(key);
    if (!s) return;
    new Uint8Array(dst.buffer, dst.byteOffset, dst.byteLength).set(s.subarray(0, dst.byteLength));
  };
  put(t.mat, 't.mat'); put(t.hp, 't.hp'); put(t.moist, 't.moist'); put(t.water, 't.water');
  put(t.stress, 't.stress'); put(t.flags, 't.flags'); put(t.plant, 't.plant'); put(t.temp, 't.temp');
  t.rebuildSkyline();
  const world: WorldData = {
    params: p,
    terrain: t,
    zones: json.zones,
    plants: [],
    foods: [],
    creatures: [],
    nests: json.colonies.map((c: any) => ({ colony: c.id, entranceX: c.nest.ex, entranceY: c.nest.ey, rooms: [] })),
    landmarks: json.landmarks,
  };
  const mode = modeByKey(json.mode);
  const sim = new Simulation(world, { ...mode, rival: json.colonies.length > 1 }, true);
  sim.time = json.time;
  sim.tick = json.tick;
  sim.clock.time = sim.time;
  // навигационные покрытия живых конструкций
  put(sim.nav.struct, 'nav.struct');
  sim.nav.rebuildAll();
  // муравьи
  const a = sim.ants;
  const n = json.ants.n;
  while (a.capacity < n) (a as any).alloc(a.capacity * 2);
  for (const f of antFieldNames(a)) put((a as any)[f].subarray(0, n * (f === 'thr' ? 5 : 1)), 'ant.' + f);
  a.n = n;
  a.count = json.ants.count;
  (a as any).free = json.ants.free;
  // колонии
  json.colonies.forEach((cj: any, ci: number) => {
    const col = sim.colonies[ci];
    Object.assign(col, {
      food: cj.food, leaves: cj.leaves, residents: cj.residents, priorities: cj.priorities, stats: cj.stats, threats: cj.threats,
      beacons: cj.beacons, income: cj.income, lastRaid: cj.lastRaid, roomPriority: cj.roomPriority, structureAnts: cj.structureAnts, pendingDeliveries: cj.pending,
    });
    Object.assign(col.queen, cj.queen);
    col.evo.level = cj.level;
    col.evo.xp = cj.xp;
    col.brood.cohorts = cj.brood;
    col.brood.eggAcc = cj.eggAcc;
    col.nest.rooms = cj.nest.rooms;
    (col.nest as any).nextRoom = Math.max(1, ...cj.nest.rooms.map((r: any) => r.id + 1));
    col.nest.sealed = cj.nest.sealed;
    for (let c = 0; c < P_COUNT; c++) {
      const q = sec.get(`c${ci}.ph${c}`);
      if (q) for (let i = 0; i < q.length; i++) col.pher.ch[c][i] = q[i] / PHER_SCALE;
    }
    const tr = sec.get(`c${ci}.traffic`);
    if (tr) for (let i = 0; i < tr.length; i++) col.pher.traffic[i] = tr[i] * 4;
    col.pher.reactivateAll(sim.time);
    put(col.memory.fog, `c${ci}.fog`);
    put(col.memory.explored, `c${ci}.explored`);
    put(col.memory.food, `c${ci}.mfood`);
    put(col.memory.danger, `c${ci}.mdanger`);
    col.memory.exploredCount = cj.exploredCount;
    col.memory.fogDirty = true;
    col.nest.field.buildNow(col.nest.homeSources());
    col.nest.carry.buildNow(col.nest.carrySources());
  });
  json.directors.forEach((d: any, i: number) => Object.assign(sim.directors[i], d));
  // еда
  const fs: any = sim.food;
  for (const it of json.food.items) { fs.items.push(it); fs.byId.set(it.id, it); }
  fs.nextId = json.food.next;
  fs.gridDirty = true;
  // существа
  for (const c of json.creatures.list) sim.creatures.list.push({ ...c, def: CREATURES[c.kind] });
  (sim.creatures as any).nextId = json.creatures.next;
  // растения
  for (const pl of json.plants.list) sim.plants.add(pl);
  (sim.plants as any).nextId = json.plants.next;
  (sim.plants as any).seeds = new Map(json.plants.seeds);
  // конструкции
  const st: any = sim.structures;
  for (const s of json.structures.list) {
    const rec = { ...s, nx: Float32Array.from(s.nx), ny: Float32Array.from(s.ny), cx: Float32Array.from(s.cx), cy: Float32Array.from(s.cy), nodeAnt: Int32Array.from(s.nodeAnt) };
    st.items.set(s.id, rec);
    for (const i of s.cells) st.cellOwner.set(i, s.id);
  }
  st.nextId = json.structures.next;
  // стройки
  const cs: any = sim.construction;
  for (const j of json.construction.jobs) {
    cs.jobs.set(j.id, j);
    cs.jobAt.set(j.y * t.W + j.x, j.id);
    const bp = json.construction.bps.find((b: any) => b.id === j.bp);
    const col = bp ? bp.colony : 0;
    while (cs.open.length <= col) cs.open.push([]);
    cs.open[col].push(j.id);
  }
  for (const b of json.construction.bps) cs.blueprints.set(b.id, b);
  cs.nextJob = json.construction.nextJob;
  cs.nextBp = json.construction.nextBp;
  // маршруты
  for (const r of json.routes.list) sim.routes.routes.set(r.id, r);
  (sim.routes as any).nextId = json.routes.next;
  // погода и случайность
  Object.assign(sim.weather, json.weather);
  json.rngs.forEach((s: number, i: number) => { if (sim.rngs[i]) sim.rngs[i].state = s; });
  sim.antSystem.recount();
  sim.water.renderDirty.clear();
  for (let cy = 0; cy < t.H; cy += 32) for (let cx = 0; cx < t.W; cx += 32) t.waterDirty.markCell(cx, cy);
  return sim;
}

// ------------------------------------------------------------------ хранилище (IndexedDB)

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open('roy-saves', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('saves');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function storeSave(slot: string, data: Uint8Array): Promise<void> {
  const d = await db();
  await new Promise<void>((res, rej) => {
    const tx = d.transaction('saves', 'readwrite');
    tx.objectStore('saves').put({ data, time: Date.now() }, slot);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function loadSave(slot: string): Promise<Uint8Array | null> {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('saves', 'readonly');
    const r = tx.objectStore('saves').get(slot);
    r.onsuccess = () => res(r.result ? (r.result.data as Uint8Array) : null);
    r.onerror = () => rej(r.error);
  });
}
