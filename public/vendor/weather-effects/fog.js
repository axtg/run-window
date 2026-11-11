/**
 * FogEffect — rolling fog banks over a misty morning landscape.
 *
 * Fog motion ported from the classic CSS fog animation
 * (danielstuart14/CSS_FOG_ANIMATION, codepen oNvaggd): layers scroll in a
 * seamless horizontal loop while their opacity swells and thins on long
 * independent keyframe cycles — the swell, not the scroll, is what makes
 * fog feel alive. Textures are procedural tileable value noise with
 * strongly x-stretched cells and bottom-heavy density, so they read as
 * flat drifting strata (fog), not puffy clumps (clouds). No assets.
 *
 *   const fog = new FogEffect(canvas, {
 *     wind: 3,            // -10..10, positive drifts right, 3 ≈ original pace
 *     intensity: 'mid',   // 'low' (mist) | 'mid' (fog) | 'high' (thick)
 *     sun: true,          // low hazy sun trying to burn through
 *   });
 *
 *   fog.setWind(-3);
 *   fog.setIntensity('high');
 *   fog.setSun(false);
 *   fog.destroy();
 */
(() => {
  'use strict';

  const FOG_WHITE = [236, 241, 245];

  // fog:   multiplier on the fog layers' keyframed opacity
  // veil:  strength of the full-screen milk gradient (bottom-heavy)
  // sceneFade: how far the ground plane washes toward white
  const INTENSITY = {
    low:  { fog: 0.65, veil: 0.2,  sceneFade: 0.3,  ground: 0.4,  sun: 0.75 },
    mid:  { fog: 0.95, veil: 0.35, sceneFade: 0.5,  ground: 0.65, sun: 0.45 },
    high: { fog: 1.6,  veil: 0.8,  sceneFade: 0.85, ground: 1.1,  sun: 0.1 },
  };

  // Banks at different heights, far to near. moveDur = one full-width scroll
  // loop; stops = opacity keyframes over opDur.
  const FOG_LAYERS = [
    { tex: 1, yTop: 0.32, yH: 0.5,  moveDur: 30000, opDur: 20000, stops: [[0, 0.1], [0.22, 0.5], [0.4, 0.28], [0.58, 0.4], [0.8, 0.16], [1, 0.1]] },
    { tex: 0, yTop: 0.42, yH: 0.58, moveDur: 26000, opDur: 42000, stops: [[0, 0.5], [0.25, 0.2], [0.5, 0.1], [0.8, 0.3], [1, 0.5]] },
    { tex: 0, yTop: 0.26, yH: 0.74, moveDur: 22000, opDur: 42000, stops: [[0, 0.8], [0.27, 0.2], [0.52, 0.6], [0.68, 0.3], [1, 0.8]] },
  ];

  const HORIZON = 0.62; // ground plane starts here

  const rand = (min, max) => min + Math.random() * (max - min);
  const approach = (cur, target, k) => cur + (target - cur) * k;
  const rgb = (c) => `rgb(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0})`;
  const rgba = (c, a) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;

  // Piecewise-linear keyframe lookup, frac in 0..1.
  const kf = (stops, frac) => {
    for (let i = 1; i < stops.length; i++) {
      if (frac <= stops[i][0]) {
        const [f0, v0] = stops[i - 1];
        const [f1, v1] = stops[i];
        return v0 + (v1 - v0) * ((frac - f0) / (f1 - f0));
      }
    }
    return stops[stops.length - 1][1];
  };

  // One octave of value noise, tileable in both axes (cx × cy lattice cells).
  const noiseOctave = (W, H, cx, cy) => {
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = Math.random();
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const gy = (y / H) * cy;
      const y0 = Math.floor(gy) % cy;
      const y1 = (y0 + 1) % cy;
      let fy = gy - Math.floor(gy);
      fy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < W; x++) {
        const gx = (x / W) * cx;
        const x0 = Math.floor(gx) % cx;
        const x1 = (x0 + 1) % cx;
        let fx = gx - Math.floor(gx);
        fx = fx * fx * (3 - 2 * fx);
        const a = lat[y0 * cx + x0];
        const b = lat[y0 * cx + x1];
        const c = lat[y1 * cx + x0];
        const d = lat[y1 * cx + x1];
        out[y * W + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      }
    }
    return out;
  };

  // Fog strata texture. Cells are ~5× wider than tall, so features are flat
  // horizontal streaks. Density biased toward the bottom — fog hangs low.
  // wispy = thinner, more broken variant for the high drifting layer.
  const makeFogTexture = (wispy) => {
    const W = 1024;
    const H = 512;
    const octs = wispy
      ? [[4, 10, 1], [8, 22, 0.5], [16, 48, 0.28]]
      : [[3, 7, 1], [6, 14, 0.55], [12, 30, 0.3], [24, 60, 0.16]];
    const fields = octs.map(([cx, cy]) => noiseOctave(W, H, cx, cy));
    let ampSum = 0;
    for (const o of octs) ampSum += o[2];
    const lo = wispy ? 0.46 : 0.37;
    const hi = wispy ? 0.82 : 0.78;
    const gamma = wispy ? 1.35 : 1.05;
    const maxA = wispy ? 185 : 215;

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const data = img.data;
    for (let y = 0; y < H; y++) {
      const vy = y / H;
      const up = Math.min(1, vy / 0.3);
      const soft = up * up * (3 - 2 * up);            // soft dissolving top
      const down = Math.min(1, (1 - vy) / 0.06);      // short bottom fade
      const bias = 0.5 + 0.5 * Math.min(1, vy / 0.7); // denser low
      const env = soft * down * bias;
      for (let x = 0; x < W; x++) {
        let v = 0;
        for (let o = 0; o < octs.length; o++) v += fields[o][y * W + x] * octs[o][2];
        v /= ampSum;
        let a = Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        a = a * a * (3 - 2 * a);
        a = Math.pow(a, gamma) * env;
        const i = (y * W + x) * 4;
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = a * maxA;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  };

  class FogEffect {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.wind = Math.max(-10, Math.min(10, options.wind ?? 3));
      this.intensity = options.intensity ?? 'mid';
      if (!INTENSITY[this.intensity]) throw new Error(`unknown intensity: ${this.intensity}`);
      this.sunOn = options.sun ?? true;

      const I = INTENSITY[this.intensity];
      this.cur = {
        fog: I.fog,
        veil: I.veil,
        sceneFade: I.sceneFade,
        ground: I.ground,
        sun: this.sunOn ? I.sun : 0,
      };

      this.textures = [makeFogTexture(false), makeFogTexture(true)];
      this.layers = FOG_LAYERS.map((L) => ({
        o: rand(0, 4000),          // scroll offset, px
        opT: rand(0, L.opDur),     // opacity cycle clock, ms
        phase: rand(0, Math.PI * 2),
      }));
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
    }

    setWind(v) {
      this.wind = Math.max(-10, Math.min(10, v));
    }

    setIntensity(level) {
      if (!INTENSITY[level]) throw new Error(`unknown intensity: ${level}`);
      this.intensity = level;
    }

    setSun(on) {
      this.sunOn = on;
    }

    tick(t) {
      const dt = this.lastT ? Math.min((t - this.lastT) / 16.67, 3) : 1;
      this.lastT = t;
      const dtMs = dt * 16.67;
      const { ctx, w, h, cur } = this;

      const I = INTENSITY[this.intensity];
      const k = 1 - Math.pow(0.96, dt);
      cur.fog = approach(cur.fog, I.fog, k);
      cur.veil = approach(cur.veil, I.veil, k);
      cur.sceneFade = approach(cur.sceneFade, I.sceneFade, k);
      cur.ground = approach(cur.ground, I.ground, k);
      cur.sun = approach(cur.sun, this.sunOn ? I.sun : 0, k);

      // Misty morning sky: dark brooding top, bright glow at the treeline.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, 'rgb(98, 112, 128)');
      bg.addColorStop(0.42, 'rgb(148, 158, 168)');
      bg.addColorStop(0.6, 'rgb(192, 197, 196)');
      bg.addColorStop(1, 'rgb(168, 176, 182)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Low hazy sun just above the horizon, drowned as fog thickens.
      if (cur.sun > 0.01) {
        const b = cur.sun * (0.92 + 0.08 * Math.sin(t * 0.0003));
        const sx = w * 0.68;
        const sy = h * 0.48;
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.min(w, h) * 0.42);
        glow.addColorStop(0, `rgba(255, 244, 222, ${0.55 * b})`);
        glow.addColorStop(0.4, `rgba(255, 244, 222, ${0.16 * b})`);
        glow.addColorStop(1, 'rgba(255, 244, 222, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        const disc = ctx.createRadialGradient(sx, sy, 0, sx, sy, 46);
        disc.addColorStop(0, `rgba(255, 250, 238, ${0.85 * b})`);
        disc.addColorStop(0.5, `rgba(255, 246, 228, ${0.32 * b})`);
        disc.addColorStop(1, 'rgba(255, 246, 228, 0)');
        ctx.fillStyle = disc;
        ctx.fillRect(sx - 48, sy - 48, 96, 96);
      }

      // Dark ground plane below the horizon, washed out as fog thickens.
      const gy = h * HORIZON;
      const mixW = (c, m) => c.map((v, j) => v + (FOG_WHITE[j] - v) * m);
      const plane = ctx.createLinearGradient(0, gy, 0, h);
      plane.addColorStop(0, rgb(mixW([118, 130, 136], Math.min(0.96, cur.sceneFade))));
      plane.addColorStop(0.35, rgb(mixW([64, 76, 82], Math.min(0.96, cur.sceneFade * 0.8))));
      plane.addColorStop(1, rgb(mixW([34, 44, 50], Math.min(0.96, cur.sceneFade * 0.6))));
      ctx.fillStyle = plane;
      ctx.fillRect(0, gy, w, h - gy);

      // Ground fog pooling low.
      const ground = ctx.createLinearGradient(0, h * 0.68, 0, h);
      ground.addColorStop(0, rgba(FOG_WHITE, 0));
      ground.addColorStop(1, rgba(FOG_WHITE, 0.5 * cur.ground));
      ctx.fillStyle = ground;
      ctx.fillRect(0, h * 0.6, w, h * 0.4);

      // Fog banks — seamless wrap, opacity on its own long swell cycle,
      // each bank at its own height with a slow vertical bob.
      for (let i = 0; i < FOG_LAYERS.length; i++) {
        const L = FOG_LAYERS[i];
        const S = this.layers[i];
        const speed = ((w * 16.67) / L.moveDur) * (this.wind / 3);
        S.o += speed * dt;
        S.opT = (S.opT + dtMs) % L.opDur;
        const op = kf(L.stops, S.opT / L.opDur) * cur.fog;
        if (op <= 0.003) continue;
        const x = ((S.o % w) + w) % w - w;
        const y = L.yTop * h + Math.sin(t * 0.00005 + S.phase) * h * 0.012;
        const dh = L.yH * h;
        ctx.globalAlpha = Math.min(1, op);
        const tex = this.textures[L.tex];
        ctx.drawImage(tex, x, y, w, dh);
        ctx.drawImage(tex, x + w, y, w, dh);
      }
      ctx.globalAlpha = 1;

      // The milk: air-thickness veil, heavier low where the fog lives.
      const veil = ctx.createLinearGradient(0, 0, 0, h);
      veil.addColorStop(0, `rgba(255, 255, 255, ${0.15 * cur.veil})`);
      veil.addColorStop(1, `rgba(255, 255, 255, ${0.42 * cur.veil})`);
      ctx.fillStyle = veil;
      ctx.fillRect(0, 0, w, h);

      // Quiet photographic vignette.
      const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.5, w / 2, h / 2, Math.max(w, h) * 0.8);
      vig.addColorStop(0, 'rgba(24, 32, 42, 0)');
      vig.addColorStop(1, 'rgba(24, 32, 42, 0.22)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);
    }

    destroy() {
      this.running = false;
      window.removeEventListener('resize', this.onResize);
    }
  }

  window.FogEffect = FogEffect;
})();
