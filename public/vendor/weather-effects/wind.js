/**
 * WindEffect — canvas wind with gusting air streaks and tumbling leaves.
 *
 *   const windFx = new WindEffect(canvas, {
 *     wind: 6,            // -10..10, positive blows right
 *     intensity: 'mid',   // 'low' | 'mid' | 'high'
 *     leaves: true,       // autumn leaves dragged by the wind
 *   });
 *
 *   windFx.setWind(-4);
 *   windFx.setIntensity('high');
 *   windFx.setLeaves(false);
 *   windFx.destroy();
 *
 * Air stays invisible until it gusts: when the gust cycle surges, a cluster
 * of lines spawns together and sweeps through — each along its own meandering
 * streamline (sometimes rolling through a curl), accelerating mid-flight,
 * rippling, then dissolving. Calm air shows nothing but drifting leaves.
 */
(() => {
  'use strict';

  const INTENSITY = {
    low:  { burstRate: 1.6, maxLines: 10, leafDensity: 0.008, speed: 0.8,  gust: 0.35, opacity: 0.45 },
    mid:  { burstRate: 3.2, maxLines: 20, leafDensity: 0.018, speed: 1.0,  gust: 0.6,  opacity: 0.6 },
    high: { burstRate: 5.6, maxLines: 34, leafDensity: 0.035, speed: 1.25, gust: 0.9,  opacity: 0.7 },
  };

  // Samples per gust-line path (precomputed at spawn).
  const PATH_N = 56;

  const LEAF_COLORS = ['#c48a4a', '#a86a3a', '#b89a4a', '#8a9a4a', '#9a5a3a', '#c4a05a'];

  const rand = (min, max) => min + Math.random() * (max - min);

  class Streak {
    constructor(w, h, dir, yBase, delay) {
      this.dir = dir;
      this.len = rand(w * 0.25, w * 0.6);
      this.startX = dir > 0
        ? rand(-this.len * 0.2, w * 0.85)
        : rand(w * 0.15, w + this.len * 0.2);

      // Path from a smoothed heading walk: mostly horizontal, meandering
      // like a streamline, sometimes rolling through a full curl. The curl
      // is a 2π heading rotation, so it joins the path with no seam.
      const stepLen = this.len / PATH_N;
      let ang = rand(-0.12, 0.12);
      let turn = 0;
      const curl = Math.random() < 0.3;
      const curlAt = (PATH_N * rand(0.3, 0.65)) | 0;
      const curlSteps = (PATH_N * rand(0.14, 0.22)) | 0;
      const curlDir = Math.random() < 0.5 ? 1 : -1;
      let x = 0;
      let y = yBase;
      this.pts = [x, y];
      for (let i = 1; i <= PATH_N; i++) {
        if (curl && i >= curlAt && i < curlAt + curlSteps) {
          ang += (Math.PI * 2 / curlSteps) * curlDir;
        } else {
          if (curl && i === curlAt + curlSteps) ang -= Math.PI * 2 * curlDir;
          turn = turn * 0.8 + rand(-0.1, 0.1);
          ang = Math.max(-0.5, Math.min(0.5, ang + turn));
        }
        x += Math.cos(ang) * stepLen;
        y += Math.sin(ang) * stepLen;
        this.pts.push(x, y);
      }

      // head runs 0..1.15 over the line's life; the visible window trailing
      // it swells mid-flight and pinches shut at both ends of the life, so
      // the line grows from a tip, stretches, then dissolves.
      this.maxWindow = rand(0.3, 0.45);
      this.head = -delay; // negative: staggered start within a cluster
      this.speedMul = rand(0.8, 1.4);
      this.alphaMul = rand(0.5, 1);
      this.width = rand(1.1, 2.1);
      this.waveAmp = rand(1, 3);
      this.wavePh = rand(0, Math.PI * 2);
    }
  }

  class Leaf {
    constructor(w, h) {
      this.reset(w, h, 0, true);
    }

    reset(w, h, windSpeed, anywhere = false) {
      if (anywhere) {
        this.x = rand(0, w);
        this.y = rand(0, h);
      } else if (Math.abs(windSpeed) < 1) {
        // Near-calm: leaves simply drop in from above.
        this.x = rand(0, w);
        this.y = rand(-h * 0.1, -12);
      } else if (windSpeed > 0) {
        this.x = rand(-w * 0.15, -12);
        this.y = rand(-20, h * 0.85);
      } else {
        this.x = rand(w + 12, w * 1.15);
        this.y = rand(-20, h * 0.85);
      }
      this.r = rand(3, 6.5);
      // Drag factor: how closely this leaf tracks the wind speed.
      this.drag = rand(0.5, 1.1);
      this.vx = windSpeed * this.drag * rand(0.4, 0.9);
      this.vy = rand(0.2, 0.9);
      this.maxFall = rand(0.9, 1.6);
      this.rot = rand(0, Math.PI * 2);
      this.spin = rand(-0.05, 0.05);
      // Flip animates the ellipse squish so the leaf reads as tumbling in 3D.
      this.flip = rand(0, Math.PI * 2);
      this.flipSpeed = rand(0.04, 0.12);
      this.flutter = rand(0.6, 1.6);
      this.phase = rand(0, Math.PI * 2);
      this.alpha = rand(0.7, 1);
      this.color = LEAF_COLORS[(Math.random() * LEAF_COLORS.length) | 0];
    }
  }

  class WindEffect {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      const n = Number(options.wind ?? 6);
      this.wind = Number.isFinite(n) ? Math.max(-10, Math.min(10, n)) : 6;
      this.intensity = options.intensity ?? 'mid';
      if (!INTENSITY[this.intensity]) throw new Error(`unknown intensity: ${this.intensity}`);
      this.leavesOn = options.leaves ?? true;

      this.cfg = INTENSITY[this.intensity];
      this.streaks = [];
      this.leaves = [];
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
      // Gust lines are event-spawned in tick(); just clamp to the new cap.
      if (this.streaks.length > this.cfg.maxLines) this.streaks.length = this.cfg.maxLines;
      const lt = this.leavesOn ? Math.round(this.w * this.cfg.leafDensity) : 0;
      while (this.leaves.length < lt) this.leaves.push(new Leaf(this.w, this.h));
      this.leaves.length = lt;
    }

    setWind(v) {
      const n = Number(v);
      if (Number.isFinite(n)) this.wind = Math.max(-10, Math.min(10, n));
    }

    setIntensity(level) {
      if (!INTENSITY[level]) throw new Error(`unknown intensity: ${level}`);
      this.intensity = level;
      this.cfg = INTENSITY[level];
      this.populate();
    }

    setLeaves(on) {
      this.leavesOn = !!on;
      if (!this.leavesOn) this.leaves.length = 0;
      this.populate();
    }

    tick(t) {
      const dt = this.lastT ? Math.min((t - this.lastT) / 16.67, 3) : 1;
      this.lastT = t;
      const { ctx, w, h, cfg } = this;

      // Gust cycle: layered sines make smooth pseudo-random surges and lulls.
      const noise =
        Math.sin(t * 0.00042) * 0.55 +
        Math.sin(t * 0.0011 + 2.1) * 0.3 +
        Math.sin(t * 0.0027 + 5.0) * 0.15;
      const gust = Math.max(0.15, 1 + noise * cfg.gust);
      const windSpeed = this.wind * 1.1 * cfg.speed * gust;
      const dir = windSpeed >= 0 ? 1 : -1;

      // Background: overcast, wind-scoured sky.
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#46535e');
      bg.addColorStop(1, '#8b98a2');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Gust lines spawn in bursts only when the gust cycle surges past its
      // baseline — calm stretches show none, a surge sends a cluster of 1-3
      // through together at nearby heights, starts staggered.
      const gustFactor = Math.pow(Math.max(0, (gust - 1) / cfg.gust), 1.5);
      const windNorm = Math.min(1, Math.abs(this.wind) / 6);
      const pFrame = (cfg.burstRate / 60) * gustFactor * windNorm;
      if (
        pFrame > 0 && this.streaks.length < cfg.maxLines &&
        Math.random() < 1 - Math.pow(1 - pFrame, dt)
      ) {
        const count = 1 + ((Math.random() * 3) | 0);
        const yBase = rand(h * 0.08, h * 0.85);
        for (let i = 0; i < count && this.streaks.length < cfg.maxLines; i++) {
          this.streaks.push(new Streak(w, h, dir, yBase + rand(-36, 36), i * rand(0.05, 0.12)));
        }
      }

      const streakAlpha = cfg.opacity * Math.min(1, Math.abs(windSpeed) / 5);
      ctx.strokeStyle = '#e6eef2';
      ctx.lineCap = 'round';
      this.streaks = this.streaks.filter((s) => {
        // Ease: the line starts slow, races mid-flight, slows into dissolve.
        const q = Math.min(1, Math.max(0, s.head) / 1.15);
        const ease = 0.55 + Math.sin(q * Math.PI) * 0.7;
        s.head += (Math.abs(windSpeed) * 1.6 * s.speedMul * ease * dt) / s.len;
        if (s.head >= 1.15) return false;
        if (s.head <= 0) return true; // staggered start, not visible yet

        const win = s.maxWindow * Math.sin((s.head / 1.15) * Math.PI);
        const a = Math.max(0, s.head - win);
        const b = Math.min(1, s.head);
        const span = b - a;
        if (span <= 0.002) return s.head < 0.5;
        if (streakAlpha < 0.01) return true;

        const i0 = Math.max(0, Math.floor(a * PATH_N));
        const i1 = Math.min(PATH_N, Math.ceil(b * PATH_N));
        for (let i = i0; i < i1; i++) {
          // Envelope tapers width and alpha to nothing at both visible ends;
          // a slow ripple makes the whole body undulate while it travels.
          const k = Math.max(0, Math.min(1, (i / PATH_N - a) / span));
          const env = Math.sin(k * Math.PI);
          ctx.globalAlpha = streakAlpha * s.alphaMul * env;
          ctx.lineWidth = 0.4 + s.width * env;
          const rip1 = Math.sin((i / PATH_N) * 5 + t * 0.004 + s.wavePh) * s.waveAmp;
          const rip2 = Math.sin(((i + 1) / PATH_N) * 5 + t * 0.004 + s.wavePh) * s.waveAmp;
          ctx.beginPath();
          ctx.moveTo(s.startX + s.dir * s.pts[i * 2], s.pts[i * 2 + 1] + rip1);
          ctx.lineTo(s.startX + s.dir * s.pts[i * 2 + 2], s.pts[i * 2 + 3] + rip2);
          ctx.stroke();
        }
        return true;
      });
      ctx.globalAlpha = 1;

      // Leaves: inertia toward the wind speed, gravity, flutter, gust lift.
      for (const l of this.leaves) {
        const target = windSpeed * l.drag;
        l.vx += (target - l.vx) * 0.04 * dt;
        l.vy = Math.min(l.vy + 0.045 * dt, l.maxFall);
        if (gust > 1.05) l.vy = Math.max(l.vy - (gust - 1) * 0.16 * dt, -1.2);
        l.x += l.vx * dt;
        l.y += (l.vy + Math.sin(t * 0.004 * l.flutter + l.phase) * 0.6) * dt;
        l.rot += (l.spin + l.vx * 0.004) * dt;
        l.flip += l.flipSpeed * dt;

        const m = 40;
        if (
          l.y > h + m || l.y < -m * 2 ||
          (dir > 0 && l.x > w + m) || (dir < 0 && l.x < -m)
        ) {
          l.reset(w, h, windSpeed);
        }

        const squish = 0.18 + 0.5 * Math.abs(Math.sin(l.flip));
        ctx.globalAlpha = l.alpha;
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.ellipse(l.x, l.y, l.r, l.r * squish, l.rot, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    destroy() {
      this.running = false;
      window.removeEventListener('resize', this.onResize);
    }
  }

  window.WindEffect = WindEffect;
})();
