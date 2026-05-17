// All tunables in one place. Units: meters, seconds, m/s.

export const WORLD = {
  laneWidth: 4,
  numLanes: 6,            // 3 each direction (we use all 6 going same way for nohesi feel)
  laneDirection: -1,      // forward = -Z
  roadSegmentLength: 80,
  visibleSegments: 14,    // segments rendered ahead/behind
  groundColor: 0x0d1118,
  skyTop: 0x081225,
  skyBottom: 0x1d2848,
  fogColor: 0x0e1424,
  fogNear: 80,
  fogFar: 900,
  cityBlockSpacing: 38,   // distance between building rows
  cityBlockOffsetX: 26,   // distance from road center to first building
};

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
  // noticeably worse the faster you go.
  maxSteer: 0.55,         // radians, smoothed input target
  steerLerp: 7,           // how fast steer angle eases toward input
  yawAtRest: 60,          // numerator of yaw curve (rad/s scale)
  yawHalfSpeed: 50,       // at this speed, yaw authority is half of zero-speed value
  // Grip / drift
  lateralGrip: 6.5,       // how aggressively sideways speed bleeds off
  handbrakeGripMul: 0.18, // grip multiplier while handbrake held
  // Body
  length: 4.5,
  width: 1.9,
  height: 1.3,
};

export const TRAFFIC = {
  count: 28,
  spawnDistAhead: 700,
  recycleDistBehind: 120,
  speedMin: 30,           // m/s
  speedMax: 55,
  laneChangeChance: 0.0015,  // per frame chance
};

export const CAMERA = {
  chaseBack: 9,
  chaseUp: 3.4,
  chaseLookAhead: 6,
  lerp: 8,
  fovBase: 70,
  fovBoost: 90,           // FOV widens at top speed for sensation
};
