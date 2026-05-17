import * as THREE from 'three';
import { WORLD } from './config.js';

// Recycling segmented road. The road is a long set of segments laid along -Z;
// as the player moves forward, the segments that fell behind get re-placed
// far ahead, giving an "endless" highway with constant memory.

export class World {
  constructor(scene) {
    this.scene = scene;
    scene.background = this._makeSkyTexture();
    scene.fog = new THREE.Fog(WORLD.fogColor, WORLD.fogNear, WORLD.fogFar);

    // Lights
    const sun = new THREE.DirectionalLight(0xffe6c8, 0.8);
    sun.position.set(-0.4, 1.0, -0.2).normalize().multiplyScalar(500);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x6080c0, 0x101418, 0.65));

    // Ground (very large, behind road and around it)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: WORLD.groundColor, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);

    // Segments
    this.segments = [];
    this.startZ = 0; // Z position of segment[0]
    const segLength = WORLD.roadSegmentLength;
    for (let i = 0; i < WORLD.visibleSegments; i++) {
      const seg = this._buildSegment(i);
      seg.position.z = -i * segLength;
      scene.add(seg);
      this.segments.push(seg);
    }
  }

  _makeSkyTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    const top = new THREE.Color(WORLD.skyTop);
    const bot = new THREE.Color(WORLD.skyBottom);
    grad.addColorStop(0, `rgb(${top.r * 255 | 0},${top.g * 255 | 0},${top.b * 255 | 0})`);
    grad.addColorStop(1, `rgb(${bot.r * 255 | 0},${bot.g * 255 | 0},${bot.b * 255 | 0})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 4, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  _buildSegment(idx) {
    const group = new THREE.Group();
    const segLen = WORLD.roadSegmentLength;
    const roadWidth = WORLD.laneWidth * WORLD.numLanes;

    // Asphalt
    const asphalt = new THREE.Mesh(
      new THREE.PlaneGeometry(roadWidth, segLen),
      new THREE.MeshStandardMaterial({ color: 0x191a1f, roughness: 0.9 }),
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.set(0, 0.001, -segLen / 2);
    group.add(asphalt);

    // Lane lines (white dashed for inner, solid for edges)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xeef4ff });
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xffd96b });
    // Edge solids
    for (const sx of [-roadWidth / 2 + 0.15, roadWidth / 2 - 0.15]) {
      const edge = new THREE.Mesh(
        new THREE.PlaneGeometry(0.18, segLen),
        edgeMat,
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(sx, 0.005, -segLen / 2);
      group.add(edge);
    }
    // Lane dividers (dashed)
    for (let i = 1; i < WORLD.numLanes; i++) {
      const x = -roadWidth / 2 + i * WORLD.laneWidth;
      const dashCount = 6;
      const dashLen = segLen / (dashCount * 2);
      for (let d = 0; d < dashCount; d++) {
        const dash = new THREE.Mesh(
          new THREE.PlaneGeometry(0.12, dashLen),
          lineMat,
        );
        dash.rotation.x = -Math.PI / 2;
        dash.position.set(x, 0.005, -segLen / 2 - dashLen * (d * 2 - dashCount + 0.5));
        group.add(dash);
      }
    }

    // Side barriers
    const barMat = new THREE.MeshStandardMaterial({ color: 0xb3bcc6, roughness: 0.55, metalness: 0.4 });
    for (const sx of [-roadWidth / 2 - 0.5, roadWidth / 2 + 0.5]) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.9, segLen),
        barMat,
      );
      bar.position.set(sx, 0.45, -segLen / 2);
      group.add(bar);
    }

    // Streetlights (every other segment)
    if (idx % 2 === 0) {
      for (const sx of [-roadWidth / 2 - 2.5, roadWidth / 2 + 2.5]) {
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.12, 0.16, 8, 8),
          new THREE.MeshStandardMaterial({ color: 0x44505a, metalness: 0.6, roughness: 0.5 }),
        );
        pole.position.set(sx, 4, -segLen / 2);
        group.add(pole);
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.45, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xfff3c8 }),
        );
        lamp.position.set(sx + (sx < 0 ? 0.8 : -0.8), 7.8, -segLen / 2);
        group.add(lamp);
      }
    }

    // City buildings on each side (boxes with random heights / hues)
    const buildingsPerSide = 4;
    for (let side = -1; side <= 1; side += 2) {
      for (let b = 0; b < buildingsPerSide; b++) {
        const w = 8 + Math.random() * 10;
        const h = 14 + Math.random() * 60;
        const d = 8 + Math.random() * 12;
        const bx = side * (WORLD.cityBlockOffsetX + b * 14 + Math.random() * 4);
        const bz = -segLen / 2 - segLen / 2 + Math.random() * segLen;
        const hueTint = 0.55 + Math.random() * 0.25;
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(0.6, 0.1, hueTint * 0.25),
          roughness: 0.65,
          emissive: new THREE.Color().setHSL(0.13 + Math.random() * 0.1, 0.6, 0.05),
        });
        const bldg = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        bldg.position.set(bx, h / 2, bz);
        group.add(bldg);
      }
    }

    return group;
  }

  // Reposition segments that have fallen far behind the player.
  update(playerZ) {
    const segLen = WORLD.roadSegmentLength;
    // The visible window is from playerZ - 2*segLen (behind) to playerZ - visibleSegments*segLen (ahead).
    // Any segment whose z > playerZ + segLen is "behind" and should jump ahead.
    let furthestZ = -Infinity;
    for (const s of this.segments) {
      if (s.position.z > furthestZ) furthestZ = s.position.z;
    }
    const behindThreshold = playerZ + segLen * 2;
    for (const s of this.segments) {
      while (s.position.z > behindThreshold) {
        // Move past the furthest segment ahead
        s.position.z -= WORLD.visibleSegments * segLen;
        // Re-randomize the building positions inside this segment so the world
        // doesn't visibly repeat too obviously.
        for (const child of s.children) {
          if (child.material && child.material.emissive && child.geometry.type === 'BoxGeometry') {
            // Only re-randomize buildings (have emissive); skip road/barriers
            // (this is a heuristic — fine for the placeholder city)
            child.material.emissive = new THREE.Color().setHSL(0.13 + Math.random() * 0.1, 0.6, 0.05);
          }
        }
      }
    }
  }
}
