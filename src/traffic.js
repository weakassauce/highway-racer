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

const WHEEL_RADIUS_DEFAULT = 0.33;
const WHEEL_LATERAL = 0.34;       // fraction of body bbox X
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

    // Each entry can be either:
    //   - a Three.js Object3D (legacy)
    //   - { root, wheelLat, wheelLong } (new per-vehicle metadata)
    const realTemplates = (templates || []).filter(Boolean);
    const pick = realTemplates.length > 0
      ? realTemplates[Math.floor(Math.random() * realTemplates.length)]
      : null;
    const templateRoot = pick && pick.root ? pick.root : pick;
    this._wheelLat    = (pick && pick.wheelLat)    || WHEEL_LATERAL;
    this._wheelLong   = (pick && pick.wheelLong)   || WHEEL_LONGITUDINAL;
    this._wheelRadius = (pick && pick.wheelRadius) || WHEEL_RADIUS_DEFAULT;
    this._extraLift   = (pick && pick.extraLift)   || 0;

    const inner = templateRoot
      ? templateRoot.clone(true)
      : buildPlaceholderCar({ bodyColor: this.color });
    this.mesh.add(inner);
    this.body = inner;

    this._attachWheels(wheelTemplate);
  }

  _attachWheels(wheelTemplate) {
    if (!this.body) return;
    const bbox = new THREE.Box3().setFromObject(this.body);
    const size = bbox.getSize(new THREE.Vector3());
    const fullX = size.x || CAR.width;
    const fullZ = size.z || CAR.length;
    const r = this._wheelRadius ?? WHEEL_RADIUS_DEFAULT;
    const dx = fullX * (this._wheelLat  ?? WHEEL_LATERAL);
    const dz = fullZ * (this._wheelLong ?? WHEEL_LONGITUDINAL);
    // Wheels sit on the road at y=r; if the body itself is lifted (truck),
    // that doesn't move the wheels — they stay at road level.
    const hubY = r - (this._extraLift || 0);
    const hubs = [
      { x: -dx, y: hubY, z: -dz, isFront: true  },
      { x:  dx, y: hubY, z: -dz, isFront: true  },
      { x: -dx, y: hubY, z:  dz, isFront: false },
      { x:  dx, y: hubY, z:  dz, isFront: false },
    ];
    for (const h of hubs) {
      // YXZ rotation order: Y (steer) is applied first, then X (spin),
      // so the steer rotates around vertical without wobbling the axle.
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      pivot.position.set(h.x, h.y, h.z);
      let wheel;
      if (wheelTemplate) {
        wheel = wheelTemplate.clone(true);
        // Scale the wheel template to match per-vehicle radius (template is
        // sized to ~0.72 m diameter by normalizeWheelModel for the Porsche).
        const desiredDiameter = r * 2;
        wheel.scale.multiplyScalar(desiredDiameter / 0.72);
        if (h.x < 0) wheel.rotation.y += Math.PI;
      } else {
        const geo = new THREE.CylinderGeometry(r, r, 0.26, 14);
        const mat = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.85 });
        wheel = new THREE.Mesh(geo, mat);
        wheel.rotation.z = Math.PI / 2;
      }
      pivot.add(wheel);
      this.mesh.add(pivot);
      this.wheels.push({ pivot, isFront: h.isFront });
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
    this.mesh.rotation.y = this.direction === 1 ? Math.PI : 0;
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

    // Hug the curving centerline at the lane offset (gentler 3 m/s slide so
    // lane changes feel deliberate, not snap-to).
    const targetX = centerlineX(this.position.z) + laneX(this.targetLane, this.direction);
    const dx = targetX - this.position.x;
    const slide = Math.sign(dx) * Math.min(Math.abs(dx), 3 * dt);
    this.position.x += slide;
    if (Math.abs(dx) < 0.05) this.lane = this.targetLane;

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = (this.direction === 1 ? Math.PI : 0) + (-slide * 0.4);

    // Spin wheels with distance travelled. Front wheels also turn during a
    // lane change so the steering reads.
    if (this.wheels.length > 0) {
      const r = this._wheelRadius ?? WHEEL_RADIUS_DEFAULT;
      this.wheelAngle -= (this.currentSpeed * dt) / r;
      // Steering angle: front wheels point in the direction of the slide
      // (signed by direction so it matches visually for both carriageways).
      const targetSteer = Math.sign(dx) * Math.min(0.45, Math.abs(dx) * 0.35);
      this._steerAngle = this._steerAngle ?? 0;
      this._steerAngle += (targetSteer - this._steerAngle) * Math.min(1, dt * 6);
      for (const w of this.wheels) {
        w.pivot.rotation.x = this.wheelAngle;
        w.pivot.rotation.y = w.isFront ? this._steerAngle : 0;
      }
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
