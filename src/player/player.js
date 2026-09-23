// On-foot controller for spherical worlds and ship interiors: walking,
// sprinting, jumping, Jetpack flight, swimming and diving, footprints,
// first-person arms and legs, optional third-person body.
import * as THREE from 'three';
import { humanoidModel, animateHumanoid, colorize, merge } from '../render/models.js';
import { orientOnSurface } from '../render/fauna.js';
import { INTERIOR } from '../render/shipModel.js';

const EYE = 1.62;
const RADIUS = 0.32;
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Player {
  constructor(game) {
    this.game = game;
    this.object = new THREE.Group();
    this.object.name = 'player';
    this.head = new THREE.Group();
    this.head.position.y = EYE;
    this.object.add(this.head);
    this.tpPivot = new THREE.Group();
    this.tpPivot.position.y = 1.55;
    this.object.add(this.tpPivot);
    this.tpCam = new THREE.Object3D();
    this.tpCam.position.set(0.7, 0.35, 4.2);
    this.tpPivot.add(this.tpCam);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.pitch = 0;
    this.grounded = false;
    this.swimming = false;
    this.underwater = false;
    this.airTime = 0;
    this.mode = 'body'; // 'body' | 'interior'
    this.body = null;
    this.stepDist = 0;
    this.bob = 0;
    this.landImpact = 0;
    this.speed = 0;
    this.jetActive = false;
    this.buildVisuals();
  }

  buildVisuals() {
    const p = this.game.state.profile;
    const suit = new THREE.Color(p.suit);
    const visor = new THREE.Color(p.visor);
    this.modelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
    this.model = humanoidModel([[suit.r, suit.g, suit.b], [visor.r * 0.6, visor.g * 0.6, visor.b * 0.6]], 1.8, this.modelMat);
    this.object.add(this.model);
    // Jetpack on the back
    const jp = [];
    const pack = new THREE.BoxGeometry(0.46, 0.6, 0.24); pack.translate(0, 1.25, 0.3);
    jp.push(colorize(pack, [0.3, 0.32, 0.36]));
    for (const x of [-0.14, 0.14]) {
      const noz = new THREE.CylinderGeometry(0.06, 0.09, 0.2, 8); noz.translate(x, 0.88, 0.32);
      jp.push(colorize(noz, [0.15, 0.15, 0.16]));
      const tank = new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8); tank.translate(x, 1.28, 0.44);
      jp.push(colorize(tank, [0.95, 0.5, 0.15]));
    }
    this.jetpackMesh = new THREE.Mesh(merge(jp), this.modelMat);
    this.object.add(this.jetpackMesh);
    const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.6, 0.25).multiplyScalar(2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.flames = [];
    for (const x of [-0.14, 0.14]) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.7, 8, 1, true).translate(0, -0.35, 0).rotateX(Math.PI), flameMat);
      f.rotation.x = Math.PI;
      f.position.set(x, 0.78, 0.32);
      f.visible = false;
      this.object.add(f);
      this.flames.push(f);
    }
    // First-person arms + multitool
    this.fpArms = new THREE.Group();
    const armGeo = colorize(new THREE.CapsuleGeometry(0.055, 0.42, 2, 6).rotateX(Math.PI / 2), [suit.r * 0.9, suit.g * 0.9, suit.b * 0.9]);
    const gloveGeo = colorize(new THREE.SphereGeometry(0.07, 8, 6), [0.25, 0.25, 0.28]);
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, this.modelMat);
      arm.position.set(side * 0.22, -0.24, -0.3);
      arm.rotation.y = side * 0.12;
      const glove = new THREE.Mesh(gloveGeo, this.modelMat);
      glove.position.set(side * 0.2, -0.22, -0.56);
      this.fpArms.add(arm, glove);
    }
    const tool = [];
    const body = new THREE.BoxGeometry(0.09, 0.12, 0.34); body.translate(0.2, -0.17, -0.62);
    tool.push(colorize(body, [0.3, 0.32, 0.36]));
    const barrel = new THREE.CylinderGeometry(0.025, 0.03, 0.18, 8); barrel.rotateX(Math.PI / 2); barrel.translate(0.2, -0.14, -0.85);
    tool.push(colorize(barrel, [0.9, 0.5, 0.15]));
    const screen = new THREE.BoxGeometry(0.07, 0.04, 0.1); screen.translate(0.2, -0.1, -0.55);
    tool.push(colorize(screen, [0.2, 0.9, 1.0]));
    this.tool = new THREE.Mesh(merge(tool), this.modelMat);
    this.fpArms.add(this.tool);
    this.toolTip = new THREE.Object3D();
    this.toolTip.position.set(0.2, -0.14, -0.95);
    this.fpArms.add(this.toolTip);
  }

  setSuitColors() {
    this.object.remove(this.model, this.jetpackMesh, ...this.flames);
    this.modelMat.dispose();
    this.buildVisuals();
  }

  // ---- frame management ----
  placeOnBody(body, local, forward) {
    this.mode = 'body';
    this.body = body;
    body.spin.add(this.object);
    this.pos.copy(local);
    this.vel.set(0, 0, 0);
    this.up.copy(local).normalize();
    if (forward) this.forward.copy(forward);
    this.forward.addScaledVector(this.up, -this.forward.dot(this.up));
    if (this.forward.lengthSq() < 1e-6) this.forward.set(1, 0, 0).cross(this.up);
    this.forward.normalize();
    this.snapToGround(true);
    this.syncObject();
  }

  placeInShip(ship, local, forward) {
    this.mode = 'interior';
    this.body = null;
    this.ship = ship;
    ship.model.interior.add(this.object);
    this.pos.copy(local);
    this.vel.set(0, 0, 0);
    this.up.set(0, 1, 0);
    this.forward.copy(forward || new THREE.Vector3(0, 0, -1)).setY(0).normalize();
    this.grounded = true;
    this.syncObject();
  }

  snapToGround(force = false) {
    if (this.mode !== 'body' || !this.body) return;
    const r = this.pos.length();
    const dir = tmp.copy(this.pos).divideScalar(r);
    const gr = this.body.groundRadius(dir);
    if (force || r < gr) this.pos.copy(dir).multiplyScalar(gr);
  }

  syncObject() {
    this.object.position.copy(this.pos);
    orientOnSurface(this.object, this.up, this.forward);
    this.head.rotation.x = this.pitch;
    this.tpPivot.rotation.x = this.pitch * 0.8;
  }

  worldPosition(out = new THREE.Vector3()) {
    return this.object.getWorldPosition(out);
  }

  eyeWorld(out = new THREE.Vector3()) {
    return this.head.getWorldPosition(out);
  }

  aimWorld(out = new THREE.Vector3()) {
    return this.game.camera.getWorldDirection(out);
  }

  // ---- simulation ----
  update(dt, input) {
    const look = input.lookDelta(dt);
    this.pitch = THREE.MathUtils.clamp(this.pitch - look.y, -1.45, 1.45);
    this.forward.applyAxisAngle(this.up, -look.x);
    if (this.mode === 'body') this.updateOnBody(dt, input);
    else this.updateInterior(dt, input);
    this.syncObject();
    this.animate(dt);
  }

  updateOnBody(dt, input) {
    const body = this.body;
    const st = this.game.state;
    const up = this.up.copy(this.pos).normalize();
    this.forward.addScaledVector(up, -this.forward.dot(up)).normalize();
    const right = tmp2.crossVectors(this.forward, up).normalize();
    const g = body.gravityAt(this.pos);
    const air = body.airDensity(this.pos);
    const mv = input.move();
    const sprint = input.held('sprint') && this.grounded && mv.y > 0.2;
    const maxSpeed = this.swimming ? 3.2 : sprint ? 8.5 : 4.6;
    const wish = new THREE.Vector3().addScaledVector(this.forward, mv.y).addScaledVector(right, mv.x).multiplyScalar(maxSpeed);
    const vr = this.vel.dot(up);
    const vt = this.vel.clone().addScaledVector(up, -vr);
    const r = this.pos.length();
    const seaR = body.radius;
    this.swimming = body.def.ocean && r < seaR - 1.0;
    this.underwater = body.def.ocean && r + EYE < seaR;
    this.jetActive = false;
    if (this.swimming) {
      vt.lerp(wish, 1 - Math.exp(-3 * dt));
      let target = 0.8; // float up
      if (input.held('jump')) target = 2.8;
      if (input.held('crouch')) target = -2.8;
      if (r > seaR - 0.9 && target > 0) target = 0;
      const nvr = THREE.MathUtils.lerp(vr, target, 1 - Math.exp(-3 * dt));
      this.vel.copy(vt).addScaledVector(up, nvr);
      this.airTime = 0;
      st.jetpack.update(dt, false, g, air);
    } else if (this.grounded) {
      vt.lerp(wish, 1 - Math.exp(-12 * dt));
      this.vel.copy(vt);
      if (input.pressed('jump')) {
        this.vel.addScaledVector(up, Math.sqrt(2 * g * 1.15));
        this.grounded = false;
        this.game.audio?.play('jump');
      }
      this.airTime = 0;
      st.jetpack.update(dt, false, g, air);
    } else {
      this.airTime += dt;
      vt.lerp(wish, 1 - Math.exp(-1.2 * dt));
      let nvr = vr - g * dt;
      const want = input.held('jump') && this.airTime > 0.16;
      if (want && st.jetpack.owned && st.jetpack.fuel <= 0.5 && this.game.settings.autoRefuelJetpack) this.game.tools.autoRefuelJetpack();
      const jr = st.jetpack.update(dt, want, g, air);
      if (jr.active) {
        this.jetActive = true;
        nvr += jr.accel * dt;
        if (wish.lengthSq() > 0) vt.addScaledVector(wish.clone().normalize(), jr.lateral * dt);
        this.game.state.addXP('survival', dt * 0.2);
      }
      this.vel.copy(vt).addScaledVector(up, nvr);
      // Air drag
      this.vel.multiplyScalar(1 - Math.min(0.5, 0.02 * air * dt * this.vel.length()));
    }
    this.pos.addScaledVector(this.vel, dt);
    // Ground contact
    const r2 = this.pos.length();
    const dir = tmp.copy(this.pos).divideScalar(r2);
    const gr = body.groundRadius(dir);
    const vr2 = this.vel.dot(dir);
    if (r2 < gr) {
      this.pos.copy(dir).multiplyScalar(gr);
      if (!this.grounded) {
        this.landImpact = Math.min(1, -vr2 / 12);
        const hard = -vr2 - 14 * Math.sqrt(g / 9.8);
        if (hard > 0) this.game.damagePlayer(hard * 3, 'fall');
        if (-vr2 > 3) this.game.audio?.play('land');
      }
      this.vel.addScaledVector(dir, -vr2);
      this.grounded = true;
    } else if (this.grounded && r2 - gr < 0.7 && vr2 <= 0.5 && !this.swimming) {
      // stick to slopes when walking downhill
      this.pos.copy(dir).multiplyScalar(gr);
      this.vel.addScaledVector(dir, -this.vel.dot(dir));
    } else {
      this.grounded = false;
    }
    if (this.swimming) this.grounded = false;
    this.collide(dir);
    this.speed = this.vel.clone().addScaledVector(dir, -this.vel.dot(dir)).length();
    // Footsteps and footprints
    if (this.grounded && this.speed > 0.5) {
      this.stepDist += this.speed * dt;
      const stride = sprint ? 1.7 : 1.25;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        this.stepSide = !this.stepSide;
        const mat = body.surface.materialAt(dir.x, dir.y, dir.z);
        this.game.effects?.footprint(body, this.pos, this.forward, this.stepSide, mat);
        this.game.audio?.play('step', { material: mat });
        st.stats.distance += stride;
      }
    }
  }

  collide(dir) {
    const push = this.body.scatter.collide(this.pos, RADIUS);
    const city = this.body.city?.collide(this.pos, RADIUS);
    if (city) push.add(city);
    const ship = this.game.ship;
    if (ship && ship.body === this.body && ship.landed) {
      const local = ship.model.root.worldToLocal(this.object.parent.localToWorld(this.pos.clone()));
      if (Math.abs(local.x) < 4.2 && local.z > -13 && local.z < 12.5 && local.y < 4.5 && local.y > -3.5) {
        // push sideways out of the hull
        const sx = Math.sign(local.x || 1) * (4.2 - Math.abs(local.x));
        const worldPush = new THREE.Vector3(sx, 0, 0).applyQuaternion(ship.model.root.getWorldQuaternion(new THREE.Quaternion()));
        const localPush = worldPush.applyQuaternion(this.body.spin.getWorldQuaternion(new THREE.Quaternion()).invert());
        push.add(localPush);
      }
    }
    if (push.lengthSq() > 0) {
      push.addScaledVector(dir, -push.dot(dir));
      this.pos.add(push);
      const n = push.clone().normalize();
      const into = this.vel.dot(n);
      if (into < 0) this.vel.addScaledVector(n, -into);
    }
  }

  updateInterior(dt, input) {
    const st = this.game.state;
    this.up.set(0, 1, 0);
    this.forward.setY(0).normalize();
    const right = tmp2.crossVectors(this.forward, this.up).normalize();
    const mv = input.move();
    const speed = input.held('sprint') ? 5 : 3.2;
    const wish = new THREE.Vector3().addScaledVector(this.forward, mv.y).addScaledVector(right, mv.x).multiplyScalar(speed);
    const vy = this.vel.y;
    const vt = this.vel.clone().setY(0).lerp(wish, 1 - Math.exp(-14 * dt));
    this.vel.set(vt.x, vy - 9.8 * dt, vt.z);
    if (this.grounded && input.pressed('jump')) this.vel.y = 3.6;
    this.pos.addScaledVector(this.vel, dt);
    this.grounded = false;
    if (this.pos.y <= 0) { this.pos.y = 0; this.vel.y = Math.max(0, this.vel.y); this.grounded = true; }
    if (this.pos.y > INTERIOR.height - 1.75) { this.pos.y = INTERIOR.height - 1.75; this.vel.y = Math.min(0, this.vel.y); }
    // Axis-aligned walls
    for (const c of this.ship.model.colliders) {
      if (this.pos.y + 1.7 < c.min[1] || this.pos.y + 0.3 > c.max[1]) continue;
      const cx = THREE.MathUtils.clamp(this.pos.x, c.min[0], c.max[0]);
      const cz = THREE.MathUtils.clamp(this.pos.z, c.min[2], c.max[2]);
      const dx = this.pos.x - cx, dz = this.pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < RADIUS) {
        if (d > 1e-5) {
          this.pos.x += (dx / d) * (RADIUS - d);
          this.pos.z += (dz / d) * (RADIUS - d);
        } else {
          // centre inside the box: push out along the shortest axis
          const ox = Math.min(this.pos.x - c.min[0], c.max[0] - this.pos.x);
          const oz = Math.min(this.pos.z - c.min[2], c.max[2] - this.pos.z);
          if (ox < oz) this.pos.x = this.pos.x - c.min[0] < c.max[0] - this.pos.x ? c.min[0] - RADIUS : c.max[0] + RADIUS;
          else this.pos.z = this.pos.z - c.min[2] < c.max[2] - this.pos.z ? c.min[2] - RADIUS : c.max[2] + RADIUS;
        }
      }
    }
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, INTERIOR.minX + RADIUS, INTERIOR.maxX - RADIUS);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, INTERIOR.minZ + RADIUS, INTERIOR.maxZ - RADIUS);
    this.speed = vt.length();
    this.swimming = false;
    this.underwater = false;
    this.jetActive = false;
    st.jetpack.update(dt, false, 9.8, 1);
    // The ship tops up the jetpack from its reserves while aboard.
    if (st.jetpack.owned) st.jetpack.refuel(dt * 4);
    if (this.speed > 0.5) {
      this.stepDist += this.speed * dt;
      if (this.stepDist > 1.2) { this.stepDist = 0; this.game.audio?.play('step', { material: 'metal' }); }
    }
  }

  animate(dt) {
    const tp = this.game.cameraMode === 'third' || this.game.photo?.active;
    const jet = this.game.state.jetpack;
    this.jetpackMesh.visible = jet.owned;
    for (const f of this.flames) {
      f.visible = this.jetActive;
      if (this.jetActive) f.scale.set(1, 0.7 + Math.random() * 0.6, 1);
    }
    this.bob += this.speed * dt * (this.grounded ? 1 : 0.2);
    animateHumanoid(this.model, this.bob * 1.6, this.grounded ? this.speed : 0);
    if (!this.grounded && !this.swimming) {
      const l = this.model.limbs;
      l.legL.rotation.x = 0.35; l.legR.rotation.x = -0.1; l.armL.rotation.x = -0.3; l.armR.rotation.x = -0.3;
    }
    if (this.swimming) {
      const l = this.model.limbs;
      const s = Math.sin(this.bob * 3);
      l.armL.rotation.x = -1.6 + s * 0.6; l.armR.rotation.x = -1.6 - s * 0.6;
    }
    // In first person only the legs are drawn so you can see your feet.
    const bodyMesh = this.model.children[0];
    bodyMesh.visible = tp;
    this.model.limbs.armL.visible = tp;
    this.model.limbs.armR.visible = tp;
    this.jetpackMesh.visible = jet.owned && tp;
    this.fpArms.visible = !tp;
    // Weapon/tool sway
    const k = this.game.settings.reducedMotion ? 0 : 1;
    this.fpArms.position.set(Math.sin(this.bob * 1.6) * 0.012 * k, Math.abs(Math.cos(this.bob * 1.6)) * 0.015 * k - this.landImpact * 0.05, 0);
    this.landImpact = Math.max(0, this.landImpact - dt * 3);
  }

  // Camera shake / FOV hints for the camera rig.
  cameraOffset() {
    if (this.game.settings.reducedMotion) return 0;
    const b = this.grounded ? Math.sin(this.bob * 3.2) * 0.035 * Math.min(1, this.speed / 5) : 0;
    return b - this.landImpact * 0.12;
  }
}
