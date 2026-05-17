import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function tryLoadGLB(url) {
  return new Promise((resolve) => {
    new GLTFLoader().load(
      url,
      (g) => resolve(g.scene),
      undefined,
      () => resolve(null),
    );
  });
}

// Normalize a generated car GLB: center, scale to a target length, rotate so
// nose faces -Z, no shadows on the car itself for perf.
export function normalizeCarModel(root, targetLength = 4.5) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 0) root.scale.setScalar(targetLength / longest);
  // TRELLIS GLBs face +Z by default; flip 180° so nose points -Z
  root.rotation.y = Math.PI;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  return root;
}

export async function forgeRequest(prompt) {
  const r = await fetch('/forge/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, grid_size: 2, animate: false }),
  });
  if (!r.ok) throw new Error(`forge ${r.status}`);
  return r.json();
}
export async function forgeStatus(jobId) {
  const r = await fetch(`/forge/generate/${jobId}`);
  if (!r.ok) throw new Error(`forge status ${r.status}`);
  return r.json();
}
