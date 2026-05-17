import * as THREE from 'three';
import { CAR, WORLD } from './config.js';

// Placeholder low-poly car built from boxes/wedges. -Z = forward.
export function buildPlaceholderCar({ bodyColor = 0x2a4cff, accent = 0x111114 } = {}) {
  const car = new THREE.Group();
  const matBody = new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.6, roughness: 0.35 });
  const matAccent = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.2, roughness: 0.7 });
  const matGlass = new THREE.MeshStandardMaterial({ color: 0x0a0e16, metalness: 0.7, roughness: 0.18 });
  const matLight = new THREE.MeshBasicMaterial({ color: 0xfff5cc });
  const matBrake = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

  // Main body (low + wide)
  const body = new THREE.Mesh(new THREE.BoxGeometry(CAR.width, 0.75, CAR.length * 0.85), matBody);
  body.position.set(0, 0.55, 0);
  car.add(body);

  // Hood (front, sloped — use a slight scale to mimic)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(CAR.width * 0.9, 0.4, CAR.length * 0.35), matBody);
  hood.position.set(0, 0.7, -CAR.length * 0.35);
  car.add(hood);

  // Roof / greenhouse
  const roof = new THREE.Mesh(new THREE.BoxGeometry(CAR.width * 0.85, 0.55, CAR.length * 0.45), matGlass);
  roof.position.set(0, 1.05, CAR.length * 0.02);
  car.add(roof);

  // (Wheels are attached separately via Car.attachWheels so they can spin and
  // steer; doing it here would double-up with the GLB version.)

  // Headlights
  for (const x of [-CAR.width * 0.32, CAR.width * 0.32]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.1), matLight);
    l.position.set(x, 0.7, -CAR.length * 0.5);
    car.add(l);
  }
  // Brake lights
  for (const x of [-CAR.width * 0.32, CAR.width * 0.32]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.1), matBrake);
    l.position.set(x, 0.78, CAR.length * 0.5);
    car.add(l);
  }

  car.castShadow = true;
  car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
  return car;
}

const WHEEL_RADIUS = 0.4;
const WHEEL_THICKNESS = 0.32;
const WHEEL_LATERAL = 0.85;     // fraction of half-width — keeps wheels just inside body
const WHEEL_LONGITUDINAL = 0.32; // fraction of length from center for each axle

// Arcade car physics. State: position, velocity (xz), heading (rad), smoothed steer.
export class Car {
  constructor(mesh) {
    this.mesh = mesh;
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.heading = 0;
    this.steer = 0;
    this.handbraking = false;
    this.boostActive = false;
    this.distanceTravelled = 0;
    this.crashed = 0; // visual hit-flash timer
    this.wheels = [];
    this.wheelAngle = 0;
  }

  // Build 4 wheel rigs. Each rig is two nested Groups: outer "steer"
  // pivot (rotation.y) + inner "spin" pivot (rotation.x). Avoids
  // Euler-order wobble.
  //
  // wheelMeshes:
  //   null / undefined  → procedural alloy fallback at the default hubs
  //   array of 4 meshes → use each at its given hub (extracted from the GLB)
  //   object { wheels:[4 meshes], wheelHubs:[4 {x,y,z,isFront}] }
  //                     → same but with custom hub positions per wheel
  attachWheels(arg = null) {
    for (const w of this.wheels) this.mesh.remove(w.steer);
    this.wheels = [];

    let meshes = null;
    let hubs = null;
    if (arg && arg.wheels && arg.wheelHubs) {
      meshes = arg.wheels;
      hubs = arg.wheelHubs;
    } else if (Array.isArray(arg)) {
      meshes = arg;
    }

    const defaultHubs = [
      { x: -CAR.width / 2 * WHEEL_LATERAL, y: WHEEL_RADIUS, z: -CAR.length * WHEEL_LONGITUDINAL, isFront: true  },
      { x:  CAR.width / 2 * WHEEL_LATERAL, y: WHEEL_RADIUS, z: -CAR.length * WHEEL_LONGITUDINAL, isFront: true  },
      { x: -CAR.width / 2 * WHEEL_LATERAL, y: WHEEL_RADIUS, z:  CAR.length * WHEEL_LONGITUDINAL, isFront: false },
      { x:  CAR.width / 2 * WHEEL_LATERAL, y: WHEEL_RADIUS, z:  CAR.length * WHEEL_LONGITUDINAL, isFront: false },
    ];
    const effectiveHubs = hubs || defaultHubs;

    for (let i = 0; i < 4; i++) {
      const h = effectiveHubs[i];
      const steer = new THREE.Group();
      steer.position.set(h.x, h.y, h.z);
      const spin = new THREE.Group();
      steer.add(spin);

      let wheelMesh;
      if (meshes && meshes[i]) {
        wheelMesh = meshes[i];
      } else {
        wheelMesh = this._buildAlloyWheel();
        if (h.x < 0) wheelMesh.scale.x = -wheelMesh.scale.x;
      }
      spin.add(wheelMesh);

      this.mesh.add(steer);
      this.wheels.push({ steer, spin, isFront: h.isFront });
    }
  }

  // Multi-spoke alloy wheel with tire, brake disc, hub. Built so the spin
  // axis is X (matches the spin pivot's rotation.x). Detail is enough that
  // motion reads at speed.
  _buildAlloyWheel() {
    const g = new THREE.Group();
    const R = WHEEL_RADIUS;
    const T = WHEEL_THICKNESS;

    // Outer tire (matte black torus)
    const tire = new THREE.Mesh(
      new THREE.TorusGeometry(R * 0.92, R * 0.22, 10, 28),
      new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.95, metalness: 0.0 }),
    );
    tire.rotation.y = Math.PI / 2; // torus axis along X
    g.add(tire);

    // Brake disc (sits behind the rim, dark steel)
    const brake = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.7, R * 0.7, T * 0.18, 28),
      new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.45, metalness: 0.75 }),
    );
    brake.rotation.z = Math.PI / 2;
    brake.position.x = -T * 0.12;
    g.add(brake);

    // Rim base disc (polished aluminum)
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.78, R * 0.78, T * 0.55, 28),
      new THREE.MeshStandardMaterial({ color: 0x8d92a0, roughness: 0.25, metalness: 0.85 }),
    );
    rim.rotation.z = Math.PI / 2;
    g.add(rim);

    // 5 spokes (long thin boxes radiating outward in the YZ plane)
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.2, metalness: 0.9 });
    const spokeGeo = new THREE.BoxGeometry(T * 0.7, R * 0.7, T * 0.5);
    spokeGeo.translate(0, R * 0.35, 0);
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(spokeGeo, spokeMat);
      spoke.position.x = T * 0.12; // sit just outside the rim base
      spoke.rotation.x = angle;
      g.add(spoke);
    }

    // Central hub cap
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.22, R * 0.22, T * 0.75, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.3, metalness: 0.85 }),
    );
    hub.rotation.z = Math.PI / 2;
    hub.position.x = T * 0.18;
    g.add(hub);

    return g;
  }

  reset() {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.heading = 0;
    this.steer = 0;
    this.distanceTravelled = 0;
    this.crashed = 0;
  }

  // Three.js convention: Y rotation by `h` applied to the local -Z gives
  // (-sin(h), 0, -cos(h)). Using +sin previously made the physics-forward
  // disagree with the visible mesh rotation, so steering went the wrong way.
  forward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading));
  }
  right(out = new THREE.Vector3()) {
    // right = forward × up
    return out.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
  }
  speed() { return this.velocity.length(); }
  forwardSpeed() {
    return this.velocity.x * -Math.sin(this.heading) + this.velocity.z * -Math.cos(this.heading);
  }

  update(dt, controls) {
    // Smooth steer toward input
    const targetSteer = controls.steer * CAR.maxSteer;
    this.steer += (targetSteer - this.steer) * Math.min(1, dt * CAR.steerLerp);
    this.handbraking = !!controls.handbrake;
    this.boostActive = !!controls.boost && controls.accel > 0;

    const fwd = this.forward();
    const right = this.right();

    // Decompose current velocity into longitudinal + lateral
    let vLong = this.velocity.dot(fwd);
    let vLat  = this.velocity.dot(right);

    // Throttle: thrust-curve falls off with speed (mimics power curve / limiter)
    if (controls.accel > 0) {
      const speedRatio = Math.max(0, vLong) / CAR.topSpeed;
      const power = CAR.maxAccel * (1 - speedRatio) * controls.accel
        * (this.boostActive ? CAR.boostMul : 1);
      vLong += Math.max(0, power) * dt;
    }

    // Brake / reverse
    if (controls.brake > 0) {
      if (vLong > 0.3) {
        vLong -= CAR.brakeAccel * controls.brake * dt;
      } else {
        vLong -= CAR.reverseAccel * controls.brake * dt;
      }
    }

    // Drag (quadratic) + rolling resistance (when no input)
    const sp = Math.max(1e-3, this.speed());
    const dragForce = (CAR.rollingResist + CAR.dragCoef * sp * sp);
    const dragOnLong = Math.sign(vLong) * dragForce * dt;
    if (Math.abs(dragOnLong) > Math.abs(vLong)) vLong = 0;
    else vLong -= dragOnLong;

    // Lateral grip
    const gripMul = this.handbraking ? CAR.handbrakeGripMul : 1;
    vLat *= Math.exp(-CAR.lateralGrip * gripMul * dt);

    // Steering: yaw authority falls off with speed (so a flick at 30 km/h
    // is a wide arc at 300 km/h). Hyperbolic curve, sign-sensitive so
    // reversing steers the way you'd expect.
    const v = Math.abs(vLong);
    const yawAuthority = CAR.yawAtRest / (CAR.yawHalfSpeed + v);
    this.heading += this.steer * yawAuthority * Math.sign(vLong) * dt;

    // Recompose velocity in updated heading frame
    const newFwd = this.forward();
    const newRight = this.right();
    this.velocity.copy(newFwd).multiplyScalar(vLong)
      .add(newRight.multiplyScalar(vLat));

    // Integrate
    this.position.addScaledVector(this.velocity, dt);
    this.distanceTravelled += vLong * dt;

    // Apply to mesh
    this.mesh.position.copy(this.position);
    this.mesh.rotation.set(0, this.heading, 0);

    // Spin wheels (inner pivot, rotation.x) at vLong / radius. Negative so
    // a forward-moving car (+vLong) makes the wheel's top move forward (-Z),
    // i.e. roll the way you'd expect. Steer front wheels via outer pivot.
    if (this.wheels.length > 0) {
      this.wheelAngle -= (vLong / WHEEL_RADIUS) * dt;
      for (const w of this.wheels) {
        w.spin.rotation.x = this.wheelAngle;
        w.steer.rotation.y = w.isFront ? this.steer : 0;
      }
    }

    if (this.crashed > 0) this.crashed -= dt;
  }

  // Impulse-based collision response.
  //   otherPos     – the colliding actor's world position
  //   otherVel     – its velocity (defaults to 0 if static-ish)
  //   otherMassRatio – 0..1 share of the impulse the other side absorbs
  //                    (lower number = the other car moves less)
  collideWith(otherPos, otherVel = null, otherMassRatio = 0.4) {
    const n = new THREE.Vector3().subVectors(this.position, otherPos);
    n.y = 0;
    if (n.lengthSq() < 1e-4) n.set((Math.random() - 0.5), 0, 1);
    n.normalize();

    // Push the car out along the normal so we're not penetrating
    const minSep = (CAR.length + CAR.width) * 0.45;
    const sep = new THREE.Vector3().subVectors(this.position, otherPos);
    const dist = Math.hypot(sep.x, sep.z) || 1;
    const overlap = minSep - dist;
    if (overlap > 0) {
      this.position.x += n.x * overlap * (1 - otherMassRatio);
      this.position.z += n.z * overlap * (1 - otherMassRatio);
    }

    // Relative velocity along the normal
    const rel = otherVel
      ? new THREE.Vector3().subVectors(this.velocity, otherVel)
      : this.velocity.clone();
    const velAlongNormal = rel.x * n.x + rel.z * n.z;
    if (velAlongNormal < 0) {
      const restitution = 0.25; // some energy lost on impact
      const j = -(1 + restitution) * velAlongNormal;
      // Player takes the larger share of the impulse
      this.velocity.x += n.x * j * (1 - otherMassRatio);
      this.velocity.z += n.z * j * (1 - otherMassRatio);
    }
    // Always bleed some forward speed on contact (rubber friction)
    this.velocity.multiplyScalar(0.78);
    this.crashed = 0.35;
  }
}
