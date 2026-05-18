import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAMERA, WORLD, CAR, centerlineX } from './config.js';
import { Car, buildPlaceholderCar } from './car.js';
import { World } from './world.js';
import { TrafficManager } from './traffic.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { tryLoadGLB, normalizeCarModel, normalizeWheelModel, normalizeBuildingModel } from './asset_loader.js';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();

// Image-based lighting: gives the car body real reflections (sky/floor/walls
// of a procedural studio room blurred into an envmap), which is what makes
// painted panels look glossy instead of plasticky.
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(CAMERA.fovBase, window.innerWidth / window.innerHeight, 0.5, 4000);
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

const world = new World(scene);

// Player car
const carMesh = buildPlaceholderCar();
scene.add(carMesh);
const car = new Car(carMesh);

// Player_car GLB is generated wheel-less, so we just place wheel.glb clones
// at the wheel arch positions of the actual loaded body (measured after
// normalize, not the placeholder dimensions).
let wheelTemplate = null;
let wheelTemplateGLB = null; // raw GLB scene before normalize, so we can resize later

// All tunable from devtools as `wheelTune.<field>` + `applyWheels()`.
// Defaults match real Porsche 911 GT3 RS proportions:
//   wheelbase 2.45 m / 4.5 m length ≈ 0.272 half-fraction
//   track 1.55 m / 1.9 m width ≈ 0.408 half-fraction
//   wheel-with-tire OD ≈ 0.72 m
const wheelTune = {
  lateral: 0.41,       // hub x = ±lateral × bbox.x      (half-fraction of full width)
  longitudinal: 0.27,  // hub z = ±longitudinal × bbox.z (half-fraction of full length)
  diameter: 0.72,      // wheel.glb sized to this stud diameter
  yLift: -0.08,        // negative drops the wheels into the arch a bit
};
let carBBox = null;

window.wheelTune = wheelTune;
window.applyWheels = () => reAttachWheels();

function reAttachWheels() {
  if (!carBBox) return;
  if (wheelTemplateGLB) {
    // Re-normalize the wheel each time so live diameter changes take effect.
    wheelTemplate = normalizeWheelModel(wheelTemplateGLB.clone(true), wheelTune.diameter);
  }
  const fullX = carBBox.max.x - carBBox.min.x;
  const fullZ = carBBox.max.z - carBBox.min.z;
  const r = wheelTune.diameter / 2;
  // lateral / longitudinal are fractions of the FULL body extent, applied
  // symmetrically about origin (the body was centered on x=0, z=0).
  const dx = fullX * wheelTune.lateral;
  const dz = fullZ * wheelTune.longitudinal;
  const hubs = [
    { x: -dx, y: r + wheelTune.yLift, z: -dz, isFront: true  }, // FL
    { x:  dx, y: r + wheelTune.yLift, z: -dz, isFront: true  }, // FR
    { x: -dx, y: r + wheelTune.yLift, z:  dz, isFront: false }, // RL
    { x:  dx, y: r + wheelTune.yLift, z:  dz, isFront: false }, // RR
  ];
  const meshes = hubs.map((hub) => {
    if (!wheelTemplate) return null;
    const clone = wheelTemplate.clone(true);
    // Flip left-side wheels 180° around Y so their rim faces -X (outward).
    // Using rotation instead of scale avoids the negative-X mirror flipping
    // triangle winding (which made the rim's front faces backface-cull).
    if (hub.x < 0) clone.rotation.y += Math.PI;
    return clone;
  });
  car.attachWheels({ wheels: meshes, wheelHubs: hubs });
  console.log('[wheels] body extent', { x: fullX.toFixed(2), z: fullZ.toFixed(2) }, 'hubs:', hubs);
}

tryLoadGLB('/assets/wheel.glb').then((g) => {
  if (!g) return;
  wheelTemplateGLB = g;
  // Always build the wheel template (don't wait for the player car to load —
  // traffic shares this template too and would otherwise get procedural).
  wheelTemplate = normalizeWheelModel(wheelTemplateGLB.clone(true), wheelTune.diameter);
  reAttachWheels();
  if (typeof trySetTrafficWheel === 'function') trySetTrafficWheel();
});

tryLoadGLB('/assets/player_car.glb').then((g) => {
  if (!g) return;
  car.mesh.clear();
  const root = normalizeCarModel(g, CAR.length);
  car.mesh.add(root);
  // Measure body to size wheel placement to its real extent
  carBBox = new THREE.Box3().setFromObject(root);
  reAttachWheels();
});

// Traffic
const traffic = new TrafficManager(scene);
traffic.initialSpawn(car.position.z);

// Hot-swap the wheel template into traffic as soon as it's loaded
function trySetTrafficWheel() {
  if (wheelTemplate) traffic.setWheelTemplate(wheelTemplate);
}

// Real-world dimensions + per-vehicle wheel hub fractions. Each car gets
// scaled to its own length on import so a RAM towers over a Mustang.
// `extraRotY` lets us correct individual TRELLIS GLBs whose forward axis
// came out opposite of the others.
const TRAFFIC_VARIANTS = [
  // length / wheelLat / wheelLong fractions of bbox; wheelRadius in meters.
  // Lateral pulled in significantly — bbox includes mirrors/fenders so the
  // actual axle position is well inside the body envelope.
  // extraLift jacks the truck up off the road like a lifted truck would be.
  { url: '/assets/traffic_ram.glb',     length: 6.8, wheelLat: 0.34, wheelLong: 0.30, wheelRadius: 0.42, extraRotY: 0,       extraLift: 0.18 },
  { url: '/assets/traffic_tesla.glb',   length: 5.0, wheelLat: 0.40, wheelLong: 0.30, wheelRadius: 0.34, extraRotY: 0,       extraLift: 0    },
  { url: '/assets/traffic_mustang.glb', length: 4.7, wheelLat: 0.40, wheelLong: 0.32, wheelRadius: 0.34, extraRotY: Math.PI, extraLift: 0    },
];

const trafficTemplates = [];
function pushTrafficTemplate(g, variant) {
  if (!g) return;
  const root = normalizeCarModel(g, variant.length);
  if (variant.extraRotY) root.rotation.y += variant.extraRotY;
  if (variant.extraLift) root.position.y += variant.extraLift;
  trafficTemplates.push({
    root,
    wheelLat: variant.wheelLat,
    wheelLong: variant.wheelLong,
    wheelRadius: variant.wheelRadius,
    extraLift: variant.extraLift || 0,
  });
  traffic.setTemplates(trafficTemplates);
  trySetTrafficWheel();
}
for (const v of TRAFFIC_VARIANTS) {
  tryLoadGLB(v.url).then((g) => pushTrafficTemplate(g, v));
}

// Load building variants and rebuild segments so they show up
const buildingTemplates = [];
function pushBuildingTemplate(g, targetHeight) {
  if (!g) return;
  const root = normalizeBuildingModel(g, targetHeight);
  buildingTemplates.push({ root });
  world.buildingTemplates = buildingTemplates;
  world.rebuildSegments();
}

// Tree GLB hot-loader — segments will use clones of this template if it's
// loaded by the time they build (or rebuild).
tryLoadGLB('/assets/tree.glb').then((g) => {
  if (!g) return;
  // Normalize once: center XZ, lift so trunk base touches y=0, scale tall-ish.
  const box = new THREE.Box3().setFromObject(g);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  g.position.x -= center.x;
  g.position.z -= center.z;
  g.position.y -= box.min.y;
  const targetHeight = 10;
  const tallest = Math.max(size.y, 0.001);
  g.scale.setScalar(targetHeight / tallest);
  const b2 = new THREE.Box3().setFromObject(g);
  g.position.y -= b2.min.y;
  world.treeTemplate = g;
  world.rebuildSegments();
});
// Building target heights — uniform scale now, so picking modest heights
// keeps width reasonable. Per-instance 0.85-1.65 jitter (multiplyScalar)
// on top means real sizes land roughly 70-150 m tall.
tryLoadGLB('/assets/building1.glb').then((g) => pushBuildingTemplate(g, 95));
tryLoadGLB('/assets/building2.glb').then((g) => pushBuildingTemplate(g, 70));
tryLoadGLB('/assets/building3.glb').then((g) => pushBuildingTemplate(g, 50));

const input = new Input();
const chase = new ChaseCamera(camera);
const hud = new HUD();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  input.decayLook(dt);
  const controls = input.axes();
  for (const a of input.drainActions()) {
    if (a === 'reset') {
      car.reset();
      traffic.initialSpawn(car.position.z);
    } else if (a === 'toggleView') {
      chase.toggleView();
    }
  }

  car.update(dt, controls);

  // Soft barriers that follow the curving centerline. Player can drift
  // into the other carriageway (oncoming traffic!) but the outer edges
  // are firm.
  const cx = centerlineX(car.position.z);
  const halfRoadOuter = WORLD.lanesPerSide * WORLD.laneWidth + WORLD.medianWidth / 2 - CAR.width / 2;
  const xRel = car.position.x - cx;
  if (xRel >  halfRoadOuter) { car.position.x = cx + halfRoadOuter; car.velocity.x = 0; }
  if (xRel < -halfRoadOuter) { car.position.x = cx - halfRoadOuter; car.velocity.x = 0; }

  // Traffic + collisions (impulse-based; both cars feel it)
  const hit = traffic.update(dt, car);
  if (hit) {
    const dir = hit.direction || 1;
    const vTraffic = new THREE.Vector3(0, 0, -dir * hit.currentSpeed);
    car.collideWith(hit.position, vTraffic, 0.35);
    const away = new THREE.Vector3().subVectors(hit.position, car.position).normalize();
    hit.position.addScaledVector(away, 1.0);
    // Traffic AI brakes hard after a hit
    hit.currentSpeed = Math.max(6, hit.currentSpeed * 0.6);
    hit.targetSpeed  = Math.max(8, hit.nominalSpeed * 0.7);
  }

  world.update(car.position.z);
  chase.update(dt, car, controls);
  hud.draw({ car });

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
