// All tunables in one place. Units: meters, seconds, m/s.

export const WORLD = {
  laneWidth: 3.5,
  lanesPerSide: 2,        // 2 + 2 = 4 lanes total (narrower than before)
  medianWidth: 4,         // grass median between the two directions
  laneDirection: -1,      // player drives -Z
  roadSegmentLength: 80,
  visibleSegments: 16,
  segmentCurveSamples: 12, // sub-quads per segment along the curve
  groundColor: 0x35402b,
  // Multi-stop sky gradient (top → mid → low → horizon)
  skyTop: 0x4a96ec,
  skyMid: 0x8ec5f0,
  skyLow: 0xc9def0,
  skyHorizon: 0xf3e5cc,
  fogColor: 0xcfd9e0,
  fogNear: 120,
  fogFar: 1500,
  cityBlockOffsetX: 22,   // distance from road centerline to first building row
};

// Highway centerline curvature — sum of two sin waves keeps it gentle.
// Player can stay in their lane by countersteering; tight enough to feel
// like a real highway with sweeping bends.
export const CURVE = {
  ampA: 80,  freqA: 0.0009,
  ampB: 35,  freqB: 0.0022,
};

export function centerlineX(z) {
  return CURVE.ampA * Math.sin(z * CURVE.freqA) + CURVE.ampB * Math.sin(z * CURVE.freqB);
}

// Tangent vector at z (unit-length on the XZ plane). Used for orienting
// road geometry, barriers, and traffic relative to the curving centerline.
export function centerlineTangent(z) {
  const dx = CURVE.ampA * CURVE.freqA * Math.cos(z * CURVE.freqA)
           + CURVE.ampB * CURVE.freqB * Math.cos(z * CURVE.freqB);
  // dz component is 1 along z; normalise
  const len = Math.hypot(dx, 1);
  return { x: dx / len, z: 1 / len };
}

export const CAR = {
  mass: 1200,
  // Throttle / brake
  maxAccel: 18,           // m/s² at zero speed (eases off with speed)
  brakeAccel: 32,         // m/s² when braking
  reverseAccel: 8,
  dragCoef: 0.0006,       // velocity-squared drag
  rollingResist: 0.6,     // base m/s² when coasting
  topSpeed: 110,          // m/s (~395 km/h)
  boostMul: 1.45,         // shift multiplier on throttle
  // Steering — yaw rate uses a hyperbolic falloff so steering gets
  // noticeably worse the faster you go. Lower yawHalfSpeed means the
  // curve is steeper: much more authority at low speed, gentler at high.
  maxSteer: 0.55,         // radians, smoothed input target
  steerLerp: 7,           // how fast steer angle eases toward input
  yawAtRest: 70,          // numerator of yaw curve (rad/s scale)
  yawHalfSpeed: 30,       // at this speed, yaw authority halves from zero-speed value
  // Grip / drift
  lateralGrip: 6.5,       // how aggressively sideways speed bleeds off
  handbrakeGripMul: 0.18, // grip multiplier while handbrake held
  // Body
  length: 4.5,
  width: 1.9,
  height: 1.3,
};

export const TRAFFIC = {
  count: 32,                  // 16 each direction, more dense feel
  spawnDistAhead: 700,
  recycleDistBehind: 150,
  speedMin: 28,
  speedMax: 52,
  laneChangeChance: 0.0010,
  oncomingFraction: 0.5,      // half the traffic goes opposite direction
};

export const CAMERA = {
  chaseBack: 8,
  chaseUp: 3.0,
  chaseLookAhead: 6,      // (used only on hood-view fallback now)
  lerp: 8,
  fovBase: 65,
  fovBoost: 88,           // FOV widens at top speed for sensation
};
