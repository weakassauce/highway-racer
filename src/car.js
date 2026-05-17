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

  // Wheels (4 black cylinders rotated to roll along Z)
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.32, 18);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.7 });
  for (const [x, z] of [
    [-CAR.width / 2,  CAR.length * 0.32],
    [ CAR.width / 2,  CAR.length * 0.32],
    [-CAR.width / 2, -CAR.length * 0.32],
    [ CAR.width / 2, -CAR.length * 0.32],
  ]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.42, z);
    car.add(w);
  }

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
  }

  reset() {
    this.position.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
    this.heading = 0;
    this.steer = 0;
    this.distanceTravelled = 0;
    this.crashed = 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.heading), 0, -Math.cos(this.heading));
  }
  right(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.heading), 0, Math.sin(this.heading));
  }
  speed() { return this.velocity.length(); }
  forwardSpeed() {
    return this.velocity.x * Math.sin(this.heading) + this.velocity.z * -Math.cos(this.heading);
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

    // Steering: heading change scales with longitudinal speed (sign-sensitive
    // so reverse steers the way you'd expect)
    const steerEffective = this.steer
      * Math.max(0.2, 1 - Math.abs(vLong) * CAR.steerSpeedAttenuation);
    this.heading += steerEffective * vLong * dt * 0.18;

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

    if (this.crashed > 0) this.crashed -= dt;
  }

  // Inelastic collision with another car: hard speed loss + small bounce.
  collideWith(otherPos) {
    const dir = new THREE.Vector3().subVectors(this.position, otherPos);
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set((Math.random() - 0.5), 0, 1);
    dir.normalize();
    // Cut forward speed, push outward
    this.velocity.multiplyScalar(0.25);
    this.velocity.addScaledVector(dir, 8);
    this.crashed = 0.35;
  }
}
