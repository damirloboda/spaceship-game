// The currently loaded star system. Only one system is in memory at a time;
// travelling to another one disposes this one and generates the next from
// its seed (streaming at galaxy scale).
import * as THREE from 'three';
import { generateSystem, systemPosition, makePlanet } from './galaxy.js';
import { RNG } from '../core/rng.js';
import { Body } from './body.js';
import { createStarGlowMaterial, createBlackHoleMaterial, createWormholeMaterial } from '../render/shaders.js';
import { colorize, merge } from '../render/models.js';

export class Universe {
  static BodyClass = Body;

  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'system';
    scene.add(this.root);
    this.bodies = [];
    this.anomalies = [];
    this.billboards = [];
    this.system = null;
    this.time = 0;
    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.castShadow = false;
    scene.add(this.sun, this.sun.target);
    this.ambient = new THREE.HemisphereLight(0x8899bb, 0x221a14, 0.25);
    scene.add(this.ambient);
    this.sunWorld = new THREE.Vector3();
  }

  load(systemId) {
    this.unload();
    const sys = generateSystem(systemId);
    this.system = sys;
    this.billboards = [];
    this.galaxyPosition = systemPosition(systemId);
    const star = sys.star;
    const color = new THREE.Color(...star.color);
    if (star.type !== 'black_hole') {
      this.starMesh = new THREE.Mesh(new THREE.SphereGeometry(star.radius, 32, 16), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(6), toneMapped: false }));
      this.root.add(this.starMesh);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(star.radius * 14, star.radius * 14), createStarGlowMaterial(star.color));
      glow.renderOrder = 3;
      this.starGlow = glow;
      this.root.add(glow);
      for (const c of star.companions) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(c.radius, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(...c.color).multiplyScalar(5), toneMapped: false }));
        m.position.set(...c.offset);
        this.root.add(m);
        const g = new THREE.Mesh(new THREE.PlaneGeometry(c.radius * 12, c.radius * 12), createStarGlowMaterial(c.color));
        g.position.copy(m.position);
        this.billboards.push(g);
        this.root.add(g);
      }
      this.sun.color.copy(color).lerp(new THREE.Color(1, 1, 1), 0.5);
      this.sun.intensity = 2.4 + star.luminosity * 0.8;
    } else {
      this.sun.color.set(0xffc9a0);
      this.sun.intensity = 0.6;
    }
    for (const def of sys.bodies) {
      const body = new Body(def, this.ctx);
      this.root.add(body.anchor);
      this.bodies.push(body);
    }
    for (const a of sys.anomalies) this.anomalies.push(this.buildAnomaly(a));
    this.updateSpin(0);
    return sys;
  }

  buildAnomaly(a) {
    const g = new THREE.Group();
    g.position.set(...a.position);
    const rec = { def: a, group: g, material: null };
    if (a.type === 'black_hole') {
      const mat = createBlackHoleMaterial();
      const disk = new THREE.Mesh(new THREE.PlaneGeometry(a.radius * 8, a.radius * 8), mat);
      rec.billboard = disk;
      g.add(disk);
      const tilted = new THREE.Mesh(new THREE.RingGeometry(a.radius * 1.4, a.radius * 4, 128, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.2).multiplyScalar(1.5), transparent: true, opacity: 0.35, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      tilted.rotation.x = -Math.PI / 2 + 0.2;
      g.add(tilted);
      rec.material = mat;
    } else if (a.type === 'wormhole') {
      const mat = createWormholeMaterial();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(a.radius, 48, 24), mat));
      rec.material = mat;
    } else if (a.type === 'derelict') {
      const parts = [];
      const hull = new THREE.CylinderGeometry(6, 8, 50, 10);
      hull.rotateZ(Math.PI / 2 + 0.4);
      parts.push(colorize(hull, [0.35, 0.33, 0.3]));
      const wing = new THREE.BoxGeometry(4, 1, 30);
      wing.translate(0, 0, 10); wing.rotateY(0.6);
      parts.push(colorize(wing, [0.3, 0.28, 0.27]));
      const mesh = new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.4 }));
      g.add(mesh);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a2a }));
      beacon.position.set(0, 9, 0);
      g.add(beacon);
      rec.beacon = beacon;
    }
    this.root.add(g);
    return rec;
  }

  makeRandomPlanet(pos) {
    const rng = new RNG((Math.random() * 2 ** 31) | 0);
    const def = makePlanet(`${this.system.id}/dev${this.bodies.length}`, rng, this.system.star, pos.length(), this.bodies.length);
    def.position = pos.toArray();
    return def;
  }

  unload() {
    for (const b of this.bodies) b.dispose();
    this.bodies = [];
    for (const a of this.anomalies) {
      a.group.traverse((o) => { o.geometry?.dispose(); if (o.material) o.material.dispose(); });
      a.group.removeFromParent();
    }
    this.anomalies = [];
    for (const child of [...this.root.children]) {
      child.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      this.root.remove(child);
    }
    this.starMesh = null;
    this.starGlow = null;
    this.system = null;
  }

  updateSpin(dt) {
    this.time += dt;
    for (const b of this.bodies) {
      b.spin.rotation.y = b.def.spinPhase + this.time * b.spinRate;
    }
    this.root.updateMatrixWorld(true);
  }

  body(id) {
    return this.bodies.find((b) => b.id === id) || null;
  }

  // The body whose sphere of influence contains a world position (closest wins).
  dominantBody(world) {
    let best = null, bd = Infinity;
    for (const b of this.bodies) {
      const d = world.distanceTo(b.anchor.position);
      if (d < b.soi && d < bd) { bd = d; best = b; }
    }
    return best;
  }

  nearestBody(world) {
    let best = null, bd = Infinity;
    for (const b of this.bodies) {
      const d = world.distanceTo(b.anchor.position) - b.radius;
      if (d < bd) { bd = d; best = b; }
    }
    return { body: best, distance: bd };
  }

  // Far from every body's gravity well (Lightbreak charging requirement).
  clearOfWells(world) {
    for (const b of this.bodies) {
      if (world.distanceTo(b.anchor.position) < b.radius * 3) return false;
    }
    return true;
  }

  // focus: world position of the camera / player.
  update(dt, camera, focusWorld, activeBody) {
    this.updateSpin(dt);
    // The sun lights from the star towards the focus; shadow camera stays local.
    this.sunWorld.set(0, 0, 0);
    const toSun = this.sunWorld.clone().sub(focusWorld).normalize();
    this.sun.position.copy(focusWorld).addScaledVector(toSun, 2000);
    this.sun.target.position.copy(focusWorld);
    this.sun.target.updateMatrixWorld();
    if (this.starGlow) {
      this.starGlow.quaternion.copy(camera.quaternion);
      const d = camera.position.distanceTo(this.starGlow.position);
      this.starGlow.visible = d > (this.system?.star.radius || 1) * 1.5;
    }
    for (const a of this.anomalies) {
      if (a.material?.uniforms?.uTime) a.material.uniforms.uTime.value += dt;
      if (a.billboard) a.billboard.quaternion.copy(camera.quaternion);
      if (a.beacon) a.beacon.visible = Math.sin(this.time * 4) > 0;
    }
    for (const b of this.billboards) b.quaternion.copy(camera.quaternion);
  }
}
