/**
 * RainEffect — canvas rain with configurable angle, intensity and thunder.
 *
 *   const rain = new RainEffect(canvas, {
 *     angle: 15,          // degrees, -45..45, positive leans right
 *     intensity: 'mid',   // 'low' | 'mid' | 'high'
 *     thunder: true,      // lightning flashes + bolts
 *   });
 *
 *   rain.setAngle(-20);
 *   rain.setIntensity('high');
 *   rain.setThunder(false);
 *   rain.destroy();
 */
(() => {
  'use strict';

  const INTENSITY = {
    low:  { density: 0.12, speed: [9, 15],  length: [8, 24],  width: [1, 1.8],   opacity: 0.35, splashChance: 0.25, thunderGap: [9000, 20000] },
    mid:  { density: 0.35, speed: [13, 21], length: [10, 32], width: [1.2, 2.2], opacity: 0.5,  splashChance: 0.45, thunderGap: [6000, 14000] },
    high: { density: 0.85, speed: [19, 29], length: [14, 42], width: [1.4, 2.8], opacity: 0.65, splashChance: 0.65, thunderGap: [3000, 8000] },
  };

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (range) => rand(range[0], range[1]);

  class Drop {
    constructor(w, h, cfg, slope) {
      this.reset(w, h, cfg, slope, true);
    }

    reset(w, h, cfg, slope, anywhere = false) {
      // Extend the spawn band horizontally so slanted rain still covers the canvas.
      const overshoot = Math.abs(slope) * h;
      this.x = rand(-overshoot, w + overshoot);
      this.y = anywhere ? rand(-h, h) : rand(-h * 0.2, -10);
      // Spawn below terminal velocity; gravity accelerates the fall (ease-in).
      this.terminal = pick(cfg.speed);
      this.vy = this.terminal * rand(0.45, 0.7);
      this.len = pick(cfg.length);
      this.w = pick(cfg.width);
      // Wide alpha spread (near-invisible to strong) reads as depth.
      this.alpha = Math.min(0.9, Math.max(0.02, cfg.opacity * rand(0.1, 1.7)));
      this.ground = h - rand(0, h * 0.05);
    }
  }

  class Splash {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = rand(-1.6, 1.6);
      this.vy = rand(-3.4, -1.2);
      this.r = rand(0.6, 1.6);
      this.life = 1;
    }

    step(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += 0.22 * dt;
      this.life -= 0.045 * dt;
      return this.life > 0;
    }
  }

  class Thunder {
    constructor(effect) {
      this.effect = effect;
      this.flash = 0;        // current screen flash alpha
      this.bolt = null;      // active bolt segments
      this.boltTtl = 0;
      this.nextAt = 0;
    }

    schedule(now) {
      this.nextAt = now + pick(this.effect.cfg.thunderGap);
    }

    strike(now, w, h) {
      this.flash = rand(0.5, 0.9);
      this.bolt = this.makeBolt(w, h);
      this.boltTtl = rand(180, 320);
      this.schedule(now);
    }

    makeBolt(w, h) {
      const segs = [];
      const walk = (x, y, angle, len, width, depth) => {
        const targetY = h * rand(0.55, 0.9);
        let steps = 0;
        while (y < targetY && steps++ < 200 && segs.length < 350) {
          // Clamp drift and guarantee downward progress so the walk always terminates.
          angle = Math.max(-1.0, Math.min(1.0, angle + rand(-0.5, 0.5)));
          const nx = x + Math.sin(angle) * len;
          const ny = y + Math.max(Math.cos(angle), 0.3) * len;
          segs.push({ x1: x, y1: y, x2: nx, y2: ny, w: width });
          x = nx;
          y = ny;
          if (depth < 3 && Math.random() < 0.12) {
            walk(x, y, angle + rand(-0.9, 0.9), len * 0.7, width * 0.5, depth + 1);
          }
        }
      };
      walk(rand(w * 0.15, w * 0.85), 0, rand(-0.3, 0.3), rand(14, 26), rand(2, 3.2), 0);
      return segs;
    }

    step(now, dt, w, h) {
      if (this.nextAt === 0) this.schedule(now);
      if (now >= this.nextAt) this.strike(now, w, h);
      if (this.flash > 0) this.flash = Math.max(0, this.flash - 0.045 * dt);
      if (this.boltTtl > 0) this.boltTtl -= dt * 16.67;
      // Re-flicker while the bolt is alive.
      if (this.boltTtl > 0 && Math.random() < 0.12) this.flash = Math.max(this.flash, rand(0.2, 0.5));
    }

    draw(ctx, w, h) {
      if (this.boltTtl > 0 && this.bolt) {
        ctx.save();
        ctx.strokeStyle = 'rgba(230, 240, 255, 0.95)';
        ctx.shadowColor = 'rgba(160, 190, 255, 0.9)';
        ctx.shadowBlur = 18;
        ctx.lineCap = 'round';
        for (const s of this.bolt) {
          ctx.lineWidth = s.w;
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (this.flash > 0) {
        ctx.fillStyle = `rgba(220, 230, 255, ${this.flash})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  class RainEffect {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.angle = options.angle ?? 0;
      this.intensity = options.intensity ?? 'mid';
      this.thunderOn = options.thunder ?? true;

      this.cfg = INTENSITY[this.intensity];
      this.drops = [];
      this.splashes = [];
      this.thunder = new Thunder(this);
      this.running = true;
      this.lastT = 0;

      this.onResize = () => this.resize();
      window.addEventListener('resize', this.onResize);
      this.resize();

      this.frame = (t) => {
        if (!this.running) return;
        this.tick(t);
        requestAnimationFrame(this.frame);
      };
      requestAnimationFrame(this.frame);
    }

    get slope() {
      return Math.tan((this.angle * Math.PI) / 180);
    }

    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.w = this.canvas.clientWidth;
      this.h = this.canvas.clientHeight;
      this.canvas.width = this.w * dpr;
      this.canvas.height = this.h * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.populate();
    }

    populate() {
      const target = Math.round(this.w * this.cfg.density);
      while (this.drops.length < target) this.drops.push(new Drop(this.w, this.h, this.cfg, this.slope));
      this.drops.length = target;
    }

    setAngle(deg) {
      this.angle = Math.max(-45, Math.min(45, deg));
    }

    setIntensity(level) {
      if (!INTENSITY[level]) throw new Error(`unknown intensity: ${level}`);
      this.intensity = level;
      this.cfg = INTENSITY[level];
      for (const d of this.drops) {
        d.terminal = pick(this.cfg.speed);
        d.vy = d.terminal * rand(0.45, 0.7);
        d.len = pick(this.cfg.length);
        d.w = pick(this.cfg.width);
        d.alpha = Math.min(0.9, Math.max(0.02, this.cfg.opacity * rand(0.1, 1.7)));
      }
      this.populate();
    }

    setThunder(on) {
      this.thunderOn = on;
      if (on) this.thunder.schedule(performance.now());
    }

    tick(t) {
      const dt = this.lastT ? Math.min((t - this.lastT) / 16.67, 3) : 1;
      this.lastT = t;
      const { ctx, w, h, cfg } = this;
      const slope = this.slope;

      // Background: dark storm gradient.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#07131c');
      bg.addColorStop(1, '#305472');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      if (this.thunderOn) {
        this.thunder.step(t, dt, w, h);
        this.thunder.draw(ctx, w, h);
      }

      // Drops: teardrop streaks — sharp tail tapering to a rounded head,
      // gravity-accelerated toward terminal velocity.
      const norm = 1 / Math.sqrt(1 + slope * slope);
      const ux = slope * norm; // unit vector along the fall direction
      const uy = norm;
      const px = -uy; // perpendicular
      const py = ux;
      ctx.fillStyle = '#abc2e9';
      for (const d of this.drops) {
        d.vy = Math.min(d.vy + 0.5 * dt, d.terminal);
        d.x += d.vy * slope * dt;
        d.y += d.vy * dt;

        if (d.y >= d.ground) {
          if (Math.random() < cfg.splashChance) {
            const n = 2 + (Math.random() * 3) | 0;
            for (let i = 0; i < n; i++) this.splashes.push(new Splash(d.x, d.ground));
          }
          d.reset(w, h, cfg, slope);
          continue;
        }

        const hw = d.w / 2;
        ctx.globalAlpha = d.alpha;
        ctx.beginPath();
        ctx.moveTo(d.x - ux * d.len, d.y - uy * d.len);
        ctx.lineTo(d.x + px * hw, d.y + py * hw);
        ctx.quadraticCurveTo(d.x + ux * hw * 2, d.y + uy * hw * 2, d.x - px * hw, d.y - py * hw);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Splashes.
      ctx.fillStyle = 'rgba(171, 194, 233, 0.55)';
      this.splashes = this.splashes.filter((s) => {
        if (!s.step(dt)) return false;
        ctx.globalAlpha = s.life;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;
    }

    destroy() {
      this.running = false;
      window.removeEventListener('resize', this.onResize);
    }
  }

  window.RainEffect = RainEffect;
})();
