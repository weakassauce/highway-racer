import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CAMERA, WORLD, CAR } from './config.js';
import { Car, buildPlaceholderCar } from './car.js';
import { World } from './world.js';
import { TrafficManager } from './traffic.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { tryLoadGLB, normalizeCarModel, normalizeWheelModel, extractWheelsFromCar } from './asset_loader.js';

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

// Procedural fallback wheels until the player_car.glb loads, at which point
// we extract the GLB's own wheel triangles and use those (so the wheels
// match the car's actual look — paint, alloy spokes, etc.).
car.attachWheels(null);

tryLoadGLB('/assets/player_car.glb').then((g) => {
  if (!g) return;
  const root = normalizeCarModel(g, CAR.length);
  car.mesh.clear();
  car.mesh.add(root);
  // Pull the wheels OUT of the body geometry into 4 separate meshes that
  // can rotate independently. Body keeps everything else.
  const extracted = extractWheelsFromCar(root, CAR.length, CAR.width);
  const hasAny = extracted.wheels.some((m) => m);
  car.attachWheels(hasAny ? extracted : null);
  console.log('[wheels] extracted:', extracted.wheels.map((m) => m ? m.geometry.attributes.position.count : 0));
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
