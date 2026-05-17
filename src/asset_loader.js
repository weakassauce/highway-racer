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
// nose faces -Z, polish the materials so painted panels look glossy.
export function normalizeCarModel(root, targetLength = 4.5) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 0) root.scale.setScalar(targetLength / longest);
  // TRELLIS GLBs face +Z by default; flip 180° so nose points -Z
  root.rotation.y = Math.PI;

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
