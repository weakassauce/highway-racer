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
  //    No default π flip here — keeps the player car in the original
  //    orientation it had before the traffic refactor. Direction-based
  //    flipping happens in the traffic wrapper itself.
  box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  let rotY = 0;
  if (size.x > size.z && size.x > size.y) rotY = Math.PI / 2;
  if (window.carNoseFlip) rotY += Math.PI;
  root.rotation.y = rotY;

  // 4. Lift so wheels touch the road (bottom of bbox = 0). Recompute the
  //    bbox AFTER scaling so the lift uses the final size.
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

// Find the wheels inside a car GLB and cut them out.
// Strategy: gather every triangle whose centroid sits in the lower half of
// the car, then run k-means (k=4) on their XZ positions to discover the
// 4 actual wheel hub locations (instead of guessing). Any low triangle
// within a generous radius of its cluster center is reclassified as
// part of that wheel, pulled into its own BufferGeometry (recentred on
// the cluster centroid), and removed from the body's index.
// Front pair = the two clusters with smaller Z (Z is car length, -Z forward).
// Returns { wheels: [FL,FR,RL,RR] (some may be null), wheelHubs: [...] }
export function extractWheelsFromCar(root, carLength, carWidth) {
  root.updateMatrixWorld(true);

  // Pass 1: enumerate every triangle, record its centroid + a back-ref.
  const tris = []; // { centroid: {x,y,z}, mesh, i0,i1,i2 }
  const meshList = [];
  root.traverse((mesh) => {
    if (!mesh.isMesh || !mesh.geometry || !mesh.geometry.index) return;
    meshList.push(mesh);
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const idx = geo.index.array;
    const meshToRoot = mesh.matrixWorld.clone();
    meshToRoot.premultiply(new THREE.Matrix4().copy(root.matrixWorld).invert());
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      v0.fromBufferAttribute(pos, i0).applyMatrix4(meshToRoot);
      v1.fromBufferAttribute(pos, i1).applyMatrix4(meshToRoot);
      v2.fromBufferAttribute(pos, i2).applyMatrix4(meshToRoot);
      tris.push({
        cx: (v0.x + v1.x + v2.x) / 3,
        cy: (v0.y + v1.y + v2.y) / 3,
        cz: (v0.z + v1.z + v2.z) / 3,
        mesh, t,
      });
    }
  });
  if (tris.length === 0) return { wheels: [null, null, null, null], wheelHubs: [] };

  // Find the car's overall Y extent to set a "low half" threshold for wheels
  let minY = Infinity, maxY = -Infinity;
  for (const t of tris) { if (t.cy < minY) minY = t.cy; if (t.cy > maxY) maxY = t.cy; }
  const yThresh = minY + (maxY - minY) * 0.55; // bottom 55% of car

  const lowTris = tris.filter((t) => t.cy <= yThresh);
  if (lowTris.length === 0) return { wheels: [null, null, null, null], wheelHubs: [] };

  // K-means with 4 clusters seeded at the corners of the car footprint.
  const seedX = carWidth * 0.38, seedZ = carLength * 0.32;
  let centers = [
    { x: -seedX, z: -seedZ }, { x:  seedX, z: -seedZ },
    { x: -seedX, z:  seedZ }, { x:  seedX, z:  seedZ },
  ];
  for (let iter = 0; iter < 14; iter++) {
    const sums = [
      { x: 0, z: 0, n: 0 }, { x: 0, z: 0, n: 0 },
      { x: 0, z: 0, n: 0 }, { x: 0, z: 0, n: 0 },
    ];
    for (const t of lowTris) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < 4; c++) {
        const dx = t.cx - centers[c].x, dz = t.cz - centers[c].z;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best].x += t.cx; sums[best].z += t.cz; sums[best].n += 1;
    }
    let moved = 0;
    centers = centers.map((c, i) => {
      if (sums[i].n === 0) return c;
      const nx = sums[i].x / sums[i].n, nz = sums[i].z / sums[i].n;
      moved = Math.max(moved, Math.abs(nx - c.x), Math.abs(nz - c.z));
      return { x: nx, z: nz };
    });
    if (moved < 0.003) break;
  }

  // Order: front pair (smaller Z) before rear pair; within a pair, left first.
  centers.sort((a, b) => a.z - b.z); // front (smaller Z) first
  const front = centers.slice(0, 2).sort((a, b) => a.x - b.x); // L (smaller X), R
  const rear  = centers.slice(2, 4).sort((a, b) => a.x - b.x);
  const orderedCenters = [...front, ...rear];

  // Build buckets, seeded at the cluster centers; pull triangles within a
  // generous radius of their assigned center.
  // Pick a radius based on inter-cluster distance: half the front lateral gap.
  const frontGap = Math.abs(front[1].x - front[0].x);
  const sideGap  = Math.abs(rear[0].z - front[0].z);
  const ZONE_R = Math.min(0.95, Math.max(0.45, Math.min(frontGap, sideGap) * 0.42));

  const wheelHubs = orderedCenters.map((c, i) => ({
    x: c.x, y: 0, z: c.z, isFront: i < 2,
  }));
  const buckets = wheelHubs.map(() => ({
    positions: [], normals: [], uvs: [], indices: [],
    vertexMap: new Map(), nextIdx: 0, material: null,
    perMeshKeep: new Map(), // mesh → array of triangle index-triples to keep
  }));

  // Walk every mesh again, this time actually doing the extraction.
  for (const mesh of meshList) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const idx = geo.index.array;
    const meshToRoot = mesh.matrixWorld.clone();
    meshToRoot.premultiply(new THREE.Matrix4().copy(root.matrixWorld).invert());

    const keep = [];
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
    for (let t = 0; t < idx.length; t += 3) {
      const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
      v0.fromBufferAttribute(pos, i0).applyMatrix4(meshToRoot);
      v1.fromBufferAttribute(pos, i1).applyMatrix4(meshToRoot);
      v2.fromBufferAttribute(pos, i2).applyMatrix4(meshToRoot);
      const cy = (v0.y + v1.y + v2.y) / 3;
      let claimed = -1;
      if (cy <= yThresh) {
        const cx = (v0.x + v1.x + v2.x) / 3;
        const cz = (v0.z + v1.z + v2.z) / 3;
        let bestD = ZONE_R * ZONE_R;
        for (let c = 0; c < 4; c++) {
          const dx = cx - wheelHubs[c].x, dz = cz - wheelHubs[c].z;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; claimed = c; }
        }
      }
      if (claimed < 0) {
        keep.push(i0, i1, i2);
        continue;
      }
      const b = buckets[claimed];
      if (!b.material) b.material = mesh.material;
      const hub = wheelHubs[claimed];
      for (const ovi of [i0, i1, i2]) {
        let nv = b.vertexMap.get(ovi);
        if (nv === undefined) {
          nv = b.nextIdx++;
          b.vertexMap.set(ovi, nv);
          const wp = new THREE.Vector3().fromBufferAttribute(pos, ovi).applyMatrix4(meshToRoot);
          b.positions.push(wp.x - hub.x, wp.y - hub.y, wp.z - hub.z);
          if (norm) b.normals.push(norm.getX(ovi), norm.getY(ovi), norm.getZ(ovi));
          if (uv)   b.uvs.push(uv.getX(ovi), uv.getY(ovi));
        }
        b.indices.push(nv);
      }
    }
    if (keep.length !== idx.length) geo.setIndex(keep);
  }

  // Recenter on actual centroid so spin axis is the true wheel center.
  for (let w = 0; w < buckets.length; w++) {
    const b = buckets[w];
    if (b.positions.length === 0) continue;
    let cx = 0, cy = 0, cz = 0;
    const n = b.positions.length / 3;
    for (let i = 0; i < b.positions.length; i += 3) {
      cx += b.positions[i]; cy += b.positions[i + 1]; cz += b.positions[i + 2];
    }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < b.positions.length; i += 3) {
      b.positions[i] -= cx; b.positions[i + 1] -= cy; b.positions[i + 2] -= cz;
    }
    wheelHubs[w].x += cx;
    wheelHubs[w].y += cy;
    wheelHubs[w].z += cz;
  }

  const wheelMeshes = buckets.map((b) => {
    if (b.positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
    if (b.normals.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
    if (b.uvs.length)     g.setAttribute('uv',     new THREE.Float32BufferAttribute(b.uvs, 2));
    g.setIndex(b.indices);
    if (!b.normals.length) g.computeVertexNormals();
    const m = new THREE.Mesh(g, b.material || new THREE.MeshStandardMaterial({ color: 0x222222 }));
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  });

  return { wheels: wheelMeshes, wheelHubs };
}

// Normalize a building GLB so it sits on y=0 and is approximately targetHeight
// tall. TRELLIS sometimes outputs sideways buildings (long axis on X or Z
// instead of Y) — we detect that and rotate upright.
export function normalizeBuildingModel(root, targetHeight = 40) {
  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());

  // If a horizontal axis is significantly taller than Y, the building is
  // lying on its side. Rotate so the longest axis points up.
  const longestAxis = (size.x > size.y && size.x > size.z) ? 'x'
                    : (size.z > size.y && size.z > size.x) ? 'z'
                    : 'y';
  // Map the longest axis to +Y. R_z(+π/2) sends +X → +Y, R_x(-π/2) sends +Z → +Y.
  if (longestAxis === 'x') root.rotation.z = Math.PI / 2;
  else if (longestAxis === 'z') root.rotation.x = -Math.PI / 2;

  // Recompute bbox after potential rotation, then center XZ and lift to ground
  box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;

  // Scale so the building's height matches targetHeight (after upright fix,
  // Y should be the tallest axis).
  box = new THREE.Box3().setFromObject(root);
  size = box.getSize(new THREE.Vector3());
  const tallest = Math.max(size.y, 0.001);
  const scale = targetHeight / tallest;
  root.scale.setScalar(scale);

  // Re-lift so bottom touches y=0 after scaling
  const box2 = new THREE.Box3().setFromObject(root);
  root.position.y -= box2.min.y;

  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = 1.0;
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
