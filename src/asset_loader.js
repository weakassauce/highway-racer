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

// Normalize a generated car GLB: center, scale to a target length, auto-orient
// the long axis to Z, then lift the model so its wheels sit on y = 0.
// Polish the materials so painted panels look glossy.
export function normalizeCarModel(root, targetLength = 4.5) {
  // 1. Center on origin so subsequent rotations/scales spin around the model.
  let box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);

  // 2. Scale by longest axis (use pre-scale bbox)
  const preSize = box.getSize(new THREE.Vector3());
  const longest = Math.max(preSize.x, preSize.y, preSize.z);
  if (longest > 0) root.scale.setScalar(targetLength / longest);

  // 3. Auto-rotate so the car's longest horizontal dimension is along Z (length).
  //    TRELLIS sometimes outputs the car sideways (long axis on X).
  box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  let rotY = 0;
  if (size.x > size.z && size.x > size.y) rotY = Math.PI / 2;
  // Apply the configured nose flip (TRELLIS may face either +Z or -Z; this
  // lets us toggle without recompiling).
  if (window.carNoseFlip) rotY += Math.PI;
  root.rotation.y = rotY;

  // 4. Lift so wheels touch the road (bottom of bbox = 0)
  box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      // Polish: low roughness for clearcoat shine, lift metalness so the
      // env-map reflections actually show up, and turn up envMapIntensity.
      if ('roughness' in m) m.roughness = Math.min(0.22, m.roughness ?? 0.4);
      if ('metalness' in m) m.metalness = Math.max(0.55, m.metalness ?? 0);
      if ('envMapIntensity' in m) m.envMapIntensity = 1.6;
      m.needsUpdate = true;
    }
    // Smooth-shaded triangles look glossier than flat ones.
    if (o.geometry && o.geometry.attributes && !o.geometry.attributes.normal) {
      o.geometry.computeVertexNormals();
    }
  });
  return root;
}

// Normalize a wheel GLB so it can be parented inside a spin-pivot whose
// rotation.x is the rolling angle. TRELLIS reconstructs the wheel facing
// the camera (axis along Z); we rotate so its axis becomes X.
export function normalizeWheelModel(root, targetDiameter = 0.8) {
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 0) root.scale.setScalar(targetDiameter / longest);
  root.rotation.y = Math.PI / 2;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if ('roughness' in m) m.roughness = Math.min(0.4, m.roughness ?? 0.5);
      if ('envMapIntensity' in m) m.envMapIntensity = 1.4;
      m.needsUpdate = true;
    }
  });
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
