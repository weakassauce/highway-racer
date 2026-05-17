import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAMERA, WORLD, CAR } from './config.js';
import { Car, buildPlaceholderCar } from './car.js';
import { World } from './world.js';
import { TrafficManager } from './traffic.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { tryLoadGLB, normalizeCarModel, normalizeWheelModel } from './asset_loader.js';

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
    // Mirror right-side wheels so the rim face points outward on both sides.
    // (The normalized template's rim faces -X; right wheels (x > 0) need +X.)
    if (hub.x > 0) clone.scale.x = -clone.scale.x;
    return clone;
  });
  car.attachWheels({ wheels: meshes, wheelHubs: hubs });
  console.log('[wheels] body extent', { x: fullX.toFixed(2), z: fullZ.toFixed(2) }, 'hubs:', hubs);
}

tryLoadGLB('/assets/wheel.glb').then((g) => {
  if (!g) return;
  wheelTemplateGLB = g;
  reAttachWheels();
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

// Swap traffic models when a separate traffic GLB is available
tryLoadGLB('/assets/traffic_car.glb').then((g) => {
  if (!g) return;
  const template = normalizeCarModel(g, CAR.length);
  for (const t of traffic.cars) {
    scene.remove(t.mesh);
    t.mesh = template.clone(true);
    t.mesh.traverse((o) => { if (o.isMesh && o.material) o.material = o.material.clone(); });
    scene.add(t.mesh);
  }
});

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

  // Keep player on the road (soft barrier inside the asphalt edge)
  const halfRoad = (WORLD.laneWidth * WORLD.numLanes) / 2 - CAR.width / 2;
  if (car.position.x > halfRoad) { car.position.x = halfRoad; car.velocity.x = 0; }
  if (car.position.x < -halfRoad) { car.position.x = -halfRoad; car.velocity.x = 0; }

  // Traffic + collisions
  const hit = traffic.update(dt, car);
  if (hit) {
    car.collideWith(hit.position);
    // Push the traffic car aside too
    const away = new THREE.Vector3().subVectors(hit.position, car.position).normalize();
    hit.position.addScaledVector(away, 1.5);
  }

  world.update(car.position.z);
  chase.update(dt, car, controls);
  hud.draw({ car });

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
