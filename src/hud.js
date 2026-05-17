import { CAR } from './config.js';

// 2D canvas overlay HUD: speedometer, distance, boost indicator, crash flash.
export class HUD {
  constructor() {
    this.canvas = document.querySelector('#hud canvas');
    this.ctx = this.canvas.getContext('2d');
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  draw({ car }) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.clearRect(0, 0, W, H);

    const speedKmh = Math.round(car.speed() * 3.6);
    const ratio = Math.min(1, car.speed() / CAR.topSpeed);

    // Big speedometer bottom-right
    ctx.save();
    ctx.font = 'bold 64px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    const speedText = String(speedKmh).padStart(3, ' ');
    ctx.textAlign = 'right';
    ctx.fillText(speedText, W - 32, H - 50);
    ctx.font = '16px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = 'rgba(180,200,230,0.9)';
    ctx.fillText('km/h', W - 32, H - 26);
    ctx.restore();

    // Speed bar (left of number)
    const barW = 240, barH = 12;
    const bx = W - 32 - barW, by = H - 100;
    ctx.strokeStyle = 'rgba(140,160,200,0.6)';
    ctx.strokeRect(bx, by, barW, barH);
    const grad = ctx.createLinearGradient(bx, 0, bx + barW, 0);
    grad.addColorStop(0, '#3df0c4');
    grad.addColorStop(0.6, '#ffd25a');
    grad.addColorStop(1, '#ff4a55');
    ctx.fillStyle = grad;
    ctx.fillRect(bx + 1, by + 1, (barW - 2) * ratio, barH - 2);

    // Distance (top-right)
    ctx.fillStyle = 'rgba(220,230,250,0.9)';
    ctx.font = '18px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    const km = (car.distanceTravelled / 1000).toFixed(2);
    ctx.fillText(`DIST ${km} km`, W - 24, 32);

    // Boost indicator
    if (car.boostActive) {
      ctx.fillStyle = '#ff8030';
      ctx.font = 'bold 18px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('BOOST', W - 24, 58);
    }

    // Handbrake / drift hint
    if (car.handbraking) {
      ctx.fillStyle = '#ffd25a';
      ctx.font = '18px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillText('HANDBRAKE', W - 24, 80);
    }

    // Crash flash
    if (car.crashed > 0) {
      const a = Math.min(0.6, car.crashed * 1.5);
      ctx.fillStyle = `rgba(255,40,40,${a})`;
      ctx.fillRect(0, 0, W, H);
    }

    // Center crosshair tick (subtle)
    ctx.fillStyle = 'rgba(220,230,250,0.35)';
    ctx.fillRect(W / 2 - 2, H / 2 + 6, 4, 4);
  }
}
