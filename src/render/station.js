// Orbital station with a rotating habitat ring and a docking hangar. The
// station sits in the planet's rotating frame, geostationary over the city.
import * as THREE from 'three';
import { colorize, merge } from './models.js';
import { orientOnSurface } from './fauna.js';

export class Station {
  constructor(body, dir, altitude, name = 'Station') {
    this.body = body;
    this.name = name;
    this.group = new THREE.Group();
    this.group.name = 'station';
    const up = new THREE.Vector3(...dir).normalize();
    this.position = up.clone().multiplyScalar(body.surface.radius + altitude);
    this.group.position.copy(this.position);
    // Hangar faces east so ships approach tangentially.
    const east = new THREE.Vector3(0, 1, 0).cross(up).normalize();
    if (east.lengthSq() < 1e-6) east.set(1, 0, 0);
    orientOnSurface(this.group, up, east);
    this.build();
    this.dockPoint = new THREE.Vector3(0, -30, -150); // station-local, in front of hangar mouth
    this.bayPoint = new THREE.Vector3(0, -30, -60);
    this.dockRadius = 90;
    this.time = 0;
  }

  build() {
    const hull = [], glow = [];
    const hub = new THREE.CylinderGeometry(34, 34, 180, 24);
    hull.push(colorize(hub, [0.78, 0.8, 0.84]));
    for (const y of [-95, 95]) {
      const cap = new THREE.SphereGeometry(34, 20, 10);
      cap.scale(1, 0.5, 1); cap.translate(0, y, 0);
      hull.push(colorize(cap, [0.7, 0.72, 0.76]));
    }
    const antenna = new THREE.CylinderGeometry(1.5, 3, 120, 6);
    antenna.translate(0, 170, 0);
    hull.push(colorize(antenna, [0.6, 0.6, 0.62]));
    // Hangar box with an open mouth towards -Z
    const hangar = [
      [new THREE.BoxGeometry(90, 6, 110), [0, -30 + 23, -60]],
      [new THREE.BoxGeometry(90, 6, 110), [0, -30 - 23, -60]],
      [new THREE.BoxGeometry(6, 52, 110), [-45, -30, -60]],
      [new THREE.BoxGeometry(6, 52, 110), [45, -30, -60]],
      [new THREE.BoxGeometry(90, 52, 6), [0, -30, -3]],
    ];
    for (const [g, p] of hangar) { g.translate(...p); hull.push(colorize(g, [0.5, 0.52, 0.56])); }
    const mouth = new THREE.TorusGeometry(40, 1.2, 6, 4);
    mouth.rotateZ(Math.PI / 4); mouth.scale(1.1, 0.62, 1); mouth.translate(0, -30, -115);
    glow.push(colorize(mouth, [1, 1, 1]));
    for (let i = 0; i < 6; i++) {
      const strip = new THREE.BoxGeometry(2, 0.5, 8);
      strip.translate(0, -30 - 19.5, -110 + i * 18);
      glow.push(colorize(strip, [1, 1, 1]));
    }
    // Solar arrays
    for (const side of [-1, 1]) {
      const arm = new THREE.BoxGeometry(160, 3, 3);
      arm.translate(side * 110, 60, 0);
      hull.push(colorize(arm, [0.55, 0.55, 0.58]));
      const panel = new THREE.BoxGeometry(120, 1, 44);
      panel.translate(side * 130, 60, 0);
      hull.push(colorize(panel, [0.12, 0.18, 0.45]));
    }
    const hullMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6 });
    const glowMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0, emissive: new THREE.Color(0.4, 0.85, 1.0), emissiveIntensity: 1.4 });
    const hullMesh = new THREE.Mesh(merge(hull), hullMat);
    const glowMesh = new THREE.Mesh(merge(glow), glowMat);
    this.group.add(hullMesh, glowMesh);
    // Rotating habitat ring
    const ringParts = [];
    const torus = new THREE.TorusGeometry(230, 16, 10, 64);
    torus.rotateX(Math.PI / 2);
    ringParts.push(colorize(torus, [0.85, 0.86, 0.88]));
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.BoxGeometry(200, 6, 6);
      spoke.translate(130, 0, 0); spoke.rotateY((i / 4) * Math.PI * 2);
      ringParts.push(colorize(spoke, [0.6, 0.62, 0.65]));
    }
    const windows = new THREE.TorusGeometry(230, 16.4, 4, 64, Math.PI * 2);
    windows.rotateX(Math.PI / 2); windows.scale(1, 0.12, 1);
    this.ring = new THREE.Group();
    this.ring.add(new THREE.Mesh(merge(ringParts), hullMat));
    this.ring.add(new THREE.Mesh(colorize(windows, [1, 1, 1]), new THREE.MeshStandardMaterial({ vertexColors: true, color: 0, emissive: new THREE.Color(1.0, 0.85, 0.6), emissiveIntensity: 1.2 })));
    this.ring.position.y = 20;
    this.group.add(this.ring);
    // Blinking nav lights
    this.navLights = [];
    for (const p of [[-45, -4, -115], [45, -4, -115], [-45, -56, -115], [45, -56, -115], [0, 232, 0]]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(2.2, 8, 6), new THREE.MeshBasicMaterial({ color: p[1] > 100 ? 0xff3030 : 0x30ff60 }));
      m.position.set(...p);
      this.group.add(m);
      this.navLights.push(m);
    }
    this.materials = [hullMat, glowMat];
  }

  update(dt) {
    this.time += dt;
    this.ring.rotation.y += dt * 0.05;
    const on = Math.sin(this.time * 3) > 0.3;
    for (const l of this.navLights) l.visible = on;
  }

  // Convert between body-local and station-local coordinates.
  toStation(bodyLocal) {
    return this.group.worldToLocal(this.group.parent.localToWorld(bodyLocal.clone()));
  }

  dockWorld(out = new THREE.Vector3()) {
    return this.group.localToWorld(out.copy(this.dockPoint));
  }

  bayWorld(out = new THREE.Vector3()) {
    return this.group.localToWorld(out.copy(this.bayPoint));
  }

  // Crude collision against hub, ring and hangar walls (station-local).
  collides(stationLocal, radius) {
    const p = stationLocal;
    if (Math.hypot(p.x, p.z) < 34 + radius && Math.abs(p.y) < 110) return true;
    const rr = Math.hypot(p.x, p.z);
    if (Math.abs(rr - 230) < 16 + radius && Math.abs(p.y - 20) < 16 + radius) return true;
    return false;
  }

  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    for (const m of this.materials) m.dispose();
  }
}
