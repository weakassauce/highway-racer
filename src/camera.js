import * as THREE from 'three';
import { CAMERA, CAR } from './config.js';

// Chase camera that lerps behind the car, with speed-based FOV widening.
export class ChaseCamera {
  constructor(perspective) {
    this.cam = perspective;
    this.cam.fov = CAMERA.fovBase;
    this.cam.updateProjectionMatrix();
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this._tmpFwd = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this.view = 'chase';
  }

  toggleView() { this.view = this.view === 'chase' ? 'hood' : 'chase'; }

  update(dt, car, controls = { lookYaw: 0, lookPitch: 0 }) {
    const fwd = car.forward(this._tmpFwd);
    const right = car.right(this._tmpRight);

    if (this.view === 'chase') {
      // Base orbit angle = behind car (car.heading + π) + look-yaw offset.
      const orbitYaw = car.heading + Math.PI + controls.lookYaw;
      const cosY = Math.cos(orbitYaw), sinY = Math.sin(orbitYaw);
      const cosP = Math.cos(controls.lookPitch), sinP = Math.sin(controls.lookPitch);
      // Spherical-ish offset around the car
      const horizDist = CAMERA.chaseBack * Math.max(0.4, cosP);
      const desired = new THREE.Vector3(
        car.position.x + sinY * horizDist,
        car.position.y + CAMERA.chaseUp + sinP * CAMERA.chaseBack * 0.8,
        car.position.z + cosY * horizDist,
      );
      // Small lateral slide based on lateral velocity for that drift feel
      const vLat = car.velocity.dot(right);
      desired.addScaledVector(right, vLat * 0.06);
      this.pos.lerp(desired, 1 - Math.exp(-dt * CAMERA.lerp));
      this.cam.position.copy(this.pos);
      // Look at a point slightly ahead of the car (or at the car when freely
      // looking around so the focal point doesn't fly off-screen)
      const lookActive = Math.abs(controls.lookYaw) > 0.05 || Math.abs(controls.lookPitch) > 0.05;
      this.target.copy(car.position);
      this.target.y += 1.0;
      if (!lookActive) this.target.addScaledVector(fwd, CAMERA.chaseLookAhead);
    } else {
      // Hood / first-person-ish
      this.pos.copy(car.position).addScaledVector(fwd, 0.5);
      this.pos.y += 1.1;
      this.cam.position.copy(this.pos);
      this.target.copy(car.position).addScaledVector(fwd, 60);
      this.target.y += 1.0;
    }

    this.cam.lookAt(this.target);

    // FOV widens with speed (sensation of velocity)
    const speedRatio = Math.min(1, car.speed() / CAR.topSpeed);
    const fov = CAMERA.fovBase + (CAMERA.fovBoost - CAMERA.fovBase) * (speedRatio * speedRatio);
    if (Math.abs(this.cam.fov - fov) > 0.05) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
