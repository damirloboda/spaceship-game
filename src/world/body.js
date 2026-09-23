// A planet or moon in the current system: surface generator, streaming
// terrain, vegetation, deposits, creatures, city, station, atmosphere,
// clouds and rings, all living in the body's rotating frame.
import * as THREE from 'three';
import { PlanetSurface, tangentFrame, offsetOnSphere } from './planetGen.js';
import { generateFauna, generateFlora } from './lifeGen.js';
import { Terrain } from '../render/terrain.js';
import { Scatter } from '../render/scatter.js';
import { Fauna } from '../render/fauna.js';
import { City, CITY_RADIUS } from '../render/city.js';
import { Station } from '../render/station.js';
import { createAtmosphereMaterial, createCloudMaterial, createRingMaterial, createWaterMaterial } from '../render/shaders.js';
import { colorize, merge } from '../render/models.js';

const tmpV = new THREE.Vector3();

export class Body {
  constructor(def, ctx) {
    this.def = def;
    this.id = def.id;
    this.ctx = ctx;
    this.surface = new PlanetSurface(def);
    this.radius = def.radius;
    this.gravity = def.gravity;
    this.atmoHeight = def.atmosphere ? def.radius * 0.25 : 0;
    this.atmoTop = def.radius + this.atmoHeight;
    this.soi = def.radius * 8;
    this.spinRate = (Math.PI * 2) / def.spinPeriod;
    // anchor: position + axial tilt; spin: day/night rotation
    this.anchor = new THREE.Group();
    this.anchor.name = `body:${def.name}`;
    this.anchor.position.set(...def.position);
    this.anchor.rotation.z = def.tilt;
    this.spin = new THREE.Group();
    this.anchor.add(this.spin);
    this.sites = {};
    this.planSites();
    const q = ctx.quality;
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: def.type === 'ice' || def.type === 'crystal' ? 0.55 : 0.93,
      metalness: def.type === 'crystal' ? 0.15 : 0.0,
    });
    if (def.type === 'lava' || def.type === 'superhot') {
      this.terrainMaterial.emissive = new THREE.Color(0.35, 0.06, 0.0);
    }
    if (def.type === 'bioluminescent') this.terrainMaterial.emissive = new THREE.Color(0.0, 0.05, 0.06);
    this.waterMaterial = def.ocean ? createWaterMaterial(def.type === 'toxic' ? [0.12, 0.25, 0.05] : [0.02, 0.14, 0.26]) : null;
    this.flora = generateFlora(def, 20);
    this.faunaSpecies = generateFauna(def, 10);
    this.scatter = new Scatter(this, { flora: this.flora, density: q.flora, isMined: ctx.isMined });
    this.terrain = new Terrain(this.surface, {
      grid: q.grid,
      split: q.split,
      material: this.terrainMaterial,
      waterMaterial: this.waterMaterial,
      hooks: { onCreate: (n) => this.scatter.onNodeCreate(n), onDispose: (n) => this.scatter.onNodeDispose(n) },
    });
    this.spin.add(this.terrain.group, this.scatter.group);
    this.fauna = new Fauna(this, this.faunaSpecies, { max: q.creatures, ecosystem: ctx.ecosystem?.(def.id) || {} });
    this.spin.add(this.fauna.group);
    if (def.city && this.sites.city) {
      this.city = new City(this, this.sites.city, { name: def.city.name, civIndex: def.civilization ?? 0, seed: def.seed });
      this.spin.add(this.city.group);
    }
    if (def.station && this.sites.city) {
      this.station = new Station(this, this.sites.city.dir, def.station.altitude, def.station.name || 'Station');
      this.spin.add(this.station.group);
    }
    if (this.sites.ruin) this.buildRuin();
    this.buildAtmosphere(q);
    this.buildRings();
    this.currentFog = true;
    this.setFogEnabled(false);
  }

  planSites() {
    const s = this.surface;
    const def = this.def;
    if (def.city) {
      const site = s.findSite('city', { minH: 40, maxH: 180 });
      if (site) {
        this.sites.city = site;
        s.addFlatZone(site.dir, CITY_RADIUS + 20, site.height, 160);
        const frame = tangentFrame(site.dir);
        const padDir = offsetOnSphere(site.dir, frame, 0, -CITY_RADIUS - 70, def.radius);
        s.addFlatZone(padDir, 50, site.height, 60);
        this.sites.pad = { dir: padDir, height: site.height };
        // Player spawn: a hilltop overlook ~600 m from the city.
        const spawnDir = offsetOnSphere(site.dir, frame, 420, -520, def.radius);
        this.sites.spawn = { dir: spawnDir };
        const shipDir = offsetOnSphere(site.dir, frame, 440, -560, def.radius);
        const sh = s.rawHeight(...shipDir);
        s.addFlatZone(shipDir, 26, Math.max(sh, 6), 30);
        this.sites.shipPad = { dir: shipDir, height: Math.max(sh, 6) };
      }
    }
    if (def.ancientSite) {
      const site = s.findSite('ruin', { minH: -1e9, maxH: 1e9, tries: 60 });
      if (site) {
        this.sites.ruin = site;
        s.addFlatZone(site.dir, 40, site.height, 40);
      }
    }
  }

  // Abandoned Precursor research outpost. Not marked on any map.
  buildRuin() {
    const site = this.sites.ruin;
    const R = this.radius;
    const up = new THREE.Vector3(...site.dir);
    const g = new THREE.Group();
    g.position.copy(up).multiplyScalar(R + site.height);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const parts = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pillar = new THREE.BoxGeometry(1.6, 9 + (i % 3) * 3, 1.6);
      pillar.translate(Math.cos(a) * 16, 4.5, Math.sin(a) * 16);
      parts.push(colorize(pillar, [0.25, 0.22, 0.3]));
    }
    const dome = new THREE.SphereGeometry(9, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4);
    parts.push(colorize(dome, [0.3, 0.28, 0.36]));
    const ring = new THREE.TorusGeometry(16, 0.6, 6, 40);
    ring.rotateX(Math.PI / 2); ring.translate(0, 12, 0);
    parts.push(colorize(ring, [0.35, 0.3, 0.42]));
    const mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.7 }));
    g.add(mesh);
    const terminal = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.4, 1).multiplyScalar(2), toneMapped: false }));
    terminal.position.set(0, 0.7, 10);
    g.add(terminal);
    this.spin.add(g);
    this.ruin = { group: g, terminal: g.localToWorld.bind(g), localPos: new THREE.Vector3(0, 0.7, 10).applyQuaternion(g.quaternion).add(g.position), core: terminal };
  }

  buildAtmosphere(q) {
    const def = this.def;
    if (def.atmosphere) {
      const mat = createAtmosphereMaterial({ radius: this.radius, top: this.atmoTop, color: def.atmosphere.color, density: def.atmosphere.density });
      this.atmoMaterial = mat;
      this.atmo = new THREE.Mesh(new THREE.SphereGeometry(this.atmoTop, 96, 48), mat);
      this.atmo.renderOrder = 5;
      this.atmo.frustumCulled = false;
      this.anchor.add(this.atmo);
      if (q.clouds > 0 && def.type !== 'barren') {
        const cloudR = this.radius + Math.min(this.atmoHeight * 0.45, 1800);
        const cmat = createCloudMaterial({ color: def.type === 'toxic' ? [0.8, 0.95, 0.6] : def.type === 'lava' ? [0.4, 0.35, 0.33] : [1, 1, 1], octaves: q.clouds + 1, coverage: def.type === 'cloud' ? 0.8 : 0.45 });
        this.cloudMaterial = cmat;
        this.clouds = new THREE.Mesh(new THREE.SphereGeometry(cloudR, 128, 64), cmat);
        this.clouds.renderOrder = 6;
        this.cloudRadius = cloudR;
        this.spin.add(this.clouds);
      }
    }
  }

  buildRings() {
    const r = this.def.rings;
    if (!r) return;
    const geo = new THREE.RingGeometry(r.inner, r.outer, 256, 1);
    this.ringMaterial = createRingMaterial({ inner: r.inner, outer: r.outer, color: r.color, planetRadius: this.radius, seed: this.def.seed });
    this.rings = new THREE.Mesh(geo, this.ringMaterial);
    this.rings.rotation.x = -Math.PI / 2 + (r.tilt || 0);
    this.rings.renderOrder = 4;
    this.rings.frustumCulled = false;
    this.anchor.add(this.rings);
  }

  setFogEnabled(on) {
    if (on === this.currentFog) return;
    this.currentFog = on;
    const mats = [this.terrainMaterial, this.waterMaterial, ...(this.scatter?.species.map((s) => s.mesh.material) || []), ...Object.values(this.scatter?.depositMeshes || {}).map((m) => m.material), this.fauna?.material, this.fauna?.glowMaterial, ...(this.city?.materials || [])];
    for (const m of mats) {
      if (!m) continue;
      m.fog = on;
      m.needsUpdate = true;
    }
  }

  setQuality(q) {
    this.terrain.setQuality(q.grid, q.split);
    this.fauna.max = q.creatures;
  }

  // ---- queries (all in body-local coordinates) ----
  heightAt(dir) {
    return this.surface.heightAt(dir.x, dir.y, dir.z);
  }

  groundRadius(dir) {
    return this.radius + this.surface.heightAt(dir.x, dir.y, dir.z);
  }

  // Ground or sea surface, whichever is higher.
  surfaceRadius(dir) {
    const g = this.groundRadius(dir);
    return this.def.ocean ? Math.max(g, this.radius) : g;
  }

  altitude(local) {
    const r = local.length();
    return r - this.groundRadius(tmpV.copy(local).divideScalar(r));
  }

  gravityAt(local) {
    const r = Math.max(local.length(), this.radius * 0.5);
    return this.gravity * (this.radius / r) ** 2;
  }

  airDensity(local) {
    if (!this.def.atmosphere) return 0;
    const alt = local.length() - this.radius;
    if (alt > this.atmoHeight) return 0;
    return this.def.atmosphere.density * Math.exp(-Math.max(alt, 0) / (this.atmoHeight * 0.3));
  }

  inAtmosphere(local) {
    return !!this.def.atmosphere && local.length() < this.atmoTop;
  }

  // Local solar hour at a body-local position.
  localHour(local, sunLocal) {
    const up = tmpV.copy(local).normalize();
    const f = tangentFrame([up.x, up.y, up.z]);
    const sUp = sunLocal.dot(up);
    const sE = sunLocal.x * f.east[0] + sunLocal.y * f.east[1] + sunLocal.z * f.east[2];
    let hour = 12 - Math.atan2(sE, sUp) * (12 / Math.PI);
    hour = ((hour % 24) + 24) % 24;
    return hour;
  }

  toLocal(world, out = new THREE.Vector3()) {
    return this.spin.worldToLocal(out.copy(world));
  }

  toWorld(local, out = new THREE.Vector3()) {
    return this.spin.localToWorld(out.copy(local));
  }

  dispose() {
    this.terrain.dispose();
    this.scatter.dispose();
    this.fauna.dispose();
    this.city?.dispose();
    this.station?.dispose();
    this.terrainMaterial.dispose();
    this.waterMaterial?.dispose();
    this.atmo?.geometry.dispose();
    this.atmoMaterial?.dispose();
    this.clouds?.geometry.dispose();
    this.cloudMaterial?.dispose();
    this.rings?.geometry.dispose();
    this.ringMaterial?.dispose();
    this.anchor.removeFromParent();
  }
}
