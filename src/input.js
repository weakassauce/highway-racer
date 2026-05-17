// Keyboard → normalized control axes.

export class Input {
  constructor() {
    this.keys = new Set();
    this.actions = [];
    window.addEventListener('keydown', (e) => this._down(e));
    window.addEventListener('keyup', (e) => this._up(e));
    window.addEventListener('blur', () => this.keys.clear());
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
    };
  }

  drainActions() { const out = this.actions; this.actions = []; return out; }
}
