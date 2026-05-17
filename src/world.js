import * as THREE from 'three';
import { WORLD, CURVE, centerlineX, centerlineTangent } from './config.js';

// Curved, two-direction highway. Each segment renders a ribbon of N
// sub-quads following centerlineX(z), plus dashed lane lines, a grass
// median, edge barriers, streetlights, and city blocks either side.
//
// Recycling: when a segment falls more than 2× segLen behind the player,
// it jumps ahead and its geometry is rebuilt for the new world Z.

export class World {
  constructor(scene) {
    this.scene = scene;
    scene.background = this._makeSkyTexture();
    scene.fog = new THREE.Fog(WORLD.fogColor, WORLD.fogNear, WORLD.fogFar);

    const sun = new THREE.DirectionalLight(0xffe6c8, 0.85);
    sun.position.set(-0.4, 1.0, -0.2).normalize().multiplyScalar(500);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x8aa5d4, 0x101418, 0.6));

    // Big dark ground plane that fills the world beyond the highway
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.MeshStandardMaterial({ color: WORLD.groundColor, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    scene.add(ground);

    // Pre-create materials shared between segments
    this._asphaltMat = new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.92 });
    this._lineMat    = new THREE.MeshBasicMaterial({ color: 0xeef4ff });
    this._edgeMat    = new THREE.MeshBasicMaterial({ color: 0xffd96b });
    this._medianMat  = new THREE.MeshStandardMaterial({ color: 0x2a3a1c, roughness: 0.95 });
    this._barrierMat = new THREE.MeshStandardMaterial({ color: 0xb3bcc6, roughness: 0.55, metalness: 0.4 });
    this._dividerMat = new THREE.MeshStandardMaterial({ color: 0xc4ccd4, roughness: 0.6 });

    this.segments = [];
    for (let i = 0; i < WORLD.visibleSegments; i++) {
      const seg = new THREE.Group();
      seg.position.z = -i * WORLD.roadSegmentLength;
      this._buildSegmentGeometry(seg, seg.position.z);
      scene.add(seg);
      this.segments.push(seg);
    }
  }

  _makeSkyTexture() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 512;
    const ctx = c.getContext('2d');
    const top = new THREE.Color(WORLD.skyTop);
    const bot = new THREE.Color(WORLD.skyBottom);
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, `rgb(${top.r*255|0},${top.g*255|0},${top.b*255|0})`);
    g.addColorStop(1, `rgb(${bot.r*255|0},${bot.g*255|0},${bot.b*255|0})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Build the entire segment (asphalt ribbons + lines + median + buildings)
  // from scratch into the given Group, sampling the curve at z+offset.
  _buildSegmentGeometry(seg, segZ) {
    // Clear any existing children
    while (seg.children.length) seg.remove(seg.children[0]);

    const segLen = WORLD.roadSegmentLength;
    const samples = WORLD.segmentCurveSamples;
    const lanesPerSide = WORLD.lanesPerSide;
    const laneW = WORLD.laneWidth;
    const medianW = WORLD.medianWidth;
    const halfRoadWidth = lanesPerSide * laneW + medianW / 2;

    // Pre-sample the curve at each rib position
    const ribs = new Array(samples + 1);
    for (let i = 0; i <= samples; i++) {
      const localZ = -i * (segLen / samples);            // segment-local
      const worldZ = segZ + localZ;
      const cx = centerlineX(worldZ);
      const tan = centerlineTangent(worldZ);
      // Lateral (perpendicular in XZ plane) — for road width
      const lx = -tan.z, lz = tan.x;
      ribs[i] = { localZ, cx, lx, lz };
    }

    // ----- Asphalt ribbon, two sides -----
    const buildRibbon = (offsetInner, offsetOuter, material, yOffset = 0) => {
      const verts = [], norms = [], uvs = [], idx = [];
      for (let i = 0; i <= samples; i++) {
        const r = ribs[i];
        const li = r.cx + r.lx * offsetInner;
        const lo = r.cx + r.lx * offsetOuter;
        const zi = r.localZ + r.lz * offsetInner;
        const zo = r.localZ + r.lz * offsetOuter;
        verts.push(li, yOffset, zi, lo, yOffset, zo);
        norms.push(0, 1, 0, 0, 1, 0);
        uvs.push(0, i / samples, 1, i / samples);
      }
      for (let i = 0; i < samples; i++) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute('normal',   new THREE.Float32BufferAttribute(norms, 3));
      g.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, material);
      seg.add(m);
      return m;
    };

    // Player's side (positive X relative to centerline): from +median/2 to +halfRoadWidth
    buildRibbon( medianW / 2,  halfRoadWidth, this._asphaltMat, 0.005);
    // Oncoming side: from -halfRoadWidth to -median/2
    buildRibbon(-halfRoadWidth, -medianW / 2, this._asphaltMat, 0.005);

    // Median (grass strip)
    buildRibbon(-medianW / 2, medianW / 2, this._medianMat, 0.0);

    // Median concrete divider in the middle of the median (low wall)
    const buildBarrierStrip = (offset, width, height, material) => {
      const verts = [], norms = [], idx = [];
      // 4 vertices per rib (top-left, top-right, bottom-left, bottom-right)
      for (let i = 0; i <= samples; i++) {
        const r = ribs[i];
        const lx = r.cx + r.lx * (offset - width / 2);
        const lz = r.localZ + r.lz * (offset - width / 2);
        const rx = r.cx + r.lx * (offset + width / 2);
        const rz = r.localZ + r.lz * (offset + width / 2);
        // top edge
        verts.push(lx, height, lz);
        verts.push(rx, height, rz);
        // bottom edge (ground)
        verts.push(lx, 0,      lz);
        verts.push(rx, 0,      rz);
        norms.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
      }
      // Faces: 4 verts per rib (TL, TR, BL, BR). For each pair of ribs we
      // make 5 quads: top + left side + right side + front cap + back cap.
      // Simpler: just sides + top.
      for (let i = 0; i < samples; i++) {
        const a = i * 4;
        const b = (i + 1) * 4;
        // Top quad
        idx.push(a, b, a + 1, a + 1, b, b + 1);
        // Left side
        idx.push(a, a + 2, b, b, a + 2, b + 2);
        // Right side
        idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute('normal',   new THREE.Float32BufferAttribute(norms, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, material);
      seg.add(m);
    };
    buildBarrierStrip(0, 0.5, 0.7, this._dividerMat);

    // Edge barriers (outer edges of each carriageway)
    buildBarrierStrip( halfRoadWidth + 0.4, 0.6, 0.9, this._barrierMat);
    buildBarrierStrip(-halfRoadWidth - 0.4, 0.6, 0.9, this._barrierMat);

    // ----- Lane divider dashes (dashed white per direction) -----
    // Player's side: between lane positions
    for (let s = 0; s < 2; s++) {
      for (let lane = 1; lane < lanesPerSide; lane++) {
        const sideSign = s === 0 ? 1 : -1;
        const offset = sideSign * (medianW / 2 + lane * laneW);
        this._addDashedLine(seg, ribs, offset, 0.12, this._lineMat);
      }
      // Innermost edge line (next to median) — solid yellow
      this._addSolidStripe(seg, ribs, (s === 0 ? 1 : -1) * (medianW / 2 + 0.04), 0.14, this._edgeMat);
    }

    // ----- City blocks + sparse trees on each side -----
    this._scatterBuildings(seg, segZ);
    this._scatterTrees(seg, segZ);

    // Streetlights every other segment
    if (Math.floor(-segZ / segLen) % 2 === 0) {
      this._addStreetlights(seg, ribs, halfRoadWidth);
    }
  }

  _addDashedLine(seg, ribs, offset, width, material) {
    const samples = ribs.length - 1;
    const dashCount = 6;
    // Each dash is one quad spanning ~1/dashCount of the segment length
    for (let d = 0; d < dashCount; d++) {
      const t0 = (d * 2) / (dashCount * 2);
      const t1 = (d * 2 + 1) / (dashCount * 2);
      const i0 = Math.round(t0 * samples);
      const i1 = Math.max(i0 + 1, Math.round(t1 * samples));
      const verts = [], idx = [];
      for (let i = i0; i <= i1; i++) {
        const r = ribs[i];
        const lx = r.cx + r.lx * (offset - width / 2);
        const lz = r.localZ + r.lz * (offset - width / 2);
        const rx = r.cx + r.lx * (offset + width / 2);
        const rz = r.localZ + r.lz * (offset + width / 2);
        verts.push(lx, 0.012, lz, rx, 0.012, rz);
      }
      for (let i = 0; i < i1 - i0; i++) {
        const a = i * 2, b = a + 1, c = a + 2, dd = a + 3;
        idx.push(a, c, b, b, c, dd);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, material);
      seg.add(m);
    }
  }

  _addSolidStripe(seg, ribs, offset, width, material) {
    const samples = ribs.length - 1;
    const verts = [], idx = [];
    for (let i = 0; i <= samples; i++) {
      const r = ribs[i];
      const lx = r.cx + r.lx * (offset - width / 2);
      const lz = r.localZ + r.lz * (offset - width / 2);
      const rx = r.cx + r.lx * (offset + width / 2);
      const rz = r.localZ + r.lz * (offset + width / 2);
      verts.push(lx, 0.013, lz, rx, 0.013, rz);
    }
    for (let i = 0; i < samples; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    seg.add(m);
  }

  _addStreetlights(seg, ribs, halfRoadWidth) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x44505a, metalness: 0.6, roughness: 0.5 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3c8 });
    // One pole per side at the segment midpoint
    const r = ribs[Math.floor(ribs.length / 2)];
    for (const sign of [-1, 1]) {
      const x = r.cx + r.lx * sign * (halfRoadWidth + 2.5);
      const z = r.localZ + r.lz * sign * (halfRoadWidth + 2.5);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.16, 8, 8), poleMat,
      );
      pole.position.set(x, 4, z);
      seg.add(pole);
      const lamp = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 12, 8), lampMat,
      );
      lamp.position.set(x + (sign < 0 ? 0.8 : -0.8), 7.8, z);
      seg.add(lamp);
    }
  }

  _scatterBuildings(seg, segZ) {
    const segLen = WORLD.roadSegmentLength;
    const lanesPerSide = WORLD.lanesPerSide;
    const halfRoadWidth = lanesPerSide * WORLD.laneWidth + WORLD.medianWidth / 2;
    const buildingsPerSide = 5;

    for (let side = -1; side <= 1; side += 2) {
      for (let b = 0; b < buildingsPerSide; b++) {
        const w = 8 + Math.random() * 14;
        const h = 16 + Math.random() * 80;
        const d = 9 + Math.random() * 14;
        const localZ = -Math.random() * segLen;
        const worldZ = segZ + localZ;
        const baseX = centerlineX(worldZ);
        // Push side outward by the road edge + first-building offset + extra spread
        const lat = side * (halfRoadWidth + WORLD.cityBlockOffsetX + b * 14 + Math.random() * 6);
        const bldgX = baseX + lat;
        const bldgZ = localZ;

        // Building body — dark with random hue tint
        const hue = 0.55 + Math.random() * 0.3;
        const sat = 0.05 + Math.random() * 0.12;
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(hue, sat, 0.18 + Math.random() * 0.08),
          roughness: 0.7,
          metalness: 0.05,
        });
        const bldg = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        bldg.position.set(bldgX, h / 2, bldgZ);
        seg.add(bldg);

        // Lit windows: small emissive panels stuck to the front face
        const winRows = Math.floor(h / 4);
        const winCols = Math.floor(w / 2.5);
        const winColor = new THREE.Color().setHSL(0.12 + Math.random() * 0.12, 0.6, 0.55);
        const winMat = new THREE.MeshBasicMaterial({ color: winColor });
        // A thin emissive box across the building's road-facing face
        const winGeo = new THREE.PlaneGeometry(0.9, 1.4);
        for (let r = 0; r < winRows; r++) {
          for (let c = 0; c < winCols; c++) {
            if (Math.random() > 0.55) continue; // not every window is lit
            const wp = new THREE.Mesh(winGeo, winMat);
            const wx = (c - (winCols - 1) / 2) * 2.5;
            const wy = (r + 0.5) * (h / winRows) - h / 2;
            wp.position.set(wx, wy, side > 0 ? -d / 2 - 0.02 : d / 2 + 0.02);
            wp.rotation.y = side > 0 ? Math.PI : 0;
            bldg.add(wp);
          }
        }
      }
    }
  }

  _scatterTrees(seg, segZ) {
    // Cheap procedural trees in the gaps between buildings — gives the
    // street some greenery without needing a GLB asset.
    const segLen = WORLD.roadSegmentLength;
    const halfRoadWidth = WORLD.lanesPerSide * WORLD.laneWidth + WORLD.medianWidth / 2;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.95 });
    const leafMat  = new THREE.MeshStandardMaterial({ color: 0x2f5a25, roughness: 0.85, flatShading: true });
    for (let i = 0; i < 8; i++) {
      const localZ = -Math.random() * segLen;
      const worldZ = segZ + localZ;
      const baseX = centerlineX(worldZ);
      const side = Math.random() < 0.5 ? -1 : 1;
      const lat = side * (halfRoadWidth + 4 + Math.random() * 12);
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6), trunkMat,
      );
      trunk.position.y = 1.2;
      tree.add(trunk);
      const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(1.6, 4.0, 6), leafMat,
      );
      leaves.position.y = 3.6;
      tree.add(leaves);
      tree.position.set(baseX + lat, 0, localZ);
      tree.rotation.y = Math.random() * Math.PI * 2;
      seg.add(tree);
    }
  }

  update(playerZ) {
    const segLen = WORLD.roadSegmentLength;
    const behindThreshold = playerZ + segLen * 2;
    for (const s of this.segments) {
      while (s.position.z > behindThreshold) {
        s.position.z -= WORLD.visibleSegments * segLen;
        // Rebuild geometry for the curve at the new world Z
        this._buildSegmentGeometry(s, s.position.z);
      }
    }
  }
}
