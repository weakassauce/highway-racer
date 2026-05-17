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

// Find the wheels inside a car GLB and cut them out. Triangles whose
// centroid sits inside one of four "wheel zones" (vertical cylinders at
// the expected wheel positions, near the floor) are pulled into separate
// BufferGeometries with their positions re-centered on the wheel hub.
// The originals are simultaneously dropped from the body's index so the
// surface no longer renders those triangles. Returns
//   { wheels: [FL, FR, RL, RR] meshes (or null), wheelPositions: [..] }
// so the caller can parent each into a spin/steer pivot.
export function extractWheelsFromCar(root, carLength, carWidth) {
  // Expected wheel hubs in car-local space (Z is car length axis).
  const LATERAL = 0.40;       // fraction of half-width
  const LONGITUDINAL = 0.32;  // fraction of length from center
  const ZONE_RADIUS = Math.max(0.45, carLength * 0.13); // cylindrical zone
  const ZONE_Y_MAX = 0.95;    // ignore high triangles (canopy roof etc.)

  const wheelHubs = [
    { x: -carWidth * LATERAL, y: 0,  z: -carLength * LONGITUDINAL, isFront: true  },
    { x:  carWidth * LATERAL, y: 0,  z: -carLength * LONGITUDINAL, isFront: true  },
    { x: -carWidth * LATERAL, y: 0,  z:  carLength * LONGITUDINAL, isFront: false },
    { x:  carWidth * LATERAL, y: 0,  z:  carLength * LONGITUDINAL, isFront: false },
  ];

  const buckets = wheelHubs.map(() => ({
    positions: [], normals: [], uvs: [], indices: [],
    vertexMap: new Map(), nextIdx: 0, material: null,
  }));

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const centroid = new THREE.Vector3();

  root.updateMatrixWorld(true);

  root.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    if (!geo.index) return;
    const indexArr = geo.index.array;

    // We work in root-local space. Each vertex needs the mesh-to-root
    // transform applied to get its position inside the car. (For most
    // TRELLIS exports the chain is identity, but we don't assume that.)
    const meshToRoot = mesh.matrixWorld.clone();
    meshToRoot.premultiply(new THREE.Matrix4().copy(root.matrixWorld).invert());

    const keepIndices = [];
    for (let t = 0; t < indexArr.length; t += 3) {
      const i0 = indexArr[t], i1 = indexArr[t + 1], i2 = indexArr[t + 2];
      v0.fromBufferAttribute(pos, i0).applyMatrix4(meshToRoot);
      v1.fromBufferAttribute(pos, i1).applyMatrix4(meshToRoot);
      v2.fromBufferAttribute(pos, i2).applyMatrix4(meshToRoot);
      centroid.copy(v0).add(v1).add(v2).divideScalar(3);

      let claimed = -1;
      if (centroid.y < ZONE_Y_MAX) {
        for (let w = 0; w < wheelHubs.length; w++) {
          const dx = centroid.x - wheelHubs[w].x;
          const dz = centroid.z - wheelHubs[w].z;
          if (dx * dx + dz * dz < ZONE_RADIUS * ZONE_RADIUS) {
            claimed = w;
            break;
          }
        }
      }

      if (claimed < 0) {
        keepIndices.push(i0, i1, i2);
      } else {
        const b = buckets[claimed];
        if (!b.material) b.material = mesh.material;
        const hub = wheelHubs[claimed];
        for (const ovi of [i0, i1, i2]) {
          let nv = b.vertexMap.get(ovi);
          if (nv === undefined) {
            nv = b.nextIdx++;
            b.vertexMap.set(ovi, nv);
            // Re-center vertex on the wheel hub so it rotates around (0,0,0)
            // of the spin pivot. We use the *mesh-local* position, then
            // shift by the hub offset in root space.
            const wp0 = new THREE.Vector3().fromBufferAttribute(pos, ovi).applyMatrix4(meshToRoot);
            b.positions.push(wp0.x - hub.x, wp0.y - hub.y, wp0.z - hub.z);
            if (norm) b.normals.push(norm.getX(ovi), norm.getY(ovi), norm.getZ(ovi));
            if (uv)   b.uvs.push(uv.getX(ovi), uv.getY(ovi));
          }
          b.indices.push(nv);
        }
      }
    }

    if (keepIndices.length !== indexArr.length) {
      geo.setIndex(keepIndices);
    }
  });

  const wheelMeshes = buckets.map((b) => {
    if (b.positions.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
    if (b.normals.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
    if (b.uvs.length)     g.setAttribute('uv',     new THREE.Float32BufferAttribute(b.uvs, 2));
    g.setIndex(b.indices);
    if (!b.normals.length) g.computeVertexNormals();
    const mat = b.material || new THREE.MeshStandardMaterial({ color: 0x222222 });
    const m = new THREE.Mesh(g, mat);
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  });

  return { wheels: wheelMeshes, wheelHubs };
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
