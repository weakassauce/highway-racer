import * as THREE from 'three';
import { WORLD, CURVE, centerlineX, centerlineTangent } from './config.js';

// ----- Procedural canvas textures -----
// All are square, sRGB, and set to REPEAT so they tile across the road / median.

function makeAsphaltTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3a3c40';
  ctx.fillRect(0, 0, 256, 256);
  // Aggregate speckle: ~8000 tiny dark + light dots
  for (let i = 0; i < 8000; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const v = (Math.random() - 0.5) * 36;
    const r = 58 + v, g = 60 + v, b = 64 + v;
    ctx.fillStyle = `rgb(${r|0},${g|0},${b|0})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  // Occasional pothole / patch
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(20, 20, 24, ${0.2 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 24);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#5d7a40';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const v = (Math.random() - 0.5) * 30;
    ctx.fillStyle = `rgb(${93 + v | 0},${122 + v | 0},${64 + v | 0})`;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(170, 200, 90, ${0.3 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 14);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeConcreteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c8ccd2';
  ctx.fillRect(0, 0, 256, 256);
  // Subtle speckle
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const v = (Math.random() - 0.5) * 18;
    ctx.fillStyle = `rgb(${200 + v | 0},${204 + v | 0},${210 + v | 0})`;
    ctx.fillRect(x, y, 1, 1);
  }
  // Vertical seams every ~30 px (precast Jersey segments)
  ctx.strokeStyle = 'rgba(70, 70, 80, 0.4)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 256; x += 32) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, 256); ctx.stroke();
  }
  // Occasional crack
  for (let i = 0; i < 12; i++) {
    ctx.strokeStyle = `rgba(40, 40, 50, ${0.3 + Math.random() * 0.3})`;
    ctx.beginPath();
    const sx = Math.random() * 256, sy = Math.random() * 256;
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + (Math.random() - 0.5) * 30, sy + (Math.random() - 0.5) * 30);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 12);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Curved, two-direction highway. Each segment renders a ribbon of N
// sub-quads following centerlineX(z), plus dashed lane lines, a grass
// median, edge barriers, streetlights, and city blocks either side.
//
// Recycling: when a segment falls more than 2× segLen behind the player,
// it jumps ahead and its geometry is rebuilt for the new world Z.

export class World {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.buildingTemplates = opts.buildingTemplates || []; // array of {root, targetHeight}
    this.treeTemplate = opts.treeTemplate || null;          // GLB scene to clone for trees
    this.streetlightTemplate = opts.streetlightTemplate || null; // GLB scene to clone for lamps
    scene.background = this._makeSkyTexture();
    scene.fog = new THREE.Fog(WORLD.fogColor, WORLD.fogNear, WORLD.fogFar);

    // Brighter daylight sun + warmer sky hemi
    const sun = new THREE.DirectionalLight(0xfff4d6, 1.5);
    sun.position.set(-0.4, 1.0, -0.2).normalize().multiplyScalar(500);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xa3c8ff, 0x4a4a3a, 1.0));

    // Big dark ground plane that fills the world beyond the highway
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.MeshStandardMaterial({ color: WORLD.groundColor, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    scene.add(ground);

    // Procedural noise textures so the road and grass don't read as flat colour.
    const asphaltTex = makeAsphaltTexture();
    const grassTex   = makeGrassTexture();
    const concreteTex = makeConcreteTexture();
    this._asphaltMat = new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x3a3c40, roughness: 0.95 });
    this._lineMat    = new THREE.MeshBasicMaterial({ color: 0xeef4ff });
    this._edgeMat    = new THREE.MeshBasicMaterial({ color: 0xffd96b });
    this._medianMat  = new THREE.MeshStandardMaterial({ map: grassTex,   color: 0x5d7a40, roughness: 0.95 });
    this._barrierMat = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xc8ccd2, roughness: 0.7, metalness: 0.05 });
    this._dividerMat = new THREE.MeshStandardMaterial({ map: concreteTex, color: 0xd5d8de, roughness: 0.75 });

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
    const hx = (v) => {
      const c2 = new THREE.Color(v);
      return `rgb(${c2.r*255|0},${c2.g*255|0},${c2.b*255|0})`;
    };
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.00, hx(WORLD.skyTop));      // zenith
    g.addColorStop(0.45, hx(WORLD.skyMid));      // mid-sky
    g.addColorStop(0.82, hx(WORLD.skyLow));      // lower band
    g.addColorStop(1.00, hx(WORLD.skyHorizon));  // warm horizon
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
    // Solid Jersey-style median barrier — taller + wider than before so it
    // visually separates the two carriageways and stops cars from crossing.
    buildBarrierStrip(0, 1.0, 1.1, this._dividerMat);

    // Edge barriers (outer edges of each carriageway)
    buildBarrierStrip( halfRoadWidth + 0.4, 0.6, 0.95, this._barrierMat);
    buildBarrierStrip(-halfRoadWidth - 0.4, 0.6, 0.95, this._barrierMat);

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
    const segIdx = Math.floor(-segZ / segLen);
    if (segIdx % 2 === 0) {
      this._addStreetlights(seg, ribs, halfRoadWidth);
    }
    // Overpass bridge every 7 segments (~560 m apart)
    if (segIdx % 7 === 3) {
      this._addOverpass(seg, ribs, halfRoadWidth);
    }
    // Offramp every 9 segments, alternating sides
    if (segIdx % 9 === 5) {
      const side = (segIdx % 18 === 5) ? 1 : -1;
      this._addOfframp(seg, ribs, halfRoadWidth, side);
    }
  }

  // Concrete overpass spanning across the highway perpendicular to direction
  // of travel. Two pillars per side, a thick deck, railings on top.
  _addOverpass(seg, ribs, halfRoadWidth) {
    const mid = ribs[Math.floor(ribs.length / 2)];
    const cx = mid.cx;
    const lz = mid.localZ;
    // Tangent + perpendicular along the curve, so the deck sits square with
    // the road even on a bend.
    const tx = mid.lz, tz = -mid.lx; // perpendicular to lateral = forward
    const px = mid.lx,  pz = mid.lz;  // lateral (across the road)

    // Neutral concrete grey — no warm/cool tint so the overpass reads as
    // a plain highway bridge rather than a coloured structure.
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x808286, roughness: 0.85 });
    const deckMat   = new THREE.MeshStandardMaterial({ color: 0x6e7074, roughness: 0.85 });

    const clearance = 7.5;
    const deckW = 7;          // depth of the deck along road direction
    const deckThick = 1.4;
    const deckLen = (halfRoadWidth + 14) * 2; // span across road + abutments

    // 4 pillars, one at each outboard corner of the deck
    for (const sideSign of [-1, 1]) {
      for (const longSign of [-1, 1]) {
        const px2 = cx + px * sideSign * (halfRoadWidth + 4) + tx * longSign * (deckW / 2 - 0.5);
        const pz2 = lz + pz * sideSign * (halfRoadWidth + 4) + tz * longSign * (deckW / 2 - 0.5);
        const pillar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 1.1, clearance + 0.7, 10),
          pillarMat,
        );
        pillar.position.set(px2, (clearance + 0.7) / 2, pz2);
        seg.add(pillar);
      }
    }

    // Deck — wide box. Rotate to follow the road tangent.
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(deckLen, deckThick, deckW),
      deckMat,
    );
    deck.position.set(cx, clearance + deckThick / 2, lz);
    deck.rotation.y = Math.atan2(tx, tz);
    seg.add(deck);

    // Railings on both edges of the deck (along road direction)
    for (const edgeSign of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(deckLen, 1.0, 0.25),
        this._dividerMat,
      );
      rail.position.set(
        cx + tx * edgeSign * (deckW / 2 - 0.15),
        clearance + deckThick + 0.5,
        lz + tz * edgeSign * (deckW / 2 - 0.15),
      );
      rail.rotation.y = Math.atan2(tx, tz);
      seg.add(rail);
    }

    // Descending approach ramps on each outboard side of the deck. Without
    // these the deck reads as a floating slab; with them you get the proper
    // "road crosses over the highway and slopes down to ground level" look.
    const bridgeTopY = clearance + deckThick;
    const rampLen   = 38;            // horizontal run from deck edge down to ground
    const halfDeckSpan = deckLen / 2; // outboard distance from highway centerline
    const halfRoadDepth = deckW / 2 - 0.3; // ramp width matches deck width
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x42454a, roughness: 0.92 });
    const railLowMat = new THREE.MeshStandardMaterial({ color: 0x808286, roughness: 0.8 });

    for (const sideSign of [-1, 1]) {
      // Top edge: outboard end of the deck
      const topCx = cx + px * sideSign * halfDeckSpan;
      const topCz = lz + pz * sideSign * halfDeckSpan;
      // Bottom edge: rampLen further out, at ground level
      const botCx = cx + px * sideSign * (halfDeckSpan + rampLen);
      const botCz = lz + pz * sideSign * (halfDeckSpan + rampLen);

      const tlx = topCx + tx * -halfRoadDepth, tlz = topCz + tz * -halfRoadDepth;
      const trx = topCx + tx *  halfRoadDepth, trz = topCz + tz *  halfRoadDepth;
      const blx = botCx + tx * -halfRoadDepth, blz = botCz + tz * -halfRoadDepth;
      const brx = botCx + tx *  halfRoadDepth, brz = botCz + tz *  halfRoadDepth;

      // Sloped quad (asphalt)
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute([
        tlx, bridgeTopY, tlz,
        trx, bridgeTopY, trz,
        blx, 0.02,       blz,
        brx, 0.02,       brz,
      ], 3));
      rg.setIndex([0, 2, 1, 1, 2, 3]);
      rg.computeVertexNormals();
      seg.add(new THREE.Mesh(rg, rampMat));

      // Low concrete safety wall along both edges of the ramp — 4-vert ribbons
      // that follow the slope so the wall sits flush on the asphalt.
      for (const railSign of [-1, 1]) {
        const inset = halfRoadDepth - 0.1;
        const txi = tx * railSign * inset, tzi = tz * railSign * inset;
        const t0x = topCx + txi, t0z = topCz + tzi;
        const b0x = botCx + txi, b0z = botCz + tzi;
        const railHeight = 0.85;
        const wall = new THREE.BufferGeometry();
        wall.setAttribute('position', new THREE.Float32BufferAttribute([
          t0x, bridgeTopY + railHeight, t0z, // top-top
          t0x, bridgeTopY,              t0z, // top-bottom (deck side)
          b0x, 0.02 + railHeight,       b0z, // bot-top
          b0x, 0.02,                    b0z, // bot-bottom (ground side)
        ], 3));
        wall.setIndex([0, 1, 2, 1, 3, 2]);
        wall.computeVertexNormals();
        seg.add(new THREE.Mesh(wall, railLowMat));
      }
    }
  }

  // Visual offramp: an asphalt ribbon that peels away from the carriageway
  // edge, lined with Jersey barriers on the outside. side = +1 or -1.
  _addOfframp(seg, ribs, halfRoadWidth, side) {
    const samples = ribs.length - 1;
    const startI = Math.floor(samples * 0.15);
    const endI   = samples;
    const rampWidth = 4.2;
    const maxOut   = 14; // how far the ramp peels off the highway by segment-end

    // Asphalt ribbon — quadratic-ease so the ramp gradually breaks away
    const ramp = { verts: [], idx: [] };
    const leftEdge  = { verts: [], idx: [] }; // outer Jersey barrier strip
    for (let i = startI; i <= endI; i++) {
      const r = ribs[i];
      const t = (i - startI) / (endI - startI);
      const eased = t * t; // grows slowly then faster
      const inner = side * (halfRoadWidth + 0.6 + eased * maxOut);
      const outer = inner + side * rampWidth;
      const yLift = 0.007;
      ramp.verts.push(
        r.cx + r.lx * inner, yLift, r.localZ + r.lz * inner,
        r.cx + r.lx * outer, yLift, r.localZ + r.lz * outer,
      );
      // outer barrier rib
      leftEdge.verts.push(outer, r.cx, r.lx, r.localZ, r.lz);
    }
    const span = endI - startI;
    for (let i = 0; i < span; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      ramp.idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ramp.verts, 3));
    g.setIndex(ramp.idx);
    g.computeVertexNormals();
    seg.add(new THREE.Mesh(g, this._asphaltMat));

    // Jersey barrier strip along the outer edge of the ramp.
    const bv = [], bi = [];
    const barrierH = 0.9, barrierW = 0.4;
    for (let i = 0; i < leftEdge.verts.length; i += 5) {
      const outerOffset = leftEdge.verts[i];
      const cx = leftEdge.verts[i + 1];
      const lx = leftEdge.verts[i + 2];
      const z0 = leftEdge.verts[i + 3];
      const lz = leftEdge.verts[i + 4];
      const oInner = outerOffset + side * 0.05;
      const oOuter = outerOffset + side * (0.05 + barrierW);
      const xI = cx + lx * oInner, zI = z0 + lz * oInner;
      const xO = cx + lx * oOuter, zO = z0 + lz * oOuter;
      bv.push(xI, barrierH, zI, xO, barrierH, zO, xI, 0, zI, xO, 0, zO);
    }
    const nRibs = leftEdge.verts.length / 5;
    for (let i = 0; i < nRibs - 1; i++) {
      const a = i * 4, b = (i + 1) * 4;
      // top + outer face + inner face
      bi.push(a, b, a + 1, a + 1, b, b + 1);
      bi.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
      bi.push(a, a + 2, b, b, a + 2, b + 2);
    }
    const gb = new THREE.BufferGeometry();
    gb.setAttribute('position', new THREE.Float32BufferAttribute(bv, 3));
    gb.setIndex(bi);
    gb.computeVertexNormals();
    seg.add(new THREE.Mesh(gb, this._dividerMat));
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
    // One pole per side at the segment midpoint. If the streetlight GLB is
    // loaded, clone it; otherwise fall back to a stick + sphere so the
    // missing-asset case still looks like SOMETHING.
    const r = ribs[Math.floor(ribs.length / 2)];
    const tpl = this.streetlightTemplate;

    for (const sign of [-1, 1]) {
      const x = r.cx + r.lx * sign * (halfRoadWidth + 2.5);
      const z = r.localZ + r.lz * sign * (halfRoadWidth + 2.5);
      if (tpl) {
        const inst = tpl.clone(true);
        inst.position.set(x, 0, z);
        // Rotate so the curved arm reaches OVER the road (toward the
        // highway centerline). The GLB faces +X by convention; flip 180°
        // on the right side so both arms point inward.
        inst.rotation.y = sign < 0 ? 0 : Math.PI;
        seg.add(inst);
      } else {
        const poleMat = new THREE.MeshStandardMaterial({ color: 0x44505a, metalness: 0.6, roughness: 0.5 });
        const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff3c8 });
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
  }

  _scatterBuildings(seg, segZ) {
    const segLen = WORLD.roadSegmentLength;
    const lanesPerSide = WORLD.lanesPerSide;
    const halfRoadWidth = lanesPerSide * WORLD.laneWidth + WORLD.medianWidth / 2;
    const buildingsPerSide = 5;
    const templates = this.buildingTemplates || [];

    for (let side = -1; side <= 1; side += 2) {
      for (let b = 0; b < buildingsPerSide; b++) {
        const localZ = -Math.random() * segLen;
        const worldZ = segZ + localZ;
        const baseX = centerlineX(worldZ);
        const spacing = WORLD.cityBlockSpacing || 14;
        const lat = side * (halfRoadWidth + WORLD.cityBlockOffsetX + b * spacing + Math.random() * 8);
        const bldgX = baseX + lat;
        const bldgZ = localZ;

        // If we have GLB building templates, clone one of them at random and
        // place it; otherwise drop a procedural lit-window box like before.
        if (templates.length > 0 && Math.random() < 0.85) {
          const tpl = templates[Math.floor(Math.random() * templates.length)];
          const inst = tpl.root.clone(true);
          // The cloned template ALREADY has scale=target_height/source_height
          // applied by normalizeBuildingModel. Multiply (don't overwrite!)
          // by a per-instance jitter so each clone is a slightly different
          // size — overwriting was killing the target-height scale and
          // making the buildings appear at their original tiny GLB size.
          const s = 0.85 + Math.random() * 0.8;
          inst.scale.multiplyScalar(s);
          inst.rotation.y = (side > 0 ? Math.PI : 0) + (Math.random() - 0.5) * 0.3;
          inst.position.set(bldgX, 0, bldgZ); // y handled inside the template (bottom at 0)
          seg.add(inst);
          continue;
        }

        const w = 8 + Math.random() * 14;
        const h = 16 + Math.random() * 80;
        const d = 9 + Math.random() * 14;
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
        const winRows = Math.floor(h / 4);
        const winCols = Math.floor(w / 2.5);
        const winColor = new THREE.Color().setHSL(0.12 + Math.random() * 0.12, 0.6, 0.55);
        const winMat = new THREE.MeshBasicMaterial({ color: winColor });
        const winGeo = new THREE.PlaneGeometry(0.9, 1.4);
        for (let r = 0; r < winRows; r++) {
          for (let c = 0; c < winCols; c++) {
            if (Math.random() > 0.55) continue;
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

  // Refresh all segments with new building templates (or other state).
  // Cheap because terrain is the heavy bit and that's untouched.
  rebuildSegments() {
    for (const seg of this.segments) {
      this._buildSegmentGeometry(seg, seg.position.z);
    }
  }

  _scatterTrees(seg, segZ) {
    const segLen = WORLD.roadSegmentLength;
    const halfRoadWidth = WORLD.lanesPerSide * WORLD.laneWidth + WORLD.medianWidth / 2;
    const tpl = this.treeTemplate;

    // If we have the GLB tree template, clone it. Otherwise fall back to
    // a cheap cone+cylinder so a missing asset still gives some greenery.
    const trunkMat = !tpl && new THREE.MeshStandardMaterial({ color: 0x4a2f1a, roughness: 0.95 });
    const leafMat  = !tpl && new THREE.MeshStandardMaterial({ color: 0x2f5a25, roughness: 0.85, flatShading: true });

    for (let i = 0; i < 10; i++) {
      const localZ = -Math.random() * segLen;
      const worldZ = segZ + localZ;
      const baseX = centerlineX(worldZ);
      const side = Math.random() < 0.5 ? -1 : 1;
      const lat = side * (halfRoadWidth + 5 + Math.random() * 14);
      const x = baseX + lat;

      let tree;
      if (tpl) {
        tree = tpl.clone(true);
        const s = 0.7 + Math.random() * 0.8; // 0.7-1.5 scale variation
        tree.scale.multiplyScalar(s);
      } else {
        tree = new THREE.Group();
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
      }
      tree.position.set(x, 0, localZ);
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
