/**
 * SnowEffect — layered canvas snow with depth-of-field, wind, intensity
 * and ground accumulation.
 *
 * Four parallax layers (far / mid / near / foreground bokeh): far flakes are
 * small, slow and blurred; near flakes sharp and fast; foreground flakes are
 * big soft out-of-focus blobs drifting past the camera. Moon glow, drifting
 * fog and a vignette supply the mood.
 *
 *   const snow = new SnowEffect(canvas, {
 *     wind: 0,            // -10..10, positive blows right
 *     intensity: 'mid',   // 'low' | 'mid' | 'high'
 *     settle: true,       // flakes accumulate on the ground
 *   });
 *
 *   snow.setWind(4);
 *   snow.setIntensity('high');
 *   snow.setSettle(false);  // pile melts away
 *   snow.destroy();
 */
(() => {
  'use strict';

  const INTENSITY = {
    low:  { density: 0.1,  speedMul: 0.8, deposit: 0.06, gust: 0.2 },
    mid:  { density: 0.22, speedMul: 1,   deposit: 0.1,  gust: 0.6 },
    high: { density: 0.75, speedMul: 1.9, deposit: 0.2,  gust: 2.4 },
  };

  // share:    fraction of total flakes in this layer
  // blur:     sprite softness, 0 = hard disc, 1 = pure haze
  // windMul:  parallax — near layers feel more wind
  // settle:   layer contributes to the snowpack
  const LAYERS = [
    { share: 0.45, radius: [0.6, 1.4], speed: [0.25, 0.55], blur: 0.7,  alpha: [0.15, 0.4],  windMul: 0.15, sway: [0.1, 0.3],  settle: false },
    { share: 0.3,  radius: [1.2, 2.2], speed: [0.5, 0.95],  blur: 0.45, alpha: [0.3, 0.65],  windMul: 0.3,  sway: [0.2, 0.5],  settle: true },
    { share: 0.2,  radius: [2, 3.2],   speed: [0.9, 1.6],   blur: 0.15, alpha: [0.5, 0.9],   windMul: 0.55, sway: [0.25, 0.6], settle: true },
    { share: 0.05, radius: [6, 12],    speed: [1.6, 2.8],   blur: 0.85, alpha: [0.06, 0.18], windMul: 0.9,  sway: [0.4, 0.9],  settle: false },
  ];

  const CELL = 4;              // px per snowpack column
  const MAX_PILE_FRAC = 0.2;   // pile height cap as fraction of canvas height

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (range) => rand(range[0], range[1]);

  // Soft round sprite; blur controls how much of the disc is gradient falloff.
  const makeSprite = (blur) => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    const core = Math.max(0.05, 1 - blur);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(core, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return c;
  };

  class Flake {
    constructor(w, h, layer, cfg) {
      this.layer = layer;
      this.reset(w, h, cfg, true);
    }

    reset(w, h, cfg, anywhere = false) {
      const L = LAYERS[this.layer];
      this.x = rand(0, w);
      this.y = anywhere ? rand(-h, h) : rand(-h * 0.1, -15);
      this.r = pick(L.radius);
      this.vy = pick(L.speed) * cfg.speedMul;
      this.phase = rand(0, Math.PI * 2);
      this.swaySpeed = rand(0.015, 0.05);
      this.sway = pick(L.sway);
      this.alpha = pick(L.alpha);
    }
  }

  class SnowEffect {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.wind = options.wind ?? 0;
      this.intensity = options.intensity ?? 'mid';
      this.settleOn = options.settle ?? true;

      this.cfg = INTENSITY[this.intensity];
      this.layers = LAYERS.map(() => []);
      this.sprites = LAYERS.map((L) => makeSprite(L.blur));
      this.pile = [];
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
      this.pile = new Array(Math.ceil(this.w / CELL) + 1).fill(0);
      this.populate();
    }

    populate() {
      for (let li = 0; li < LAYERS.length; li++) {
        const flakes = this.layers[li];
        const target = Math.round(this.w * this.cfg.density * LAYERS[li].share);
        while (flakes.length < target) flakes.push(new Flake(this.w, this.h, li, this.cfg));
        flakes.length = target;
      }
    }

    setWind(v) {
      this.wind = Math.max(-10, Math.min(10, v));
    }

    setIntensity(level) {
      if (!INTENSITY[level]) throw new Error(`unknown intensity: ${level}`);
      this.intensity = level;
      this.cfg = INTENSITY[level];
      for (let li = 0; li < LAYERS.length; li++) {
        for (const f of this.layers[li]) {
          f.vy = pick(LAYERS[li].speed) * this.cfg.speedMul;
        }
      }
      this.populate();
    }

    setSettle(on) {
      this.settleOn = on;
    }

    // Move snow from tall columns to shorter neighbours so piles keep a natural slope.
    relaxPile() {
      const p = this.pile;
      for (let i = 0; i < p.length - 1; i++) {
        const diff = p[i] - p[i + 1];
        if (Math.abs(diff) > 6) { p[i] -= diff * 0.25; p[i + 1] += diff * 0.25; }
      }
    }

    stepLayer(li, dt) {
      const { ctx, w, h, cfg } = this;
      const L = LAYERS[li];
      const sprite = this.sprites[li];
      const maxPile = h * MAX_PILE_FRAC;
      for (const f of this.layers[li]) {
        f.phase += f.swaySpeed * dt;
        f.x += (this.effWind * 0.35 * L.windMul + Math.sin(f.phase) * f.sway) * dt;
        f.y += f.vy * dt;

        // Wrap horizontally so wind never empties one side.
        const m = f.r * 3;
        if (f.x < -m) f.x += w + m * 2;
        else if (f.x > w + m) f.x -= w + m * 2;

        if (L.settle) {
          const col = Math.min(this.pile.length - 1, Math.max(0, Math.round(f.x / CELL)));
          if (f.y + f.r >= h - this.pile[col]) {
            if (this.settleOn && this.pile[col] < maxPile) {
              this.pile[col] = Math.min(maxPile, this.pile[col] + f.r * cfg.deposit);
            }
            f.reset(w, h, cfg);
            continue;
          }
        } else if (f.y - m > h) {
          f.reset(w, h, cfg);
          continue;
        }

        const d = f.r * 3; // sprite spans the soft falloff, not just the core
        ctx.globalAlpha = f.alpha;
        ctx.drawImage(sprite, f.x - d / 2, f.y - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
    }

    tick(t) {
      const dt = this.lastT ? Math.min((t - this.lastT) / 16.67, 3) : 1;
      this.lastT = t;
      const { ctx, w, h } = this;

      // Gusts: slow irregular wind oscillation layered on the user's wind.
      const g = this.cfg.gust;
      this.effWind = this.wind + Math.sin(t * 0.0003) * g + Math.sin(t * 0.00013 + 1.7) * g * 0.6;

      // Sky: deep winter night.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#0a1420');
      bg.addColorStop(0.6, '#1c3048');
      bg.addColorStop(1, '#2c4460');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Moon glow, upper right.
      const mx = w * 0.78;
      const my = h * 0.16;
      const moon = ctx.createRadialGradient(mx, my, 0, mx, my, Math.min(w, h) * 0.55);
      moon.addColorStop(0, 'rgba(200, 220, 250, 0.22)');
      moon.addColorStop(0.25, 'rgba(190, 212, 245, 0.08)');
      moon.addColorStop(1, 'rgba(190, 212, 245, 0)');
      ctx.fillStyle = moon;
      ctx.fillRect(0, 0, w, h);

      // Background layers, far to near.
      this.stepLayer(0, dt);
      this.stepLayer(1, dt);

      // Low drifting fog.
      for (let i = 0; i < 2; i++) {
        const fx = w * (0.25 + 0.5 * i) + Math.sin(t * 0.00004 + i * 2.6) * w * 0.18;
        const fy = h * (0.78 + 0.1 * i);
        const fog = ctx.createRadialGradient(fx, fy, 0, fx, fy, w * 0.45);
        fog.addColorStop(0, 'rgba(185, 205, 232, 0.07)');
        fog.addColorStop(1, 'rgba(185, 205, 232, 0)');
        ctx.fillStyle = fog;
        ctx.fillRect(0, 0, w, h);
      }

      this.stepLayer(2, dt);

      // Snowpack.
      if (this.settleOn) {
        this.relaxPile();
      } else {
        for (let i = 0; i < this.pile.length; i++) this.pile[i] = Math.max(0, this.pile[i] - 0.06 * dt);
      }
      let hasPile = false;
      for (let i = 0; i < this.pile.length; i++) {
        if (this.pile[i] > 0.5) { hasPile = true; break; }
      }
      if (hasPile) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < this.pile.length; i++) ctx.lineTo(i * CELL, h - this.pile[i]);
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = 'rgba(238, 244, 251, 0.92)';
        ctx.fill();
      }

      // Foreground bokeh — out-of-focus flakes in front of everything.
      this.stepLayer(3, dt);

      // Vignette.
      const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
      vig.addColorStop(0, 'rgba(4, 8, 16, 0)');
      vig.addColorStop(1, 'rgba(4, 8, 16, 0.45)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }

    destroy() {
      this.running = false;
      window.removeEventListener('resize', this.onResize);
    }
  }

  window.SnowEffect = SnowEffect;
})();
