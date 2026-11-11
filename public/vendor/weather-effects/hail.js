/**
 * HailEffect — canvas hail with configurable wind, intensity and thunder.
 *
 *   const hail = new HailEffect(canvas, {
 *     wind: 2,            // -10..10, positive pushes right
 *     intensity: 'mid',   // 'low' | 'mid' | 'high'
 *     thunder: true,      // lightning flashes + bolts
 *   });
 *
 *   hail.setWind(-5);
 *   hail.setIntensity('high');
 *   hail.setThunder(false);
 *   hail.destroy();
 *
 * Stones fall fast, bounce off the ground with random scatter, shed ice
 * chips on impact and briefly rest before recycling.
 */
(() => {
  'use strict';

  const INTENSITY = {
    low:  { density: 0.05, speed: [10, 15], radius: [1.4, 2.6], bigChance: 0.02, opacity: 0.6,  chipChance: 0.3,  thunderGap: [9000, 20000] },
    mid:  { density: 0.14, speed: [13, 19], radius: [1.7, 3.4], bigChance: 0.05, opacity: 0.75, chipChance: 0.5,  thunderGap: [6000, 14000] },
    high: { density: 0.3,  speed: [16, 24], radius: [2.0, 4.6], bigChance: 0.1,  opacity: 0.85, chipChance: 0.7,  thunderGap: [3000, 8000] },
  };

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (range) => rand(range[0], range[1]);

  class Stone {
    constructor(w, h, cfg) {
      this.reset(w, h, cfg, true);
    }

    reset(w, h, cfg, anywhere = false) {
      this.x = rand(-w * 0.1, w * 1.1);
      this.y = anywhere ? rand(-h, h) : rand(-h * 0.25, -12);
      // Rare oversized stones sell the storm.
      this.r = pick(cfg.radius) * (Math.random() < cfg.bigChance ? rand(1.5, 2) : 1);
      // Bigger stones fall faster.
      this.terminal = pick(cfg.speed) + this.r * 0.8;
      this.vy = this.terminal * rand(0.5, 0.75);
      this.vx = rand(-0.4, 0.4);
      // Tumbling stones drift side to side instead of falling ruler-straight.
      this.phase = rand(0, Math.PI * 2);
      this.wobble = rand(0.15, 0.5);
      this.alpha = Math.min(1, cfg.opacity * rand(0.55, 1.35));
      this.ground = h - rand(0, h * 0.07);
      this.bouncesLeft = 1 + ((Math.random() * 2.4) | 0);
      this.rest = 0; // >0: lying on the ground, fading out
    }
  }

  class Chip {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = rand(-2.6, 2.6);
      this.vy = rand(-4.4, -1.4);
      this.r = rand(0.5, 1.3);
      this.life = 1;
    }

    step(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += 0.3 * dt;
      this.life -= 0.055 * dt;
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
        ctx.fillStyle = `rgba(218, 235, 240, ${this.flash})`;
        ctx.fillRect(0, 0, w, h);
      }
    }
  }

  class HailEffect {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.wind = Math.max(-10, Math.min(10, options.wind ?? 2));
      this.intensity = options.intensity ?? 'mid';
      this.thunderOn = options.thunder ?? true;
      if (!INTENSITY[this.intensity]) throw new Error(`unknown intensity: ${this.intensity}`);

      this.cfg = INTENSITY[this.intensity];
      this.stones = [];
      this.chips = [];
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
      while (this.stones.length < target) this.stones.push(new Stone(this.w, this.h, this.cfg));
      this.stones.length = target;
    }

    setWind(v) {
      this.wind = Math.max(-10, Math.min(10, v));
    }

    setIntensity(level) {
      if (!INTENSITY[level]) throw new Error(`unknown intensity: ${level}`);
      this.intensity = level;
      this.cfg = INTENSITY[level];
      for (const s of this.stones) {
        s.r = pick(this.cfg.radius) * (Math.random() < this.cfg.bigChance ? rand(1.5, 2) : 1);
        s.terminal = pick(this.cfg.speed) + s.r * 0.8;
        s.alpha = Math.min(1, this.cfg.opacity * rand(0.55, 1.35));
      }
      this.populate();
    }

    setThunder(on) {
      this.thunderOn = on;
      if (on) this.thunder.schedule(performance.now());
    }

    spawnChips(x, y, count) {
      for (let i = 0; i < count; i++) this.chips.push(new Chip(x, y));
    }

    tick(t) {
      const dt = this.lastT ? Math.min((t - this.lastT) / 16.67, 3) : 1;
      this.lastT = t;
      const { ctx, w, h, cfg } = this;
      const drift = this.wind * 0.35;

      // Background: greenish storm sky — the classic hail-cloud tint.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0a1517');
      bg.addColorStop(0.65, '#2c4a4a');
      bg.addColorStop(1, '#4a6a62');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      if (this.thunderOn) {
        this.thunder.step(t, dt, w, h);
        this.thunder.draw(ctx, w, h);
      }

      // Stones.
      ctx.lineCap = 'round';
      for (const s of this.stones) {
        if (s.rest > 0) {
          // Lying on the ground, melting away.
          s.rest -= 0.035 * dt;
          if (s.rest <= 0) {
            s.reset(w, h, cfg);
            continue;
          }
          ctx.globalAlpha = s.alpha * s.rest * 0.8;
          ctx.fillStyle = '#d8e8f0';
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 0.9, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }

        s.vy = Math.min(s.vy + (0.55 + s.r * 0.05) * dt, s.terminal);
        s.x += (s.vx + drift + Math.sin(t * 0.008 + s.phase) * s.wobble) * dt;
        s.y += s.vy * dt;

        // Wrap horizontally so wind never empties one side.
        if (s.x < -w * 0.12) s.x += w * 1.24;
        else if (s.x > w * 1.12) s.x -= w * 1.24;

        if (s.y >= s.ground) {
          s.y = s.ground;
          if (s.bouncesLeft > 0 && s.vy > 4) {
            s.vy = -s.vy * rand(0.32, 0.5);
            s.vx = s.vx * 0.5 + rand(-2.2, 2.2);
            s.bouncesLeft--;
            if (Math.random() < cfg.chipChance) {
              this.spawnChips(s.x, s.y, 2 + ((Math.random() * 3) | 0));
            }
          } else {
            s.rest = 1;
            if (s.r > 2 && Math.random() < cfg.chipChance * 0.5) {
              this.spawnChips(s.x, s.y, 2);
            }
            continue;
          }
        }

        // Motion blur: short full-diameter smear behind the ball. A thin long
        // streak reads as rain; a stubby capsule reads as a fast ice pellet.
        if (s.vy > s.terminal * 0.5) {
          const k = 0.8;
          ctx.globalAlpha = s.alpha * 0.3;
          ctx.strokeStyle = '#d8e8f0';
          ctx.lineWidth = s.r * 2;
          ctx.beginPath();
          ctx.moveTo(s.x - (s.vx + drift) * k, s.y - s.vy * k);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
        }

        // Ice pellet: pale body + bright top-left glint.
        ctx.globalAlpha = s.alpha;
        ctx.fillStyle = '#d8e8f0';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.r >= 1.8) {
          ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
          ctx.beginPath();
          ctx.arc(s.x - s.r * 0.3, s.y - s.r * 0.32, s.r * 0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Ice chips.
      ctx.fillStyle = 'rgba(224, 240, 248, 0.7)';
      this.chips = this.chips.filter((c) => {
        if (!c.step(dt)) return false;
        ctx.globalAlpha = c.life;
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
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

  window.HailEffect = HailEffect;
})();
