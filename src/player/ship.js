// Ship flight: takeoff, atmospheric and space flight, Overdrive (Nitro),
// Lightbreak (in-system cruise and interstellar jumps), manual/auto/emergency
// landing, docking, autopilot, crash damage and hazard handling.
import * as THREE from 'three';
import { Particles } from '../render/jetpackModel.js';
import { buildShip, GEAR_HEIGHT, RAMP_OPEN, RAMP_CLOSED } from '../render/shipModel.js';
import { FLIGHT } from '../game/shipSystems.js';

const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, -1);
const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();

export class Ship {
  constructor(game) {
    this.game = game;
    this.model = buildShip();
    this.root = this.model.root;
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.stick = new THREE.Vector2();
    this.throttle = 0;
    this.body = null; // frame body or null for deep space
    this.landed = false;
    this.docked = null;
    this.gear = 1;
    this.lb = { phase: 'none', t: 0, target: null, interstellar: false };
    this.autopilot = null;
    this.warnTimer = 0;
    this.hazard = null;
    this.emergency = false;
    this.speed = 0;
    this.altitude = Infinity;
    this.shake = 0;
  }

  get systems() {
    return this.game.state.ship;
  }

  worldPosition(out = new THREE.Vector3()) {
    return this.root.getWorldPosition(out);
  }

  forwardWorld(out = new THREE.Vector3()) {
    return out.copy(FWD).applyQuaternion(this.root.getWorldQuaternion(tq));
  }

  // Re-parent while preserving world transform and velocity.
  setFrame(body) {
    const parent = body ? body.spin : this.game.universe.root;
    if (this.root.parent === parent) { this.body = body; return; }
    const oldQ = this.root.parent ? this.root.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const worldVel = this.vel.clone().applyQuaternion(oldQ);
    parent.attach(this.root);
    const newQ = parent.getWorldQuaternion(new THREE.Quaternion());
    this.vel.copy(worldVel.applyQuaternion(newQ.invert()));
    this.body = body;
  }

  placeLanded(body, dir, heading) {
    this.setFrame(body);
    this.root.parent !== body.spin && body.spin.add(this.root);
    const up = new THREE.Vector3(...dir).normalize();
    const r = body.surfaceRadius(up) + GEAR_HEIGHT;
    this.root.position.copy(up).multiplyScalar(r);
    this.alignUp(up, heading, 1);
    this.vel.set(0, 0, 0);
    this.landed = true;
    this.gear = 1;
    this.throttle = 0;
  }

  placeInSpace(parentBody, local, quat, vel) {
    this.setFrame(parentBody);
    this.root.position.copy(local);
    if (quat) this.root.quaternion.copy(quat);
    this.vel.copy(vel || new THREE.Vector3());
    this.landed = false;
    this.docked = null;
    this.gear = 0;
  }

  // Rotate so ship-up matches `up`, keeping the heading as close as possible.
  alignUp(up, heading, t = 1) {
    const f = heading ? heading.clone() : FWD.clone().applyQuaternion(this.root.quaternion);
    f.addScaledVector(up, -f.dot(up));
    if (f.lengthSq() < 1e-6) f.set(1, 0, 0).cross(up);
    f.normalize();
    const right = new THREE.Vector3().crossVectors(f, up).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, f.clone().negate());
    tq.setFromRotationMatrix(m);
    this.root.quaternion.slerp(tq, t);
  }

  inAtmosphere() {
    return !!(this.body && this.body.inAtmosphere(this.root.position));
  }

  // ---------------- per-frame ----------------
  update(dt, input, piloting) {
    const sys = this.systems;
    const game = this.game;
    this.updateVisuals(dt);
    if (this.docked) return;
    // Frame switching by sphere of influence.
    const world = this.worldPosition(tv);
    if (!this.landed && this.lb.phase === 'none') {
      const dom = game.universe.dominantBody(world);
      if (dom !== this.body) this.setFrame(dom);
    }
    const inAtmo = this.inAtmosphere();
    const clear = game.universe.clearOfWells(world);
    const boost = piloting && input.held('boost') && this.lb.phase === 'none';
    // Empty Nitro + a tank in the hold: swap it in automatically on boost.
    if (boost && input.pressed('boost') && sys.nitro.installed && sys.nitro.charge < 2 && this.game.state.combined.has('nitro_cell')) {
      const r = sys.refillNitro(this.game.state.combined);
      if (r.ok) { this.game.hud.toast('hud.nitro_refilled', 'accent'); this.game.audio.play('ui'); }
    }
    const res = sys.update(dt, { throttle: this.throttle, boost, inAtmosphere: inAtmo, clearOfWells: clear });
    this.overdrive = res.overdrive;
    if (res.lightbreakReady && !this.lbReadyAnnounced) {
      this.lbReadyAnnounced = true;
      game.hud.banner('hud.lightbreak_ready', 'accent');
      game.audio?.play('ready');
    }
    if (!res.lightbreakReady) this.lbReadyAnnounced = false;

    if (this.landed) {
      this.speed = 0;
      this.altitude = 0;
      if (piloting && (input.held('jump') || (this.throttle > 0.05 && input.held('forward')))) this.takeoff();
      if (piloting) this.handleThrottle(dt, input);
      return;
    }
    if (this.lb.phase !== 'none') {
      this.updateLightbreak(dt, input, piloting, res);
      return;
    }
    // --- control input ---
    let pitch = 0, yaw = 0, roll = 0, vert = 0;
    if (this.autopilot) {
      const ap = this.updateAutopilot(dt, res);
      pitch = ap.pitch; yaw = ap.yaw; roll = ap.roll; vert = ap.vert;
      if (piloting && (Math.abs(input.move().y) > 0.5 || input.pressed('autopilot'))) this.disengageAutopilot('hud.autopilot_off');
    } else if (piloting) {
      const look = input.lookDelta(dt);
      this.stick.x = THREE.MathUtils.clamp(this.stick.x + look.x * 3.2, -1, 1);
      this.stick.y = THREE.MathUtils.clamp(this.stick.y + look.y * 3.2, -1, 1);
      pitch = -this.stick.y;
      yaw = -this.stick.x;
      const mv = input.move();
      roll = -mv.x;
      if (input.held('rollLeft')) roll += 1;
      if (input.held('rollRight')) roll -= 1;
      if (input.held('jump')) vert += 1;
      if (input.held('crouch')) vert -= 1;
      this.handleThrottle(dt, input);
    }
    this.stick.multiplyScalar(Math.exp(-2.5 * dt));
    const rates = new THREE.Vector3(pitch * 1.25, yaw * 0.95, roll * 2.0);
    if (inAtmo) rates.multiplyScalar(0.9);
    this.angVel.lerp(rates, 1 - Math.exp(-6 * dt));
    tq2.setFromEuler(new THREE.Euler(this.angVel.x * dt, this.angVel.y * dt, this.angVel.z * dt, 'XYZ'));
    this.root.quaternion.multiply(tq2).normalize();
    // --- linear motion: speed-hold toward throttle target ---
    const q = this.root.quaternion;
    const fwd = FWD.clone().applyQuaternion(q);
    const up = UP.clone().applyQuaternion(q);
    const desired = fwd.clone().multiplyScalar(this.throttle * res.maxSpeed).addScaledVector(up, vert * (inAtmo ? 30 : 60));
    if (this.autopilot?.desired) desired.copy(this.autopilot.desired);
    const accel = res.accel * (this.overdrive ? 1 : 1);
    const dv = desired.sub(this.vel);
    const maxDv = accel * dt;
    if (dv.length() > maxDv) dv.setLength(maxDv);
    this.vel.add(dv);
    // Gravity only bites when engines fail (emergency landing).
    this.emergency = false;
    if (this.body) {
      const radial = this.root.position.clone().normalize();
      const g = this.body.gravityAt(this.root.position);
      if (sys.isBroken('engine') || res.noFuel) {
        this.vel.addScaledVector(radial, -g * 0.55 * dt);
        if (inAtmo) this.emergency = true;
      }
    }
    // Black-hole pull and safety.
    this.applyHazards(dt, world);
    this.root.position.addScaledVector(this.vel, dt);
    this.speed = this.vel.length();
    if (this.overdrive) game.state.addXP('piloting', dt * 0.4);
    this.collideTerrain(dt);
    this.collideStation();
    this.collideAsteroids();
    if (this.overdrive) this.shake = Math.max(this.shake, 0.25);
  }

  handleThrottle(dt, input) {
    const mv = input.move();
    if (Math.abs(mv.y) > 0.05) this.throttle = THREE.MathUtils.clamp(this.throttle + mv.y * dt * 0.7, 0, 1);
    if (input.padTriggers) {
      const d = (input.padTriggers[1] || 0) - (input.padTriggers[0] || 0);
      if (Math.abs(d) > 0.05) this.throttle = THREE.MathUtils.clamp(this.throttle + d * dt * 0.8, 0, 1);
    }
    if (input.pressed('cutThrottle')) this.throttle = 0;
  }

  takeoff() {
    if (!this.landed) return;
    const sys = this.systems;
    if (sys.fuel < FLIGHT.takeoffFuel) {
      this.game.hud.toast('hud.no_fuel_takeoff', 'warn');
      return;
    }
    sys.fuel -= FLIGHT.takeoffFuel;
    this.landed = false;
    const up = this.root.position.clone().normalize();
    this.vel.copy(up).multiplyScalar(8);
    this.throttle = Math.max(this.throttle, 0.15);
    this.game.audio?.play('takeoff');
    this.game.events.emit('ship:takeoff');
  }

  collideTerrain(dt) {
    if (!this.body) { this.altitude = Infinity; return; }
    const p = this.root.position;
    const r = p.length();
    const dir = tv2.copy(p).divideScalar(r);
    const ground = this.body.groundRadius(dir);
    const surf = this.body.def.ocean ? Math.max(ground, this.body.radius) : ground;
    const clearance = r - surf;
    this.altitude = clearance - GEAR_HEIGHT;
    if (clearance >= GEAR_HEIGHT) return;
    const shipUp = UP.clone().applyQuaternion(this.root.quaternion);
    const upright = shipUp.dot(dir);
    const vRad = this.vel.dot(dir);
    const overWater = this.body.def.ocean && ground < this.body.radius;
    if (!overWater && this.speed < 28 && upright > 0.75 && vRad > -14) {
      this.land(dir);
      return;
    }
    // Crash: damage and bounce, never an instant loss.
    const impact = Math.max(0, -vRad) + this.speed * 0.25;
    if (impact > 6) {
      const broken = this.systems.applyDamage(impact * 0.9);
      this.game.onShipDamaged(broken, impact);
    }
    p.copy(dir).multiplyScalar(surf + GEAR_HEIGHT + 0.3);
    if (vRad < 0) this.vel.addScaledVector(dir, -vRad * 1.4);
    this.vel.multiplyScalar(0.5);
    this.shake = 1;
  }

  land(dir) {
    const heading = FWD.clone().applyQuaternion(this.root.quaternion);
    this.root.position.copy(dir).multiplyScalar(this.body.groundRadius(dir) + GEAR_HEIGHT);
    this.alignUp(dir, heading, 1);
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.landed = true;
    this.throttle = 0;
    this.autopilot = null;
    this.game.audio?.play('land_ship');
    this.game.events.emit('ship:landed', { body: this.body });
  }

  collideStation() {
    const st = this.body?.station;
    if (!st) return;
    const local = st.toStation(this.root.position);
    if (local.length() > 600) return;
    if (st.collides(local, 9)) {
      const away = local.clone().normalize();
      const worldAway = away.applyQuaternion(st.group.quaternion);
      this.root.position.addScaledVector(worldAway, 4);
      this.vel.reflect(worldAway).multiplyScalar(0.3);
      const broken = this.systems.applyDamage(Math.min(30, this.speed * 0.3));
      this.game.onShipDamaged(broken, this.speed * 0.3);
    }
  }

  collideAsteroids() {
    const hit = this.game.asteroids?.collide(this.worldPosition(new THREE.Vector3()), 11);
    if (!hit) return;
    const parentQ = this.root.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const n = hit.normal.clone().applyQuaternion(parentQ);
    this.root.position.addScaledVector(n, hit.depth + 0.5);
    const vn = this.vel.dot(n);
    if (vn < 0) {
      this.vel.addScaledVector(n, -vn * 1.5).multiplyScalar(0.6);
      const impact = -vn;
      if (impact > 15) {
        const broken = this.systems.applyDamage(Math.min(60, impact * 0.25));
        this.game.onShipDamaged(broken, impact * 0.25);
      }
      this.shake = 1;
    }
  }

  dockAvailable() {
    const st = this.body?.station;
    if (!st || this.landed || this.docked) return null;
    const local = st.toStation(this.root.position);
    const inMouth = local.distanceTo(st.dockPoint) < st.dockRadius || (Math.abs(local.x) < 42 && local.y < -6 && local.y > -54 && local.z < -6 && local.z > -118);
    return inMouth && this.speed < 70 ? st : null;
  }

  dock(station) {
    this.docked = station;
    this.dockAnim = { t: 0, from: this.root.position.clone(), fromQ: this.root.quaternion.clone() };
    this.vel.set(0, 0, 0);
    this.throttle = 0;
    this.autopilot = null;
  }

  undock() {
    const st = this.docked;
    if (!st) return;
    const out = st.group.localToWorld(new THREE.Vector3(0, -30, -170));
    const local = this.body.spin.worldToLocal(out);
    this.root.position.copy(local);
    // face out of the hangar mouth (station -Z)
    this.root.quaternion.copy(st.group.quaternion);
    this.vel.copy(FWD).applyQuaternion(st.group.quaternion).multiplyScalar(45);
    this.docked = null;
    this.throttle = 0.1;
    this.game.events.emit('ship:undocked');
  }

  updateDockAnim(dt) {
    const st = this.docked;
    if (!st || !this.dockAnim || this.dockAnim.t >= 1) return;
    const a = this.dockAnim;
    a.t = Math.min(1, a.t + dt / 3);
    const bay = this.body.spin.worldToLocal(st.bayWorld());
    const k = a.t * a.t * (3 - 2 * a.t);
    this.root.position.lerpVectors(a.from, bay, k);
    this.root.quaternion.slerpQuaternions(a.fromQ, st.group.quaternion, k);
  }

  // ---------------- Lightbreak ----------------
  engageLightbreak(target) {
    const interstellar = !!target?.systemId;
    const r = this.systems.engageLightbreak(interstellar, target?.distance);
    if (!r.ok) return r;
    this.lb = { phase: 'spool', t: 0, target, interstellar, swapped: false };
    this.autopilot = null;
    this.game.audio?.play('lightbreak');
    this.game.state.addXP('piloting', 25);
    if (interstellar && target.direction) this.pointAtWorld(target.direction, 1);
    return { ok: true };
  }

  pointAtWorld(worldDir, t = 1) {
    const parentQ = this.root.parent.getWorldQuaternion(new THREE.Quaternion());
    const localDir = worldDir.clone().applyQuaternion(parentQ.invert()).normalize();
    const up = UP.clone().applyQuaternion(this.root.quaternion);
    const right = new THREE.Vector3().crossVectors(localDir, up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const nup = new THREE.Vector3().crossVectors(right, localDir).normalize();
    tq.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, nup, localDir.clone().negate()));
    this.root.quaternion.slerp(tq, t);
  }

  updateLightbreak(dt, input, piloting, res) {
    const lb = this.lb;
    lb.t += dt;
    const fwd = FWD.clone().applyQuaternion(this.root.quaternion);
    const game = this.game;
    if (lb.phase === 'spool') {
      this.vel.lerp(fwd.clone().multiplyScalar(FLIGHT.spaceMaxSpeed * 3), 1 - Math.exp(-2 * dt));
      if (lb.t > 1.3) { lb.phase = lb.interstellar ? 'tunnel' : 'cruise'; lb.t = 0; game.audio?.play('whoosh'); }
    } else if (lb.phase === 'tunnel') {
      // Interstellar: real acceleration, then the system swaps under cover of the
      // tunnel. After the swap the ship holds position at the arrival point
      // while the tunnel plays out (the jump itself is between systems).
      if (!lb.swapped) this.vel.copy(fwd).multiplyScalar(FLIGHT.lightbreakSpeed * Math.min(1, lb.t));
      else this.vel.copy(fwd).multiplyScalar(50);
      if (!lb.swapped && lb.t > 1.2) {
        lb.swapped = true;
        game.arriveInSystem(lb.target.systemId, lb.target.via);
        return;
      }
      if (lb.t > 5.2) { lb.phase = 'exit'; lb.t = 0; game.audio?.play('exit'); }
    } else if (lb.phase === 'cruise') {
      this.vel.lerp(fwd.clone().multiplyScalar(FLIGHT.lightbreakSpeed), 1 - Math.exp(-1.5 * dt));
      // Gentle steering at extreme speed.
      if (piloting) {
        const look = input.lookDelta(dt);
        this.root.quaternion.multiply(tq2.setFromEuler(new THREE.Euler(-look.y * 0.3, -look.x * 0.3, 0)));
      }
      const world = this.worldPosition(tv);
      const ahead = game.universe.nearestBody(world.clone().addScaledVector(this.forwardWorld(), this.vel.length() * 1.5));
      const near = game.universe.nearestBody(world);
      const tooClose = near.body && near.distance < near.body.radius * 25;
      const stop = (piloting && (input.pressed('lightbreak') || input.pressed('cutThrottle'))) || (lb.t > 1 && (tooClose || (ahead.body && ahead.distance < ahead.body.radius * 25)));
      if (stop || lb.t > 120) { lb.phase = 'exit'; lb.t = 0; game.audio?.play('exit'); }
    } else if (lb.phase === 'exit') {
      const k = 1 - Math.exp(-3.5 * dt);
      this.vel.lerp(fwd.clone().multiplyScalar(FLIGHT.spaceMaxSpeed * 0.8), k);
      if (lb.t > 1.6) {
        lb.phase = 'none';
        this.systems.endLightbreak();
        this.throttle = 0.8;
        game.onLightbreakExit(lb);
      }
    }
    this.root.position.addScaledVector(this.vel, dt);
    this.speed = lb.phase === 'tunnel' ? FLIGHT.lightbreakSpeed : this.vel.length();
    this.shake = Math.max(this.shake, lb.phase === 'tunnel' ? 0.6 : 0.35);
    this.collideTerrain(dt);
  }

  // ---------------- autopilot ----------------
  engageAutopilot(mode, target) {
    this.autopilot = { mode, target, desired: null };
    this.game.hud.toast(mode === 'land' ? 'hud.autoland' : 'hud.autopilot_on', 'accent');
  }

  disengageAutopilot(msgKey) {
    if (!this.autopilot) return;
    this.autopilot = null;
    if (msgKey) this.game.hud.toast(msgKey, 'warn');
  }

  updateAutopilot(dt, res) {
    const ap = this.autopilot;
    const out = { pitch: 0, yaw: 0, roll: 0, vert: 0 };
    ap.desired = null;
    if (this.systems.modules.hull.hp < 30 || this.hazard) {
      this.disengageAutopilot('hud.autopilot_danger');
      return out;
    }
    if (ap.mode === 'land' && this.body) {
      const dir = this.root.position.clone().normalize();
      this.alignUp(dir, null, 1 - Math.exp(-2.5 * dt));
      const alt = Math.max(0, this.altitude);
      const down = Math.min(60, alt * 0.35 + 3);
      ap.desired = dir.clone().multiplyScalar(-down);
      // Slide sideways off water.
      if (this.body.def.ocean && this.body.groundRadius(dir) < this.body.radius && alt < 80) {
        ap.desired.add(FWD.clone().applyQuaternion(this.root.quaternion).multiplyScalar(40)).addScaledVector(dir, down);
      }
      return out;
    }
    if (ap.mode === 'travel' && ap.target) {
      const world = this.worldPosition(tv);
      const targetWorld = ap.target.world();
      const toT = targetWorld.clone().sub(world);
      const dist = toT.length() - (ap.target.arrive || 1000);
      if (dist <= 0) {
        this.disengageAutopilot(null);
        this.game.hud.toast('hud.autopilot_arrived', 'accent');
        this.throttle = 0.1;
        return out;
      }
      this.pointAtWorld(toT.normalize(), 1 - Math.exp(-1.2 * dt));
      const fwd = FWD.clone().applyQuaternion(this.root.quaternion);
      const speed = Math.min(res.maxSpeed, Math.max(80, dist * 0.45));
      ap.desired = fwd.multiplyScalar(speed);
      this.throttle = Math.min(1, speed / res.maxSpeed);
    }
    return out;
  }

  // ---------------- hazards ----------------
  applyHazards(dt, world) {
    this.hazard = null;
    for (const a of this.game.universe.anomalies) {
      if (a.def.type !== 'black_hole') continue;
      const to = a.group.position.clone().sub(world);
      const d = to.length();
      if (d > a.def.influence) continue;
      this.hazard = 'gravity';
      const pull = 4e9 / (d * d + 1e6);
      const parentQ = this.root.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      this.vel.addScaledVector(to.normalize().applyQuaternion(parentQ), Math.min(pull, 3000) * dt);
      if (d < a.def.radius * 12) this.systems.applyDamage(dt * 2);
      if (d < a.def.radius * 4) {
        // Automatic escape burn: the ship is thrown clear, never destroyed.
        this.vel.copy(to.normalize().applyQuaternion(parentQ)).multiplyScalar(-6000);
        const broken = this.systems.applyDamage(15);
        this.game.onShipDamaged(broken, 15);
        this.game.hud.banner('hud.escape_burn', 'danger');
      }
    }
  }

  // ---------------- visuals ----------------
  updateVisuals(dt) {
    const m = this.model;
    const flying = !this.landed && !this.docked;
    this.gear = THREE.MathUtils.clamp(this.gear + (flying && this.altitude > 40 ? -dt : dt) * 0.8, 0, 1);
    m.gear.scale.y = Math.max(0.05, this.gear);
    m.gear.position.y = (1 - this.gear) * 1.2;
    const rampTarget = this.landed ? RAMP_OPEN : RAMP_CLOSED;
    m.ramp.rotation.x += (rampTarget - m.ramp.rotation.x) * Math.min(1, dt * 2);
    const thrust = this.landed || this.docked ? 0.05 : 0.25 + this.throttle * 0.75 + (this.overdrive ? 1.2 : 0) + (this.lb.phase !== 'none' ? 2 : 0);
    for (const f of m.flames) {
      const b = f.userData.base || 1;
      f.scale.set(b, b, Math.max(0.2, thrust) * b * (0.95 + Math.random() * 0.1));
      f.visible = thrust > 0.06;
      f.material.uniforms.uTime.value += dt;
      f.material.uniforms.uPower.value = Math.min(1.6, 0.35 + thrust * 0.6);
    }
    const fieldTarget = this.lb.phase === 'spool' || this.lb.phase === 'tunnel' || this.lb.phase === 'cruise' ? 1 : this.overdrive ? 0.45 : this.lb.phase === 'exit' ? 0.5 : 0;
    const u = m.fieldMat.uniforms;
    u.uIntensity.value += (fieldTarget - u.uIntensity.value) * Math.min(1, dt * 3);
    u.uTime.value += dt;
    m.field.visible = u.uIntensity.value > 0.02;
    // Nitro panel door animation
    const n = m.nitro;
    n.openT += ((n.open ? 1 : 0) - n.openT) * Math.min(1, dt * 4);
    n.doorPivot.rotation.y = -n.openT * 1.9;
    n.canister.visible = this.systems.nitro.installed;
    this.shake = Math.max(0, this.shake - dt * 2);
    if (this.docked) this.updateDockAnim(dt);
    this.updateFx(dt, thrust, flying);
  }

  // Navigation lights, strobe, engine glow on the ground, landing dust and
  // wingtip vapour trails.
  updateFx(dt, thrust, flying) {
    const m = this.model;
    const t = (this.fxT = (this.fxT || 0) + dt);
    const blink = (t % 1.4) < 0.12;
    for (const l of m.navLights || []) l.scale.setScalar(blink ? 1.8 : 1);
    if (m.strobe) m.strobe.visible = flying && (t % 1.1) < 0.06;
    if (m.engineLight) m.engineLight.intensity = flying ? Math.min(40, thrust * 18) * (0.9 + Math.random() * 0.2) : 0;
    const frame = this.root.parent;
    if (!frame) return;
    if (!this.fx) {
      this.fx = { dust: new Particles(260), trail: new Particles(200, { additive: true }), acc: 0 };
    }
    const fx = this.fx;
    if (fx.dust.points.parent !== frame) frame.add(fx.dust.points, fx.trail.points);
    const up = this.body ? this.root.position.clone().normalize() : new THREE.Vector3(0, 1, 0);
    fx.acc += dt;
    const step = 1 / 40;
    while (fx.acc > step) {
      fx.acc -= step;
      // Dust blasted off the ground near take-off and landing.
      if (this.body && flying && this.altitude < 35 && thrust > 0.1) {
        const k = 1 - this.altitude / 35;
        for (let i = 0; i < 3; i++) {
          if (Math.random() > k) continue;
          const a = Math.random() * Math.PI * 2;
          const side = new THREE.Vector3(Math.cos(a), Math.sin(a * 1.3), Math.sin(a)).cross(up).normalize();
          const ground = this.root.position.clone().addScaledVector(up, -(this.altitude + GEAR_HEIGHT)).addScaledVector(side, 4 + Math.random() * 6);
          fx.dust.emit(ground, side.multiplyScalar(10 + Math.random() * 12).addScaledVector(up, 1 + Math.random() * 2),
            { color: [0.7, 0.64, 0.55], size: 2 + Math.random() * 2, life: 2 + Math.random() * 1.5, grow: 3, drag: 1.4 });
        }
      }
      // Wingtip vapour in thick air at speed.
      const air = this.body && this.body.airDensity ? this.body.airDensity(this.root.position) : 0;
      if (air > 0.3 && this.speed > 120) {
        for (const x of [-16.6, 16.6]) {
          const p = this.root.localToWorld(new THREE.Vector3(x, 0.2, 12));
          frame.worldToLocal(p);
          fx.trail.emit(p, new THREE.Vector3(), { color: [0.55, 0.6, 0.65], size: 0.6, life: 0.6, grow: 2 });
        }
      }
    }
    fx.dust.update(dt, up.clone().multiplyScalar(0.4));
    fx.trail.update(dt, new THREE.Vector3());
  }

  toSave() {
    const frameId = this.body ? this.body.id : null;
    return {
      frame: frameId,
      pos: this.root.position.toArray(),
      quat: this.root.quaternion.toArray(),
      vel: this.vel.toArray(),
      landed: this.landed,
      docked: !!this.docked,
      throttle: this.throttle,
    };
  }
}
