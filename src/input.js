// Keyboard + mouse-look input. Hold right-mouse to orbit the camera around
// the car; release and the camera eases back to its default chase pose.

const LOOK_SENSITIVITY = 0.003; // radians per pixel of mouse movement
const LOOK_PITCH_LIMIT = 0.7;

export class Input {
  constructor() {
    this.keys = new Set();
    this.actions = [];
    this.lookActive = false;
    this.lookYaw = 0;
    this.lookPitch = 0;

    window.addEventListener('keydown', (e) => this._down(e));
    window.addEventListener('keyup', (e) => this._up(e));
    window.addEventListener('blur', () => { this.keys.clear(); this.lookActive = false; });

    // Mouse-look: hold right-mouse to rotate camera around car
    window.addEventListener('mousedown', (e) => {
      if (e.button === 2) this.lookActive = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.lookActive = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.lookActive) return;
      this.lookYaw   -= e.movementX * LOOK_SENSITIVITY;
      this.lookPitch -= e.movementY * LOOK_SENSITIVITY;
      if (this.lookPitch > LOOK_PITCH_LIMIT) this.lookPitch = LOOK_PITCH_LIMIT;
      if (this.lookPitch < -LOOK_PITCH_LIMIT) this.lookPitch = -LOOK_PITCH_LIMIT;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Called from frame loop so the look angles decay back to neutral when
  // the player releases the right-mouse button.
  decayLook(dt) {
    if (this.lookActive) return;
    const k = Math.exp(-dt * 5);
    this.lookYaw *= k;
    this.lookPitch *= k;
    if (Math.abs(this.lookYaw) < 0.0005) this.lookYaw = 0;
    if (Math.abs(this.lookPitch) < 0.0005) this.lookPitch = 0;
  }

  _down(e) {
    const k = e.code;
    if (!this.keys.has(k)) {
      if (k === 'KeyR') this.actions.push('reset');
      if (k === 'KeyV') this.actions.push('toggleView');
    }
    this.keys.add(k);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
         'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(k)) e.preventDefault();
  }
  _up(e) { this.keys.delete(e.code); }

  axes() {
    const k = this.keys;
    const ax = (a, b) => (k.has(a) ? 1 : 0) - (k.has(b) ? 1 : 0);
    const accel = Math.max(0,  ax('KeyW', 'KeyS') + ax('ArrowUp', 'ArrowDown'));
    const brake = Math.max(0, -ax('KeyW', 'KeyS') - ax('ArrowUp', 'ArrowDown'));
    let steer  = ax('KeyA', 'KeyD') + ax('ArrowLeft', 'ArrowRight');
    if (steer >  1) steer =  1;
    if (steer < -1) steer = -1;
    return {
      accel,
      brake,
      steer: -steer,                // left key = negative heading (steer left)
      boost: k.has('ShiftLeft') || k.has('ShiftRight'),
      handbrake: k.has('Space'),
      lookYaw: this.lookYaw,
      lookPitch: this.lookPitch,
    };
  }

  drainActions() { const out = this.actions; this.actions = []; return out; }
}
