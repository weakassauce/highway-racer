import * as THREE from 'three';
import { TRAFFIC, WORLD, CAR, centerlineX } from './config.js';
import { buildPlaceholderCar } from './car.js';

// AI traffic with two-direction support. Each car has a `direction`:
//   +1 = same as player (drives -Z)
//   -1 = oncoming (drives +Z)
// Lanes are addressed inside one carriageway, then mirrored across the median.
// The visible mesh sits inside a wrapper Group so we can rotate it 180° for
// oncoming traffic without losing the GLB's baseline Y=π normalize.

const TRAFFIC_COLORS = [0xc04020, 0x202028, 0x508a90, 0xc09040, 0x808078, 0xe0e0e0, 0x303040, 0x4a6080];

function laneX(lane, direction) {
  // Lanes 0..lanesPerSide-1 inside a carriageway, ordered from outer to inner.
  // direction +1 → right carriageway (positive X relative to centerline)
  // direction -1 → left carriageway (negative X relative to centerline)
  const inner = WORLD.medianWidth / 2 + WORLD.laneWidth / 2; // inside-lane center
  return direction * (inner + lane * WORLD.laneWidth);
}

class TrafficCar {
  constructor(scene, template) {
    this.scene = scene;
    this.mesh = new THREE.Group(); // wrapper we can freely rotate

    // The visual mesh goes inside the wrapper. Baseline rotation (e.g. the
    // Y=π that normalizeCarModel applies to TRELLIS GLBs) stays on the
    // inner object; we control direction via the wrapper.
    const color = TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
    const inner = template ? template.clone(true) : buildPlaceholderCar({ bodyColor: color });
    if (template) {
      inner.traverse((o) => {
        if (o.isMesh && o.material && o.material.color && o.material.metalness !== undefined) {
          if (o.material.metalness > 0.4) {
            o.material = o.material.clone();
            o.material.color = new THREE.Color(color);
          }
        }
      });
    }
    this.mesh.add(inner);

    scene.add(this.mesh);
    this.lane = 0;
    this.targetLane = 0;
    this.direction = 1;
    this.position = new THREE.Vector3();
    this.speed = 30;
  }

  spawnAhead(playerZ) {
    this.direction = Math.random() < TRAFFIC.oncomingFraction ? -1 : 1;
    this.lane = Math.floor(Math.random() * WORLD.lanesPerSide);
    this.targetLane = this.lane;
    const distance = 120 + Math.random() * (TRAFFIC.spawnDistAhead - 120);
    // Spawn ahead of the player (player is going -Z, so ahead = -Z)
    const z = playerZ - distance;
    const x = centerlineX(z) + laneX(this.lane, this.direction);
    this.position.set(x, 0, z);
    this.speed = TRAFFIC.speedMin + Math.random() * (TRAFFIC.speedMax - TRAFFIC.speedMin);
    this.mesh.position.copy(this.position);
    // Set wrapper rotation: +1 (player-direction) = 0, -1 (oncoming) = π
    this.mesh.rotation.y = this.direction === 1 ? 0 : Math.PI;
  }

  update(dt, playerZ) {
    // Occasional lane change inside this carriageway
    if (this.lane === this.targetLane && Math.random() < TRAFFIC.laneChangeChance) {
      const delta = Math.random() < 0.5 ? -1 : 1;
      const newLane = this.lane + delta;
      if (newLane >= 0 && newLane < WORLD.lanesPerSide) this.targetLane = newLane;
    }

    // Move along Z by direction * speed. direction +1 ⇒ -Z (with player).
    this.position.z -= this.direction * this.speed * dt;

    // Hug the curving centerline at the lane offset
    const targetX = centerlineX(this.position.z) + laneX(this.targetLane, this.direction);
    const dx = targetX - this.position.x;
    const slide = Math.sign(dx) * Math.min(Math.abs(dx), 6 * dt);
    this.position.x += slide;
    if (Math.abs(dx) < 0.05) this.lane = this.targetLane;

    this.mesh.position.copy(this.position);
    // Direction baseline + small slide tilt for lane changes
    this.mesh.rotation.y = (this.direction === 1 ? 0 : Math.PI) + (-slide * 0.6);

    // Recycle when behind the player (in the direction of player travel)
    if (this.position.z > playerZ + TRAFFIC.recycleDistBehind) {
      this.spawnAhead(playerZ);
    }
  }
}

export class TrafficManager {
  constructor(scene) {
    this.scene = scene;
    this.cars = [];
    for (let i = 0; i < TRAFFIC.count; i++) this.cars.push(new TrafficCar(scene));
  }

  initialSpawn(playerZ) {
    for (const c of this.cars) c.spawnAhead(playerZ);
  }

  // Returns the first colliding traffic car (if any). Uses an oriented bbox
  // check via projection onto the car's forward and right axes.
  update(dt, player) {
    let hit = null;
    const pFwdX = -Math.sin(player.heading);
    const pFwdZ = -Math.cos(player.heading);
    const pRightX = Math.cos(player.heading);
    const pRightZ = -Math.sin(player.heading);
    const halfLen = CAR.length / 2;
    const halfWid = CAR.width / 2;
    for (const c of this.cars) {
      c.update(dt, player.position.z);
      // Approx OBB intersection: project the relative position into player's
      // local axes; treat traffic car as a sphere of radius ~CAR.width.
      const rx = c.position.x - player.position.x;
      const rz = c.position.z - player.position.z;
      const longi = rx * pFwdX + rz * pFwdZ;
      const lat   = rx * pRightX + rz * pRightZ;
      if (Math.abs(longi) < halfLen + CAR.length / 2 - 0.4 &&
          Math.abs(lat)   < halfWid + CAR.width  / 2 - 0.2) {
        hit = c;
      }
    }
    return hit;
  }
}
