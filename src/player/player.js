// On-foot controller for spherical worlds and ship interiors: walking,
// sprinting, jumping, Jetpack flight, swimming and diving, footprints,
// first-person arms and legs, optional third-person body.
import * as THREE from 'three';
import { humanoidModel, animateHumanoid, colorize, merge } from '../render/models.js';
import { animatedInstance, CHARACTER_MODELS, addHelmet } from '../render/modelLib.js';
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
    this.modelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15, envMapIntensity: 1.2 });
    const charName = CHARACTER_MODELS[p.character | 0] || CHARACTER_MODELS[0];
    // Animated astronaut; the procedural humanoid is the fallback.
    this.anim = animatedInstance(charName, 1.8, { yaw: Math.PI, prefer: { idle: /^idle_gun$/i, walk: /^walk_gun$/i, run: /^run_gun$/i } });
    if (this.anim) this.helmet = addHelmet(this.anim, { tint: visor.getHex() });
    this.model = this.anim ? this.anim.root : humanoidModel([[suit.r, suit.g, suit.b], [visor.r * 0.6, visor.g * 0.6, visor.b * 0.6]], 1.8, this.modelMat, { suit: true, accent: [visor.r, visor.g, visor.b] });
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
    // First-person view: right forearm in a segmented suit sleeve holding
    // the multitool blaster, which glows in the visor colour.
    this.fpArms = new THREE.Group();
    const sleeveC = [suit.r * 0.85, suit.g * 0.85, suit.b * 0.85];
    const dark = [0.16, 0.17, 0.2], metal = [0.42, 0.44, 0.48], accent = [visor.r, visor.g, visor.b];
    const arm = [];
    // Sleeve axis runs from the lower right corner toward the grip.
    const aim = new THREE.Vector3(-0.07, 0.11, -0.24).normalize();
    const C = new THREE.Vector3(0.2, -0.31, -0.26);
    const along = (geo, t) => {
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), aim));
      const p = C.clone().addScaledVector(aim, t);
      return geo.translate(p.x, p.y, p.z);
    };
    arm.push(colorize(along(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 12), 0), sleeveC));
    for (const t of [-0.07, 0.03]) arm.push(colorize(along(new THREE.CylinderGeometry(0.042, 0.042, 0.018, 12), t), dark));
    arm.push(colorize(along(new THREE.CylinderGeometry(0.034, 0.036, 0.03, 12), 0.14), accent));
    const glove = new THREE.BoxGeometry(0.055, 0.05, 0.075);
    glove.translate(0.155, -0.235, -0.41);
    arm.push(colorize(glove, dark));
    for (let i = 0; i < 3; i++) {
      const finger = new THREE.BoxGeometry(0.012, 0.014, 0.04);
      finger.translate(0.137 + i * 0.013, -0.205, -0.43);
      arm.push(colorize(finger, dark));
    }
    this.armMesh = new THREE.Mesh(merge(arm), this.modelMat);
    this.fpArms.add(this.armMesh);
    const tool = [];
    const body = new THREE.BoxGeometry(0.05, 0.06, 0.2); body.translate(0.15, -0.185, -0.5);
    tool.push(colorize(body, metal));
    const top = new THREE.BoxGeometry(0.03, 0.02, 0.16); top.translate(0.15, -0.148, -0.51);
    tool.push(colorize(top, dark));
    const grip = new THREE.BoxGeometry(0.035, 0.07, 0.04); grip.rotateX(-0.3); grip.translate(0.15, -0.22, -0.43);
    tool.push(colorize(grip, dark));
    const barrel = new THREE.CylinderGeometry(0.016, 0.02, 0.12, 12); barrel.rotateX(Math.PI / 2); barrel.translate(0.15, -0.18, -0.65);
    tool.push(colorize(barrel, dark));
    const fin = new THREE.BoxGeometry(0.06, 0.008, 0.07);
    for (const dy of [-0.2, -0.165]) tool.push(colorize(fin.clone().translate(0.15, dy, -0.58), metal));
    this.tool = new THREE.Mesh(merge(tool), this.modelMat);
    this.fpArms.add(this.tool);
    // Glowing coil, muzzle ring and status screen.
    this.toolGlowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(visor.r, visor.g, visor.b), emissiveIntensity: 1.6, roughness: 0.3 });
    const glow = [];
    const coil = new THREE.CylinderGeometry(0.022, 0.022, 0.08, 12); coil.rotateX(Math.PI / 2); coil.translate(0.15, -0.185, -0.54);
    glow.push(coil);
    const ringG = new THREE.TorusGeometry(0.02, 0.004, 6, 16); ringG.translate(0.15, -0.18, -0.71);
    glow.push(ringG);
    const screen = new THREE.BoxGeometry(0.026, 0.004, 0.05); screen.translate(0.15, -0.137, -0.46);
    glow.push(screen);
    this.toolGlow = new THREE.Mesh(merge(glow), this.toolGlowMat);
    this.fpArms.add(this.toolGlow);
    this.toolTip = new THREE.Object3D();
    this.toolTip.position.set(0.15, -0.18, -0.72);
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
    const stickFull = Math.hypot(input.touch.move.x, input.touch.move.y) > 0.95;
    const sprint = (input.held('sprint') || stickFull) && this.grounded && mv.y > 0.2;
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
      const hw = ship.model.shell ? 3.4 : 4.6;
      const zMin = ship.model.shell ? -20.5 : -19.5, zMax = ship.model.shell ? 17.8 : 12.8;
      if (Math.abs(local.x) < hw && local.z > zMin && local.z < zMax && local.y < 4.5 && local.y > -3.5) {
        // push sideways out of the hull
        const sx = Math.sign(local.x || 1) * (hw - Math.abs(local.x));
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
    if (this.anim) {
      const a = this.anim;
      let state = 'idle', rate = 1;
      if (this.swimming) { state = 'swim'; rate = 0.6; }
      else if (!this.grounded && this.airTime > 0.15) state = 'fall';
      else if (this.speed > 6) { state = 'run'; rate = this.speed / 8; }
      else if (this.speed > 0.4) { state = 'walk'; rate = THREE.MathUtils.clamp(this.speed / 3.2, 0.5, 1.6); }
      a.play(state, 0.2, rate);
      a.update(dt);
      this.model.visible = tp;
      this.jetpackMesh.visible = false;
      this.fpArms.visible = !tp && !this.game.photo?.active;
      const k = this.game.settings.reducedMotion ? 0 : 1;
      this.fpArms.position.set(Math.sin(this.bob * 1.6) * 0.012 * k, Math.abs(Math.cos(this.bob * 1.6)) * 0.015 * k - this.landImpact * 0.05, 0);
      this.landImpact = Math.max(0, this.landImpact - dt * 3);
      // The blaster kicks and its coil flares while the beam is on.
      const firing = !!this.game.effects?.beam?.visible;
      this.toolGlowMat.emissiveIntensity = firing ? 3 + Math.random() * 1.5 : 1.4 + Math.sin(performance.now() / 400) * 0.2;
      this.fpArms.rotation.x = firing ? (Math.random() - 0.3) * 0.02 * k : 0;
      if (firing) this.fpArms.position.z += 0.008 * k;
      return;
    }
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
