import * as THREE from 'three';
import { TRAFFIC, WORLD, CAR, centerlineX } from './config.js';
import { buildPlaceholderCar } from './car.js';

// Two-direction AI traffic with:
//   * Multiple body templates (sedan/SUV/hatchback) cloned per car
//   * Per-car body-colour tint
//   * Spinning wheel clones (when wheelTemplate is loaded)
//   * Smarter brain: look-ahead braking, target-speed smoothing, lane
//     changes that avoid crashing into neighbours

const TRAFFIC_COLORS = [
  0xc04020, 0x202028, 0x508a90, 0xc09040, 0x808078,
  0xe0e0e0, 0x303040, 0x4a6080, 0x40703a, 0x9c5a2c,
];

const WHEEL_RADIUS = 0.33;
const WHEEL_LATERAL = 0.36;       // fraction of body bbox X
const WHEEL_LONGITUDINAL = 0.30;  // fraction of body bbox Z

function laneX(lane, direction) {
  // direction +1 → player's carriageway (positive X off centerline)
  // direction -1 → oncoming (negative X off centerline)
  const inner = WORLD.medianWidth / 2 + WORLD.laneWidth / 2;
  return direction * (inner + lane * WORLD.laneWidth);
}

class TrafficCar {
  constructor(scene) {
    this.scene = scene;
    this.mesh = new THREE.Group(); // wrapper we can rotate freely
    scene.add(this.mesh);
    this.body = null;
    this.wheels = [];
    this.wheelAngle = 0;
    this.lane = 0;
    this.targetLane = 0;
    this.direction = 1;
    this.position = new THREE.Vector3();

    // Speed brain — each car has a preferred nominal pace + an instantaneous
    // currentSpeed that eases toward targetSpeed.
    this.nominalSpeed = TRAFFIC.speedMin + Math.random() * (TRAFFIC.speedMax - TRAFFIC.speedMin);
    this.currentSpeed = this.nominalSpeed;
    this.targetSpeed = this.nominalSpeed;
    this.color = TRAFFIC_COLORS[Math.floor(Math.random() * TRAFFIC_COLORS.length)];
  }

  // (Re)build the body mesh inside the wrapper. Picks a random template if
  // any are supplied. Also rebuilds wheel rigs from the latest wheel template.
  rebuild(templates, wheelTemplate) {
    while (this.mesh.children.length) this.mesh.remove(this.mesh.children[0]);
    this.wheels = [];

    const realTemplates = (templates || []).filter(Boolean);
    const t = realTemplates.length > 0
      ? realTemplates[Math.floor(Math.random() * realTemplates.length)]
      : null;
    const inner = t ? t.clone(true) : buildPlaceholderCar({ bodyColor: this.color });
    // No tinting — keep the GLB's original materials and colors.
    this.mesh.add(inner);
    this.body = inner;

    // Attach wheels at canonical hubs sized from the actual body bbox
    this._attachWheels(wheelTemplate);
  }

  _attachWheels(wheelTemplate) {
    if (!this.body) return;
    const bbox = new THREE.Box3().setFromObject(this.body);
    const size = bbox.getSize(new THREE.Vector3());
    const fullX = size.x || CAR.width;
    const fullZ = size.z || CAR.length;
    const r = WHEEL_RADIUS;
    const dx = fullX * WHEEL_LATERAL;
    const dz = fullZ * WHEEL_LONGITUDINAL;
    const hubs = [
      { x: -dx, y: r, z: -dz },
      { x:  dx, y: r, z: -dz },
      { x: -dx, y: r, z:  dz },
      { x:  dx, y: r, z:  dz },
    ];
    for (const h of hubs) {
      const spin = new THREE.Group();
      spin.position.set(h.x, h.y, h.z);
      let wheel;
      if (wheelTemplate) {
        wheel = wheelTemplate.clone(true);
        if (h.x < 0) wheel.rotation.y += Math.PI;
      } else {
        const geo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.26, 14);
        const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.85 });
        wheel = new THREE.Mesh(geo, mat);
        wheel.rotation.z = Math.PI / 2;
      }
      spin.add(wheel);
      this.mesh.add(spin);
      this.wheels.push(spin);
    }
  }

  spawnAhead(playerZ) {
    this.direction = Math.random() < TRAFFIC.oncomingFraction ? -1 : 1;
    this.lane = Math.floor(Math.random() * WORLD.lanesPerSide);
    this.targetLane = this.lane;
    const distance = 120 + Math.random() * (TRAFFIC.spawnDistAhead - 120);
    const z = playerZ - distance;
    const x = centerlineX(z) + laneX(this.lane, this.direction);
    this.position.set(x, 0, z);
    this.nominalSpeed = TRAFFIC.speedMin + Math.random() * (TRAFFIC.speedMax - TRAFFIC.speedMin);
    this.currentSpeed = this.nominalSpeed;
    this.targetSpeed = this.nominalSpeed;
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.direction === 1 ? 0 : Math.PI;
  }

  // Look-ahead query: find the nearest other car in front of us in the
  // same lane and direction. Returns { car, gap } or null.
  _scanAhead(allCars, lane, lookAhead) {
    let best = null, bestGap = Infinity;
    for (const o of allCars) {
      if (o === this) continue;
      if (o.direction !== this.direction || o.lane !== lane) continue;
      // "ahead" = in the direction this car is travelling. Player-direction
      // (+1) moves -Z, so a car ahead has smaller z. Oncoming (-1) moves +Z.
      const dz = (o.position.z - this.position.z) * -this.direction;
      if (dz > 0 && dz < bestGap) { bestGap = dz; best = o; }
    }
    if (best && bestGap <= lookAhead) return { car: best, gap: bestGap };
    return null;
  }

  _laneClear(allCars, lane, behindWindow, aheadWindow) {
    for (const o of allCars) {
      if (o === this) continue;
      if (o.direction !== this.direction || (o.lane !== lane && o.targetLane !== lane)) continue;
      const dz = (o.position.z - this.position.z) * -this.direction;
      if (dz > -behindWindow && dz < aheadWindow) return false;
    }
    return true;
  }

  update(dt, playerZ, allCars) {
    // ---- Brain ----
    // 1) Look-ahead in current lane; brake or change lane if blocked.
    const ahead = this._scanAhead(allCars, this.lane, 80);
    if (ahead) {
      // Match speed of slower car ahead; brake harder if gap is tight.
      const target = Math.min(this.nominalSpeed, ahead.car.currentSpeed * 0.95);
      this.targetSpeed = ahead.gap < 18 ? Math.max(6, ahead.car.currentSpeed - 6) : target;
      // Try to lane-change when the gap is tightening
      if (this.lane === this.targetLane && ahead.gap < 36 && Math.random() < 0.08) {
        const candidates = [this.lane - 1, this.lane + 1].filter(
          l => l >= 0 && l < WORLD.lanesPerSide,
        );
        for (const c of candidates.sort(() => Math.random() - 0.5)) {
          if (this._laneClear(allCars, c, 12, 40)) {
            this.targetLane = c;
            break;
          }
        }
      }
    } else {
      // Open road — drift back toward nominal pace
      this.targetSpeed = this.nominalSpeed;
    }

    // 2) Smooth speed adjustment (accelerate slower than brake)
    const dv = this.targetSpeed - this.currentSpeed;
    const rate = dv > 0 ? 4.0 : 9.0; // m/s²
    this.currentSpeed += Math.sign(dv) * Math.min(Math.abs(dv), rate * dt);

    // 3) Occasional spontaneous lane-change even on open road
    if (this.lane === this.targetLane && !ahead && Math.random() < TRAFFIC.laneChangeChance) {
      const candidates = [this.lane - 1, this.lane + 1].filter(
        l => l >= 0 && l < WORLD.lanesPerSide,
      );
      for (const c of candidates.sort(() => Math.random() - 0.5)) {
        if (this._laneClear(allCars, c, 12, 40)) { this.targetLane = c; break; }
      }
    }

    // ---- Move ----
    this.position.z -= this.direction * this.currentSpeed * dt;

    // Hug the curving centerline at the lane offset
    const targetX = centerlineX(this.position.z) + laneX(this.targetLane, this.direction);
    const dx = targetX - this.position.x;
    const slide = Math.sign(dx) * Math.min(Math.abs(dx), 6 * dt);
    this.position.x += slide;
    if (Math.abs(dx) < 0.05) this.lane = this.targetLane;

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = (this.direction === 1 ? Math.PI : 0) + (-slide * 0.6);

    // Spin wheels with distance travelled. Negative sign because positive X
    // rotation rolls the wheel "backward" from the right-side viewer (see
    // highway-racer player-car notes for the sign derivation).
    if (this.wheels.length > 0) {
      this.wheelAngle -= (this.currentSpeed * dt) / WHEEL_RADIUS;
      for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    }

    // Recycle when far behind
    if (this.direction * (this.position.z - playerZ) >= TRAFFIC.recycleDistBehind) {
      this.spawnAhead(playerZ);
    } else if (-this.direction * (this.position.z - playerZ) >= TRAFFIC.spawnDistAhead + 200) {
      this.spawnAhead(playerZ);
    }
  }
}

export class TrafficManager {
  constructor(scene) {
    this.scene = scene;
    this.cars = [];
    this.templates = [];
    this.wheelTemplate = null;
    for (let i = 0; i < TRAFFIC.count; i++) {
      const c = new TrafficCar(scene);
      c.rebuild(this.templates, this.wheelTemplate);
      this.cars.push(c);
    }
  }

  setTemplates(templates) {
    this.templates = templates;
    for (const c of this.cars) c.rebuild(this.templates, this.wheelTemplate);
  }

  setWheelTemplate(tpl) {
    this.wheelTemplate = tpl;
    for (const c of this.cars) c.rebuild(this.templates, this.wheelTemplate);
  }

  initialSpawn(playerZ) { for (const c of this.cars) c.spawnAhead(playerZ); }

  // Position-only separation between same-lane same-direction NPCs. This is
  // a last-resort backstop; the brain handles ordinary spacing. We DON'T
  // touch currentSpeed here (used to brake both by 15% per frame, which
  // compounded everyone to a standstill in seconds).
  _separate() {
    const minSep = CAR.length * 0.95;
    const minSep2 = minSep * minSep;
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i], b = this.cars[j];
        if (a.direction !== b.direction) continue;
        if (a.lane !== b.lane && a.targetLane !== b.lane && a.lane !== b.targetLane) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > minSep2 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const overlap = minSep - d;
        const nx = dx / d, nz = dz / d;
        a.position.x -= nx * overlap * 0.5;
        a.position.z -= nz * overlap * 0.5;
        b.position.x += nx * overlap * 0.5;
        b.position.z += nz * overlap * 0.5;
      }
    }
  }

  // Per-frame: drive everyone (with brain) + return first colliding car.
  update(dt, player) {
    for (const c of this.cars) c.update(dt, player.position.z, this.cars);
    this._separate();

    // Player-vs-traffic OBB-ish check (player heading affects local axes)
    const pFwdX = -Math.sin(player.heading);
    const pFwdZ = -Math.cos(player.heading);
    const pRightX =  Math.cos(player.heading);
    const pRightZ = -Math.sin(player.heading);
    const halfLen = CAR.length / 2;
    const halfWid = CAR.width / 2;
    let hit = null;
    for (const c of this.cars) {
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
