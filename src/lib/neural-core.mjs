/* Jupiter's neural core: the node "brain" from the Neural core v1 prototype, with a small sun at its
   centre. One 2D canvas, no dependencies, no network. createCore(canvas, options) returns a
   controller; call destroy() when the canvas leaves the page.

   States:
   - ambient (passive): the brain's idle animation, its colours dulled to the sun's blue; a blue sun.
   - listening: pulses run inward from the surface, in teal.
   - thinking / reading: busy violet pulses wander across the cortex (Jupiter, Claude or Codex working).
   - speaking: each beat of Jupiter's voice fires a burst from the core; the sun turns orange and pulses.
   Faint dust floats around the outside. */
export function createCore(canvas, o = {}) {
    const opt = Object.assign({ radius: 0.38, cx: 0.5, cy: 0.42, dim: 1, idleFps: 30, seed: 20261101, base: 'ambient' }, o);
    const ctx = canvas.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0;
    function resize() { const d = Math.min(2, devicePixelRatio || 1); const r = canvas.getBoundingClientRect(); W = r.width; H = r.height; canvas.width = Math.round(W * d); canvas.height = Math.round(H * d); ctx.setTransform(d, 0, 0, d, 0, 0); if (reduced) draw(); }
    const observer = new ResizeObserver(resize); observer.observe(canvas);

    // ---- Build the brain (seeded, so every load looks the same) ----
    let seed = opt.seed; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const sq = v => v * v;
    function inBrain(x, y, z) {   // x: back(-) to front(+), y: up(-) to down(+), z: left/right
      const cerebrum = sq(x) + sq((y + 0.05) / 0.62) + sq(z / 0.72) <= 1 && y < 0.40;
      const temporal = sq((x - 0.12) / 0.56) + sq((y - 0.36) / 0.22) + sq(z / 0.62) <= 1;
      const cerebellum = sq((x + 0.6) / 0.32) + sq((y - 0.48) / 0.19) + sq(z / 0.46) <= 1;
      const stem = sq((x + 0.22) / 0.1) + sq(z / 0.11) <= 1 && y > 0.3 && y < 0.92;
      return cerebrum || temporal || cerebellum || stem;
    }
    const N = []; let tries = 0;
    while (N.length < 1120 && tries++ < 300000) {
      const x = rnd() * 2 - 1, y = rnd() * 2 - 1, z = rnd() * 2 - 1;
      if (!inBrain(x, y, z)) continue;
      const surface = !inBrain(x * 1.1, (y + 0.05) * 1.1 - 0.05, z * 1.1);
      if (surface || rnd() < 0.1) N.push({ x, y, z, surface, core: false });
    }
    for (let i = 0; i < 44; i++) { const t = i / 43; N.push({ x: -0.2 - t * 0.06 + (rnd() - 0.5) * 0.06, y: 0.42 + t * 0.48, z: (rnd() - 0.5) * 0.14, surface: true, core: false }); } // brainstem
    for (let i = 0; i < 65; i++) { // the warm inner core, where speech starts
      const a = rnd() * Math.PI * 2, b = Math.acos(rnd() * 2 - 1), r = 0.17 * Math.cbrt(rnd());
      N.push({ x: 0.02 + r * Math.sin(b) * Math.cos(a) * 1.3, y: 0.02 + r * Math.cos(b), z: r * Math.sin(b) * Math.sin(a), surface: false, core: true });
    }
    const n = N.length; const adj = Array.from({ length: n }, () => []); const edges = [];
    for (let i = 0; i < n; i++) {
      const k = N[i].core ? 4 : 3, best = [];
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const e = sq(N[i].x - N[j].x) + sq(N[i].y - N[j].y) + sq(N[i].z - N[j].z);
        if (best.length < k || e < best[best.length - 1][0]) { best.push([e, j]); best.sort((a, b) => a[0] - b[0]); if (best.length > k) best.pop(); }
      }
      for (const [, j] of best) if (!adj[i].includes(j)) { adj[i].push(j); adj[j].push(i); edges.push([i, j]); }
    }
    // Long "tract" links from the core to the cortex, so speech reaches the surface quickly.
    const coreIdx = N.map((p, i) => p.core ? i : -1).filter(i => i >= 0);
    const surfIdx = N.map((p, i) => p.surface ? i : -1).filter(i => i >= 0);
    for (let k = 0; k < 26; k++) { const a = coreIdx[Math.floor(rnd() * coreIdx.length)]; const b = surfIdx[Math.floor(rnd() * surfIdx.length)]; adj[a].push(b); adj[b].push(a); edges.push([a, b, 1]); }
    const radius = N.map(p => Math.hypot(p.x - 0.02, p.y - 0.02, p.z));
    const baseHue = N.map(p => p.core ? 18 : p.surface ? 265 + (p.y + 1) * 25 + (rnd() - 0.5) * 30 : 225 + rnd() * 20);
    const flash = new Float32Array(n), lastFire = new Float64Array(n), hueNow = new Float32Array(n);
    const PX = new Float32Array(n), PY = new Float32Array(n), PS = new Float32Array(n);

    // Dust: faint motes drifting slowly around the outside of the brain.
    const dust = Array.from({ length: 70 }, () => { const a = rnd() * 6.283, b = Math.acos(rnd() * 2 - 1), r = 1.25 + rnd() * 1.1; return { x: r * Math.sin(b) * Math.cos(a), y: r * Math.cos(b) * 0.75, z: r * Math.sin(b) * Math.sin(a), s: 0.6 + rnd() * 0.9, a: 0.2 + rnd() * 0.3, ph: rnd() * 6.283, sp: 0.15 + rnd() * 0.25 }; });

    // ---- Colour helpers ----
    function hsl(h, s, l) { const a = s * Math.min(l, 1 - l), f = k0 => { const k = (k0 + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0) * 255, f(8) * 255, f(4) * 255]; }
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.max(0, Math.min(1, a))})`;

    // ---- Pulses ----
    const pulses = []; const MAX = 380;
    const COLORS = { ambient: 214, listening: 160, thinking: 265, speaking: 192 };
    let state = opt.base, level = 0, now = 0, acc = 0, voice = 0, voiceAt = -1e9, synthetic = false;
    let calm = 1, warm = 0, lit = 0; // calm: dulled to the sun's blue. warm: the sun turns orange while she speaks.
    const mood = () => state === 'reading' ? 'thinking' : state === 'idle' ? 'ambient' : state;
    function fire(i, energy, hue, from = -1, inward = false) {
      if (now - lastFire[i] < 230) return; lastFire[i] = now;
      flash[i] = Math.min(1, flash[i] + 0.35 + energy * 0.4); hueNow[i] = hue;
      if (energy < 0.16 || reduced) return;
      for (const j of adj[i]) {
        if (j === from || pulses.length >= MAX) continue;
        if (inward && radius[j] > radius[i] + 0.02) continue;
        if (rnd() < 0.3 + energy * 0.38) pulses.push({ a: i, b: j, t: 0, v: 2.4 + rnd() * 1.6 + (mood() === 'speaking' ? 1.6 : 0), e: energy * (0.74 + rnd() * 0.1), hue, inward });
      }
    }
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    function burst(strength = 1) { for (let k = 0; k < 2 + Math.round(strength * 2); k++) fire(pick(coreIdx), 0.9 + strength * 0.2, COLORS.speaking); }
    function drive(dt) {
      acc += dt;
      const m = mood();
      calm += ((m === 'ambient' ? 1 : 0) - calm) * Math.min(1, dt * 2);
      warm += ((m === 'speaking' ? 1 : 0) - warm) * Math.min(1, dt * (m === 'speaking' ? 6 : 1.5));
      lit += ((m === 'ambient' ? 0 : 1) - lit) * Math.min(1, dt * 0.9);
      if (now - voiceAt > 250 && !synthetic) voice *= Math.pow(0.02, dt);
      if (m === 'ambient') { if (acc > 1.6 + rnd() * 1.4) { acc = 0; fire(Math.floor(rnd() * n), 0.45, COLORS.ambient); } }
      // Thinking: busier than the prototype, so it reads as hard at work.
      else if (m === 'thinking') { if (acc > 0.045) { acc = 0; fire(pick(surfIdx), 0.66 + rnd() * 0.1, COLORS.thinking); } }
      else if (m === 'listening') { const lv = 0.35 + 0.35 * Math.abs(Math.sin(now / 410) * Math.sin(now / 1270)); level = lv; if (acc > 0.16 - lv * 0.1) { acc = 0; if (rnd() < 0.35 + lv) fire(pick(surfIdx), 0.5 + lv * 0.5, COLORS.listening, -1, true); } }
      else if (m === 'speaking') { level = voice; if (acc > 0.07 && voice > 0.3) { acc = 0; burst(voice); } }
    }
    function step(dt) {
      for (let i = 0; i < n; i++) flash[i] *= Math.pow(0.08, dt);
      for (let k = pulses.length - 1; k >= 0; k--) { const p = pulses[k]; p.t += p.v * dt; if (p.t >= 1) { pulses.splice(k, 1); fire(p.b, p.e, p.hue, p.a, p.inward); } }
    }

    // ---- The sun's surface: churning noise shaded like a sphere, blue with bright filaments, orange when she speaks ----
    const perm = new Uint8Array(512); { const p = Array.from({ length: 256 }, (_, i) => i); for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
    const cell = (x, y) => perm[(perm[x & 255] + y) & 255] / 255;
    function noise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf); const a = cell(xi, yi), b = cell(xi + 1, yi), c = cell(xi, yi + 1), d = cell(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
    const SUN_PX = 112, sunCanvas = document.createElement('canvas'); sunCanvas.width = sunCanvas.height = SUN_PX;
    const sunCtx = sunCanvas.getContext('2d'), sunImage = sunCtx.createImageData(SUN_PX, SUN_PX);
    const HOT = [[150, 40, 6], [235, 105, 20], [255, 170, 55], [255, 225, 140], [255, 250, 235]];
    const COLD = [[6, 14, 70], [16, 50, 170], [40, 105, 240], [120, 180, 255], [235, 245, 255]];
    const ramp = (pal, t) => { const x = Math.max(0, Math.min(0.999, t)) * (pal.length - 1), i = Math.floor(x), f = x - i; return mix(pal[i], pal[i + 1], f); };
    function paintSun(beat) {
      const data = sunImage.data, half = SUN_PX / 2, time = now / 1000;
      for (let py2 = 0; py2 < SUN_PX; py2++) for (let px2 = 0; px2 < SUN_PX; px2++) {
        const x = (px2 + 0.5 - half) / half, y = (py2 + 0.5 - half) / half, d2 = x * x + y * y, o = (py2 * SUN_PX + px2) * 4;
        if (d2 > 1) { data[o + 3] = 0; continue; }
        const z = Math.sqrt(1 - d2), sx = x / (z + 0.35), sy = y / (z + 0.35);
        const grain = noise(sx * 6 + time * 0.3, sy * 6 - time * 0.22) * 0.6 + noise(sx * 14 - time * 0.5, sy * 14 + time * 0.4) * 0.4;
        // Bright, thin filaments where the noise crosses its middle, like the loops on a blue sun.
        const filament = Math.pow(1 - Math.min(1, Math.abs(noise(sx * 4 - time * 0.18, sy * 4 + time * 0.15) - 0.5) * 7), 3);
        const spots = (1 - lit) * Math.max(0, 0.5 - grain) * 0.9;
        const heat = Math.max(0, Math.min(1, ((grain - 0.5) * 1.3 + 0.22 + Math.pow(z, 1.5) * 0.42 + filament * (0.5 - warm * 0.25)) * (0.62 + lit * 0.38) - spots));
        const c = mix(ramp(COLD, heat), ramp(HOT, heat), warm);
        const edge = Math.min(1, (1 - Math.sqrt(d2)) * 14);
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255 * edge * opt.dim;
      }
      sunCtx.putImageData(sunImage, 0, 0);
    }

    // ---- Render ----
    let yaw = 0, px = 0, py = 0, tx = 0, ty = 0;
    function draw() {
      if (!W) return;
      yaw = (reduced ? 0.3 : Math.sin(now / 9000) * 0.42 + 0.25) + px * 0.2;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), dim = opt.dim;
      const R = Math.min(W / 2.5, H / 1.85) * 0.81 * (opt.radius / 0.38), ox = W * opt.cx - px * 14, oy = H * opt.cy - R * 0.02 - py * 10;
      for (let i = 0; i < n; i++) { const p = N[i]; const x = p.x * cy - p.z * sy, z = p.x * sy + p.z * cy; const f = 2.6 / (2.6 - z); PX[i] = ox + x * R * f; PY[i] = oy + p.y * R * f; PS[i] = f; }
      ctx.clearRect(0, 0, W, H);
      const energy = Math.min(1, pulses.length / 220 + warm * level * 0.5);
      // The centre of the core, where the sun sits.
      const cz = 0.02 * sy, cf = 2.6 / (2.6 - cz), sunX = ox + (0.02 * cy) * R * cf, sunY = oy + 0.02 * R * cf;
      let g = ctx.createRadialGradient(ox, oy + R * 0.05, 0, ox, oy + R * 0.05, R * 1.25); g.addColorStop(0, `rgba(60,90,255,${(0.10 + energy * 0.12) * dim})`); g.addColorStop(1, 'rgba(20,30,90,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // The core glow: blue at rest, the prototype's warm orange while she speaks.
      const glowCol = mix([90, 150, 255], [255, 140, 90], warm);
      g = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, R * (0.35 + warm * level * 0.15) * 0.8); g.addColorStop(0, rgba(glowCol, (0.08 + lit * 0.08 + energy * 0.3 + warm * level * 0.3) * 0.8 * dim)); g.addColorStop(1, rgba(glowCol, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      // Dust outside the brain.
      for (const d of dust) {
        const x = d.x * cy - d.z * sy, z = d.x * sy + d.z * cy, f = 2.6 / Math.max(0.6, 2.6 - z * 0.6);
        const dx = ox + x * R * f + Math.sin(now / 4000 * d.sp + d.ph) * 6, dy = oy + d.y * R * f + Math.cos(now / 5000 * d.sp + d.ph) * 5;
        ctx.fillStyle = `rgba(170,200,255,${d.a * (0.7 + 0.3 * Math.sin(now / 2200 + d.ph)) * dim})`; ctx.beginPath(); ctx.arc(dx, dy, d.s, 0, 6.283); ctx.fill();
      }
      // Links.
      ctx.lineWidth = 0.6; ctx.strokeStyle = `rgba(100,140,255,${0.145 * dim})`; ctx.beginPath();
      for (const [a, b, tract] of edges) { if (tract) continue; ctx.moveTo(PX[a], PY[a]); ctx.lineTo(PX[b], PY[b]); }
      ctx.stroke();
      ctx.strokeStyle = `rgba(80,230,190,${0.07 * dim})`; ctx.lineWidth = 1.4; ctx.beginPath();
      for (const [a, b, tract] of edges) { if (!tract) continue; ctx.moveTo(PX[a], PY[a]); ctx.lineTo(PX[b], PY[b]); }
      ctx.stroke();
      // Pulses: a bright head with a short tail.
      for (const p of pulses) {
        const t = Math.min(1, p.t), t2 = Math.max(0, t - (p.hue === COLORS.speaking ? 0.55 : 0.35));
        const hx = PX[p.a] + (PX[p.b] - PX[p.a]) * t, hy = PY[p.a] + (PY[p.b] - PY[p.a]) * t;
        const tx2 = PX[p.a] + (PX[p.b] - PX[p.a]) * t2, ty2 = PY[p.a] + (PY[p.b] - PY[p.a]) * t2;
        const al = Math.min(1, p.e + 0.25) * dim;
        ctx.strokeStyle = `hsla(${p.hue},100%,70%,${al * 0.55})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(tx2, ty2); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.fillStyle = `hsla(${p.hue},100%,85%,${al})`; ctx.beginPath(); ctx.arc(hx, hy, 1.9, 0, 6.283); ctx.fill();
      }
      // Nodes: the prototype's colours, dulled towards the sun's blue while passive.
      const dull = [70, 120, 230];
      for (let i = 0; i < n; i++) {
        const f = flash[i]; const depth = (PS[i] - 0.72) / 0.6; const p = N[i];
        const base = p.core ? 0.6 : p.surface ? 0.62 : 0.3;
        const a = Math.min(1, (base * (1 - calm * 0.12) + f * 0.8) * (0.62 + depth * 0.5)) * dim;
        const hue = f > 0.15 ? hueNow[i] : baseHue[i]; const light = (p.core ? 0.68 : 0.66 + f * 0.22);
        let col = hsl(hue, p.core ? 0.95 : 0.85, light);
        if (calm > 0.01 && f <= 0.15) col = mix(col, dull, calm * 0.49);
        const r = (p.core ? 1.5 : 1.15) * PS[i] + f * 1.2;
        if (f > 0.4) { ctx.fillStyle = rgba(col, f * 0.1 * dim); ctx.beginPath(); ctx.arc(PX[i], PY[i], r * 2.6, 0, 6.283); ctx.fill(); }
        ctx.fillStyle = rgba(col, a); ctx.beginPath(); ctx.arc(PX[i], PY[i], r, 0, 6.283); ctx.fill();
      }
      // The sun keeps its size. Its glow does the work: dim blue at rest, brighter and breathing while
      // thinking or listening, and an orange glow pulsing with her voice while she speaks.
      const beat = warm * level;
      const sun = R * 0.075;
      const breathe = 0.5 + 0.5 * Math.sin(now / 520);
      // 20% smaller and softer than before, so it stays subtle.
      const glow = ((1 - warm) * (0.18 + lit * (0.32 + breathe * 0.3)) + warm * (0.35 + beat * 0.6)) * 0.8;
      const reach = sun * (2.2 + (1 - warm) * lit * breathe * 1.2 + warm * beat * 2.4) * 0.8;
      g = ctx.createRadialGradient(sunX, sunY, sun * 0.7, sunX, sunY, reach);
      g.addColorStop(0, rgba(mix([110, 170, 255], [255, 160, 60], warm), glow * dim)); g.addColorStop(1, rgba(mix([40, 90, 255], [255, 90, 20], warm), 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sunX, sunY, reach, 0, 6.283); ctx.fill();
      paintSun(beat);
      ctx.drawImage(sunCanvas, sunX - sun, sunY - sun, sun * 2, sun * 2);
      g = ctx.createRadialGradient(sunX, sunY, sun * 0.8, sunX, sunY, sun * 1.15); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, rgba(mix([170, 210, 255], [255, 220, 150], warm), (0.2 + lit * 0.25) * dim)); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sunX, sunY, sun * 1.15, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    let running = false, last = 0, lastDraw = 0;
    function frame(ts) {
      if (!running) return; requestAnimationFrame(frame);
      const active = mood() !== 'ambient' || pulses.length > 0 || warm > 0.01 || calm < 0.99 || lit > 0.01;
      if (!active && ts - lastDraw < 1000 / opt.idleFps) return;
      const dt = Math.min(0.05, (ts - last) / 1000 || 0.016); last = ts; lastDraw = ts; now += dt * 1000;
      px += (tx - px) * Math.min(1, dt * 3); py += (ty - py) * Math.min(1, dt * 3);
      drive(dt); step(dt); draw();
    }
    function start() { if (running || reduced) return; running = true; last = performance.now(); requestAnimationFrame(frame); }
    let destroyed = false; const onVisibility = () => { if (destroyed) return; if (document.hidden) running = false; else start(); };
    document.addEventListener('visibilitychange', onVisibility);
    resize(); if (reduced) { for (let k = 0; k < 40; k++) fire(Math.floor(rnd() * n), 0.3, COLORS.ambient); draw(); } else start();

    let speakTimer = null;
    return {
      destroy() { destroyed = true; running = false; clearInterval(speakTimer); observer.disconnect(); document.removeEventListener('visibilitychange', onVisibility); },
      get state() { return state; },
      setState(s) { state = s; acc = 0; if (reduced) draw(); },
      get palette() { return 'brain'; },
      setPalette() { /* colours follow the state */ },
      /** A burst from the core, for confirmations. */
      pulse(s = 1) { burst(Math.min(1.2, s)); if (reduced) draw(); },
      /** The brain keeps its own slow sway; the mouse doesn't move it. */
      setPointer() { },
      /** The loudness of Jupiter's voice right now, 0 to 1. */
      setVoice(value) { voice = Math.max(voice * 0.6, Math.min(1, value)); voiceAt = now; },
      /** Without audio levels: a beat per word while the text would be spoken. */
      say(text) {
        clearInterval(speakTimer); let left = String(text).split(/\s+/).filter(Boolean).length; state = 'speaking'; synthetic = true;
        return new Promise(res => { speakTimer = setInterval(() => { if (left-- <= 0) { clearInterval(speakTimer); synthetic = false; state = opt.base; res(); return; } voice = 0.55 + rnd() * 0.4; voiceAt = now; }, 230); });
      },
    };
}
