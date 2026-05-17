import * as THREE from 'three';
import { TRAFFIC, WORLD, CAR } from './config.js';
import { buildPlaceholderCar } from './car.js';

// AI traffic: moves down -Z at a fixed speed, occasionally changes lanes.
// When a car drops too far behind the player, it gets recycled ahead.

const TRAFFIC_COLORS = [0xc04020, 0x202028, 0x508a90, 0xc09040, 0x808078, 0xe0e0e0, 0x303040];

function lanePositionX(lane) {
  const halfRoad = (WORLD.laneWidth * WORLD.numLanes) / 2;
  return -halfRoad + WORLD.laneWidth / 2 + lane * WORLD.laneWidth;
}

class TrafficCar {
  constructor(scene, template) {
    const color = TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
    this.mesh = template ? template.clone(true) : buildPlaceholderCar({ bodyColor: color });
    if (template) {
      // Tint a clone by adjusting first material's color (approximate)
      this.mesh.traverse((o) => {
        if (o.isMesh && o.material && o.material.color && o.material.metalness !== undefined) {
          if (o.material.metalness > 0.4) {
            o.material = o.material.clone();
            o.material.color = new THREE.Color(color);
          }
        }
      });
    }
    scene.add(this.mesh);
    this.lane = 0;
    this.targetLane = 0;
    this.position = new THREE.Vector3();
    this.speed = 30;
  }

  spawnAhead(playerZ) {
    this.lane = Math.floor(Math.random() * WORLD.numLanes);
    this.targetLane = this.lane;
    const distance = 120 + Math.random() * (TRAFFIC.spawnDistAhead - 120);
    this.position.set(lanePositionX(this.lane), 0, playerZ - distance);
    this.speed = TRAFFIC.speedMin + Math.random() * (TRAFFIC.speedMax - TRAFFIC.speedMin);
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = 0;
  }

  update(dt, playerZ) {
    // Maybe initiate a lane change
    if (this.lane === this.targetLane && Math.random() < TRAFFIC.laneChangeChance) {
      const delta = Math.random() < 0.5 ? -1 : 1;
      const newLane = this.lane + delta;
      if (newLane >= 0 && newLane < WORLD.numLanes) this.targetLane = newLane;
    }

    // Move along -Z at this.speed
    this.position.z -= this.speed * dt;
    // Slide laterally toward target lane
    const targetX = lanePositionX(this.targetLane);
    const dx = targetX - this.position.x;
    const slide = Math.sign(dx) * Math.min(Math.abs(dx), 6 * dt);
    this.position.x += slide;
    if (Math.abs(dx) < 0.05) this.lane = this.targetLane;

    this.mesh.position.copy(this.position);
    // Slight tilt while lane changing for visual flair
    this.mesh.rotation.y = -slide * 0.6;

    // Recycle if too far behind
    if (this.position.z > playerZ + TRAFFIC.recycleDistBehind) {
      this.spawnAhead(playerZ);
    }
  }
}

export class TrafficManager {
  constructor(scene) {
    this.scene = scene;
    this.cars = [];
    for (let i = 0; i < TRAFFIC.count; i++) {
      const c = new TrafficCar(scene);
      this.cars.push(c);
    }
  }

  initialSpawn(playerZ) {
    for (const c of this.cars) c.spawnAhead(playerZ);
  }

  // Test collision against player; returns true on hit
  update(dt, player) {
    let hit = null;
    for (const c of this.cars) {
      c.update(dt, player.position.z);
      // Simple AABB-ish check using oriented bbox approximation (cars are small)
      const dz = c.position.z - player.position.z;
      const dx = c.position.x - player.position.x;
      if (Math.abs(dz) < CAR.length && Math.abs(dx) < CAR.width) {
        hit = c;
      }
    }
    return hit;
  }
}
