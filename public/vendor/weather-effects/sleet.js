/**
 * SleetEffect — canvas sleet: a wind-driven mix of rain, half-melted
 * flakes and small ice pellets, with slush building on the ground.
 *
 *   const sleet = new SleetEffect(canvas, {
 *     wind: 3,            // -10..10, positive blows right
 *     intensity: 'mid',   // 'low' | 'mid' | 'high'
 *     slush: true,        // slush layer accumulates at the bottom
 *   });
 *
 *   sleet.setWind(-5);
 *   sleet.setIntensity('high');
 *   sleet.setSlush(false);
 *   sleet.destroy();
 *
 * Raindrops slant hard with the wind, slush flakes fall heavy with barely
 * any wobble, ice pellets tick off the ground with one short bounce, and
 * everything lands on a slowly rising slush band (it melts away when
 * toggled off).
 */
(() => {
  'use strict';

  const INTENSITY = {
    low:  { density: 0.1,  opacity: 0.45, slushRate: 0.006 },
    mid:  { density: 0.25, opacity: 0.6,  slushRate: 0.012 },
    high: { density: 0.5,  opacity: 0.75, slushRate: 0.024 },
  };

  const rand = (min, max) => min + Math.random() * (max - min);

  class Drop {
    constructor(w, h, cfg) {
      this.reset(w, h, cfg, true);
    }

    reset(w, h, cfg, anywhere = false) {
      this.x = rand(-w * 0.15, w * 1.15);
      this.y = anywhere ? rand(-h, h) : rand(-h * 0.2, -10);
      this.vy = rand(12, 18);
      this.len = this.vy * rand(0.9, 1.3);
      this.lw = rand(1, 1.6);
      this.alpha = Math.min(0.85, cfg.opacity * rand(0.25, 1.3));
      this.ground = h - rand(0, h * 0.04);
    }
  }

  class Flake {
    constructor(w, h, cfg) {
      this.reset(w, h, cfg, true);
    }

    reset(w, h, cfg, anywhere = false) {
      this.x = rand(-w * 0.15, w * 1.15);
      this.y = anywhere ? rand(-h, h) : rand(-h * 0.2, -8);
      this.r = rand(1.8, 3.6);
      // Waterlogged: much faster than snow, barely any wobble.
      this.vy = rand(2.6, 4.6) + this.r * 0.3;
      this.wobble = rand(0.3, 0.9);
      this.phase = rand(0, Math.PI * 2);
      this.alpha = Math.min(1, cfg.opacity * rand(0.7, 1.5));
      this.ground = h - rand(0, h * 0.04);
    }
  }

  class Pellet {
    constructor(w, h, cfg) {
      this.reset(w, h, cfg, true);
    }

    reset(w, h, cfg, anywhere = false) {
      this.x = rand(-w * 0.15, w * 1.15);
      this.y = anywhere ? rand(-h, h) : rand(-h * 0.2, -8);
      this.r = rand(1, 1.8);
      this.terminal = rand(9, 14);
      this.vy = this.terminal * rand(0.5, 0.8);
      this.vx = rand(-0.3, 0.3);
      this.bounced = false;
      this.alpha = Math.min(1, cfg.opacity * rand(0.9, 1.6));
      this.ground = h - rand(0, h * 0.04);
    }
  }

  class Splash {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = rand(-1.4, 1.4);
      this.vy = rand(-2.8, -1);
      this.r = rand(0.5, 1.2);
      this.life = 1;
    }

    step(dt) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      this.vy += 0.25 * dt;
      this.life -= 0.06 * dt;
      return this.life > 0;
    }
  }

  class SleetEffect {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      const n = Number(options.wind ?? 3);
      this.wind = Number.isFinite(n) ? Math.max(-10, Math.min(10, n)) : 3;
      this.intensity = options.intensity ?? 'mid';
      if (!INTENSITY[this.intensity]) throw new Error(`unknown intensity: ${this.intensity}`);
      this.slushOn = options.slush ?? true;

      this.cfg = INTENSITY[this.intensity];
      this.drops = [];
      this.flakes = [];
      this.pellets = [];
      this.splashes = [];
      this.slushH = 0;
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
      // Slush surface bumps, one every 22px.
      this.bumps = [];
      for (let x = 0; x <= this.w + 22; x += 22) this.bumps.push(rand(-3, 2));
      this.populate();
    }

    populate() {
      const total = this.w * this.cfg.density;
      const counts = [
        [this.drops, Math.round(total * 0.5), Drop],
        [this.flakes, Math.round(total * 0.32), Flake],
        [this.pellets, Math.round(total * 0.18), Pellet],
      ];
      for (const [arr, target, Cls] of counts) {
        while (arr.length < target) arr.push(new Cls(this.w, this.h, this.cfg));
        arr.length = target;
      }
    }

    setWind(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.wind = Math.max(-10, Math.min(10, n));
    }

    setIntensity(level) {
      if (!INTENSITY[level]) throw new Error(`unknown intensity: ${level}`);
      this.intensity = level;
      this.cfg = INTENSITY[level];
      for (const d of this.drops) d.alpha = Math.min(0.85, this.cfg.opacity * rand(0.25, 1.3));
      for (const f of this.flakes) f.alpha = Math.min(1, this.cfg.opacity * rand(0.7, 1.5));
      for (const p of this.pellets) p.alpha = Math.min(1, this.cfg.opacity * rand(0.9, 1.6));
      this.populate();
    }

    setSlush(on) {
      this.slushOn = !!on;
    }

    tick(t) {
      const dt = this.lastT ? Math.min((t - this.lastT) / 16.67, 3) : 1;
      this.lastT = t;
      const { ctx, w, h, cfg } = this;

      // Slush grows while on, melts away when off. Landing math uses its top.
      const maxSlush = h * 0.045;
      if (this.slushOn) {
        this.slushH = Math.min(maxSlush, this.slushH + cfg.slushRate * dt);
      } else if (this.slushH > 0) {
        this.slushH = Math.max(0, this.slushH - 0.08 * dt);
      }
      const slushTop = h - this.slushH;

      // Background: near-freezing overcast gloom.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#2f3841');
      bg.addColorStop(1, '#66717b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Slush flakes: back layer, heavy and nearly straight.
      ctx.fillStyle = '#e8f0f4';
      for (const f of this.flakes) {
        f.y += f.vy * dt;
        f.x += (this.wind * 0.5 + Math.sin(t * 0.003 + f.phase) * f.wobble) * dt;
        if (f.x < -w * 0.16) f.x += w * 1.32;
        else if (f.x > w * 1.16) f.x -= w * 1.32;
        if (f.y >= Math.min(f.ground, slushTop)) {
          f.reset(w, h, cfg);
          continue;
        }
        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        // Slightly elongated along the fall: wet, streaky flake.
        ctx.ellipse(f.x, f.y, f.r, f.r * 1.35, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Raindrops: streaks slanted along their velocity.
      ctx.strokeStyle = '#9fb2c4';
      ctx.lineCap = 'round';
      const rvx = this.wind * 0.9;
      for (const d of this.drops) {
        d.y += d.vy * dt;
        d.x += rvx * dt;
        if (d.x < -w * 0.16) d.x += w * 1.32;
        else if (d.x > w * 1.16) d.x -= w * 1.32;
        const gy = Math.min(d.ground, slushTop);
        if (d.y >= gy) {
          if (Math.random() < 0.35) {
            const c = 2 + ((Math.random() * 2) | 0);
            for (let i = 0; i < c; i++) this.splashes.push(new Splash(d.x, gy));
          }
          d.reset(w, h, cfg);
          continue;
        }
        const k = d.len / Math.hypot(rvx, d.vy);
        ctx.globalAlpha = d.alpha;
        ctx.lineWidth = d.lw;
        ctx.beginPath();
        ctx.moveTo(d.x - rvx * k, d.y - d.vy * k);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }

      // Ice pellets: bright dots, one short bounce off the ground.
      ctx.fillStyle = '#dce8ee';
      for (const p of this.pellets) {
        p.vy = Math.min(p.vy + 0.5 * dt, p.terminal);
        p.y += p.vy * dt;
        p.x += (p.vx + this.wind * 0.6) * dt;
        if (p.x < -w * 0.16) p.x += w * 1.32;
        else if (p.x > w * 1.16) p.x -= w * 1.32;
        const gy = Math.min(p.ground, slushTop);
        if (p.y >= gy && p.vy > 0) {
          if (!p.bounced && p.vy > 3) {
            p.bounced = true;
            p.y = gy;
            p.vy = -p.vy * rand(0.25, 0.42);
            p.vx += rand(-0.9, 0.9);
          } else {
            p.reset(w, h, cfg);
            continue;
          }
        }
        ctx.globalAlpha = p.alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Splashes.
      ctx.fillStyle = 'rgba(200, 216, 226, 0.6)';
      this.splashes = this.splashes.filter((s) => {
        if (!s.step(dt)) return false;
        ctx.globalAlpha = s.life;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        return true;
      });
      ctx.globalAlpha = 1;

      // Slush band: drawn last so landings vanish into it. Bump texture
      // scales in as the layer deepens, so a thin layer stays a flat film.
      if (this.slushH > 0.5) {
        const bumpK = Math.min(1, this.slushH / 12);
        ctx.fillStyle = 'rgba(210, 222, 229, 0.92)';
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < this.bumps.length; i++) {
          ctx.lineTo(i * 22, slushTop + this.bumps[i] * bumpK);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        // Wet sheen along the lip.
        ctx.strokeStyle = 'rgba(240, 248, 252, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < this.bumps.length; i++) {
          const y = slushTop + this.bumps[i] * bumpK;
          if (i === 0) ctx.moveTo(0, y);
          else ctx.lineTo(i * 22, y);
        }
        ctx.stroke();
      }
    }

    destroy() {
      this.running = false;
      window.removeEventListener('resize', this.onResize);
    }
  }

  window.SleetEffect = SleetEffect;
})();
