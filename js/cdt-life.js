// Causal Dynamical Triangulation × Game of Life  (p5.js, global mode)
// ----------------------------------------------------------------------------
// Spacetime is a stack of 1D spatial slices (horizontal rows, time runs up).
// Between slice s and s+1 lies a strip of cells glued along timelike edges:
//   U = (2,1) triangle  – base on the past slice, apex on the future slice
//   D = (1,2) triangle  – apex in the past, base in the future
//   Q = (2,2) square    – a U+D pair with its shared timelike diagonal removed
// A strip is just a cyclic list of timelike edges (b,t); each cell sits
// between two consecutive edges and advances b, t, or both (U, D, Q).
// The geometry keeps fluctuating through local CDT moves:
//   flip  : UD <-> DU <-> Q          (toggle a diamond's diagonal)
//   (2,4) : insert a vertex on a slice (space grows), (4,2) removes one
// Spatial volumes follow the CDT effective action, a kinetic (ΔN)^2/N term
// between neighbouring slices, and living cells ("matter") stretch the
// slice they live on. Life runs on the cells; a cell's neighbours are
// every cell that shares a vertex with it, and its rule uses the *fraction*
// of live neighbours, since coordination numbers vary across the lattice.
// Spacetime is a torus (periodic in space and time), so the canvas can
// scroll upward forever like the old waterfall background.

const CFG = {
  cell: 34,                 // target spatial edge length (px)
  sigma: 0.45,              // square fugacity: weight of Q vs one diagonal
  curvature: 0.35,          // R² term: 0 = wild quantum foam, 1+ = nearly flat
  flipsPerSec: 2400,        // diagonal flip / merge / split attempts
  volMovesPerSec: 160,      // vertex insert / remove attempts
  kinetic: 1.2,             // CDT kinetic term  (N_t+1 - N_t)^2 / (N_t+1 + N_t)
  pin: 0.02,                // soft pin of each slice to its target length
  gravity: 0.35,            // how much life stretches its slice
  lifeMs: 450,              // ms per Life generation
  birth: [0.27, 0.37],      // live-neighbour fraction that gives birth
  survive: [0.17, 0.42],    // live-neighbour fraction that survives
  vacuum: 0.0004,           // spontaneous birth chance per cell per generation
  relief: 0.14,             // resting bevel of every cell (the bare lattice)
  bevel: 0.62,              // max inset of a fully alive cell (0..1)
  drift: 7,                 // upward scroll, px per second (0 = still)
  light: [-0.55, -0.83],    // light direction (screen coords, up-left)
  bg: 10,                   // background gray
};

let W, H, T, N0, h;         // canvas, slice count, target length, slice spacing
let X = [];                 // X[t][i]: x of vertex i on slice t (cyclic order)
let S = [];                 // S[s]: strip between slice s and s+1
let scrollY = 0, lastLife = 0, paused = false, mouseT = -1e9, lambda = 0;
const rint = n => Math.floor(Math.random() * n);
const N = t => X[t].length;
const wrapD = d => d - W * Math.round(d / W);           // shortest signed dx
const mod = (a, n) => ((a % n) + n) % n;

// ---------- setup / draw ----------------------------------------------------

function setup() {
  const host = document.getElementById('cdt-bg');       // site container, if any
  W = host ? host.clientWidth : windowWidth;
  H = host ? host.clientHeight : windowHeight;
  const c = createCanvas(W, H);
  if (host) c.parent(host);
  pixelDensity(Math.min(2, displayDensity()));
  buildSpacetime();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) CFG.drift = 0;
}

function windowResized() {
  const host = document.getElementById('cdt-bg');
  W = host ? host.clientWidth : windowWidth;
  H = host ? host.clientHeight : windowHeight;
  resizeCanvas(W, H);
  buildSpacetime();
}

function draw() {
  const dt = Math.min(deltaTime, 50) / 1000;
  if (!paused) {
    let k = Math.round(CFG.flipsPerSec * dt);
    while (k--) flipMove();
    k = Math.round(CFG.volMovesPerSec * dt);
    while (k--) (Math.random() < 0.5 ? insertVertex : removeVertex)();
    tuneLambda();
    relax(0.25);
    if (millis() - lastLife > CFG.lifeMs) { lifeStep(); lastLife = millis(); }
    scrollY = mod(scrollY + CFG.drift * dt, H);
  }
  ease(dt);
  render();
}

function mouseMoved() { mouseT = millis(); }
function touchMoved() { mouseT = millis(); }

function keyPressed() {
  if (key === ' ') paused = !paused;
  if (key === 'r') seedLife(0.3);
  if (key === 'q') CFG.sigma = CFG.sigma > 0 ? 0 : 0.45;  // squares on/off
}

// ---------- spacetime construction ------------------------------------------

function buildSpacetime() {
  N0 = Math.max(8, Math.round(W / CFG.cell));
  const h0 = CFG.cell * Math.sqrt(3) / 2;
  T = Math.max(4, 2 * Math.round(H / h0 / 2));          // even, so rows interlock
  h = H / T;                                             // exact fit: seamless wrap
  const dx = W / N0;
  X = []; S = [];
  for (let t = 0; t < T; t++)                            // staggered rows
    X[t] = Array.from({ length: N0 }, (_, i) => (i + 0.5 * (t % 2)) * dx);
  for (let s = 0; s < T; s++) {
    const st = { b: [], t: [], st: [], lv: [], age: [] };
    for (let i = 0; i < N0; i++) {
      if (s % 2 === 0) { pushEdge(st, i, i); pushEdge(st, (i + 1) % N0, i); }  // U D
      else             { pushEdge(st, i, i); pushEdge(st, i, (i + 1) % N0); }  // D U
    }
    S[s] = st;
  }
  for (let i = 0; i < 40 * T * N0; i++) flipMove();     // thermalise geometry
  lambda = 0;
  for (let i = 0; i < 4 * T * N0; i++) {
    (i % 2 ? insertVertex : removeVertex)();
    if (i % 50 === 0) tuneLambda();
  }
  for (let i = 0; i < 40 * T * N0; i++) flipMove();
  for (let i = 0; i < 80; i++) relax(0.5);
  seedLife(0.3);
}

function pushEdge(st, b, t) { st.b.push(b); st.t.push(t); st.st.push(0); st.lv.push(0); st.age.push(0); }

function seedLife(p) {
  for (const st of S) for (let c = 0; c < st.b.length; c++) {
    st.st[c] = Math.random() < p ? 1 : 0; st.age[c] = st.st[c];
  }
}

// cell c of strip s advances the past slice by dB and the future slice by dT
const dB = (st, s, c) => mod(st.b[(c + 1) % st.b.length] - st.b[c], N(s));
const dT = (st, s, c) => mod(st.t[(c + 1) % st.t.length] - st.t[c], N((s + 1) % T));

function insertEdge(st, c, b, t) {                       // new edge after edge c
  const j = c + 1;                                       // new cell copies cell c
  st.b.splice(j, 0, b); st.t.splice(j, 0, t);
  st.st.splice(j, 0, st.st[c]); st.lv.splice(j, 0, st.lv[c]); st.age.splice(j, 0, st.age[c]);
}

function removeEdge(st, j) {                             // merge cells j-1 and j
  const p = mod(j - 1, st.b.length);
  st.st[p] |= st.st[j];
  st.lv[p] = Math.max(st.lv[p], st.lv[j]);
  st.age[p] = Math.max(st.age[p], st.age[j]);
  for (const a of [st.b, st.t, st.st, st.lv, st.age]) a.splice(j, 1);
}

// ---------- CDT moves ------------------------------------------------------

// Corner angles a diamond (b, b+1 | t, t+1) gives its four vertices.
const CORNERS = { UD: [60, 120, 120, 60], DU: [120, 60, 60, 120], Q: [90, 90, 90, 90] };

function fanAngle(st, s, v, side) {                      // angle at v from one strip
  const a = st[side], M = a.length; let sum = 0;
  for (let c = 0; c < M; c++)
    if (a[c] === v || a[(c + 1) % M] === v) sum += dB(st, s, c) && dT(st, s, c) ? 90 : 60;
  return sum;
}

function angleAt(t, v) {                                 // total angle around vertex
  return fanAngle(S[t], t, v, 'b') + fanAngle(S[mod(t - 1, T)], mod(t - 1, T), v, 't');
}

function flipMove() {                                    // heat bath on a diamond
  const s = rint(T), st = S[s], M = st.b.length, c = rint(M), c1 = (c + 1) % M;
  const u = (s + 1) % T, nb = N(s), nt = N(u);
  const b0 = dB(st, s, c), t0 = dT(st, s, c);
  let cur;
  if (b0 && t0) cur = 'Q';
  else {
    const b1 = dB(st, s, c1), t1 = dT(st, s, c1);
    if ((b1 && t1) || b0 === b1) return;                 // not a UD / DU diamond
    cur = b0 ? 'UD' : 'DU';
  }
  // Boltzmann weight of each option: square fugacity × curvature-squared action
  const b = st.b[c], t = st.t[c];
  const ang = [angleAt(s, b), angleAt(s, (b + 1) % nb), angleAt(u, t), angleAt(u, (t + 1) % nt)];
  const w = {};
  let tot = 0;
  for (const k of ['UD', 'DU', 'Q']) {
    let R2 = 0;
    for (let i = 0; i < 4; i++) R2 += ((360 - ang[i] + CORNERS[cur][i] - CORNERS[k][i]) / 60) ** 2;
    tot += w[k] = (k === 'Q' ? CFG.sigma : 1) * Math.exp(-CFG.curvature * R2);
  }
  let r = Math.random() * tot, next = 'UD';
  for (const k of ['UD', 'DU', 'Q']) { if (r < w[k]) { next = k; break; } r -= w[k]; }
  if (next === cur) return;
  if (cur === 'Q') {                                     // split the square
    insertEdge(st, c, next === 'UD' ? (b + 1) % nb : b, next === 'UD' ? t : (t + 1) % nt);
  } else if (next === 'Q') {
    removeEdge(st, c1);                                  // merge into a square
  } else {
    st.b[c1] = next === 'UD' ? (b + 1) % nb : b;         // swap the diagonal
    st.t[c1] = next === 'UD' ? t : (t + 1) % nt;
  }
}

function sliceLife(t) {                                  // live fraction around slice t
  let a = 0, n = 0;
  for (const st of [S[t], S[mod(t - 1, T)]]) for (const v of st.st) { a += v; n++; }
  return n ? a / n : 0;
}

function action(t, n) {                                  // terms of S that involve N_t
  const up = N((t + 1) % T), dn = N(mod(t - 1, T));
  const target = N0 * (1 + CFG.gravity * (sliceLife(t) - 0.15));
  return CFG.kinetic * ((up - n) ** 2 / (up + n) + (dn - n) ** 2 / (dn + n))
       + CFG.pin * (n - target) ** 2 + lambda * n;
}

function tuneLambda() {                                  // cosmological constant that
  let v = 0;                                             // holds the mean volume at N0
  for (const r of X) v += r.length;                      // (entropy alone would grow it)
  lambda += 0.01 * (v / T - N0);
}

function metropolis(t, d) {
  const dS = action(t, N(t) + d) - action(t, N(t));
  return dS <= 0 || Math.random() < Math.exp(-dS);
}

function insertVertex() {                                // (2,4): split edge (k,k+1)
  const t = rint(T), n = N(t);
  if (n >= 2 * N0 || !metropolis(t, +1)) return;
  const sb = mod(t - 1, T), below = S[sb], above = S[t];
  const k = rint(n);
  let cb = -1, ca = -1;
  for (let c = 0; c < below.t.length; c++) if (below.t[c] === k && dT(below, sb, c)) { cb = c; break; }
  for (let c = 0; c < above.b.length; c++) if (above.b[c] === k && dB(above, t, c)) { ca = c; break; }
  if (cb < 0 || ca < 0) return;
  const qb = dB(below, sb, cb), qa = dT(above, t, ca);   // squares need a side choice
  for (let i = 0; i < below.t.length; i++) if (below.t[i] > k) below.t[i]++;
  for (let i = 0; i < above.b.length; i++) if (above.b[i] > k) above.b[i]++;
  const x0 = X[t][k], x1 = X[t][(k + 1) % n];
  X[t].splice(k + 1, 0, mod(x0 + wrapD(x1 - x0) / 2, W));
  const bNew = qb && Math.random() < 0.5 ? (below.b[cb] + 1) % N(sb) : below.b[cb];
  insertEdge(below, cb, bNew, k + 1);
  const ta = (t + 1) % T;
  const tNew = qa && Math.random() < 0.5 ? (above.t[ca] + 1) % N(ta) : above.t[ca];
  insertEdge(above, ca, k + 1, tNew);
}

function removeVertex() {                                // (4,2): drop a 4-valent vertex
  const t = rint(T), n = N(t);
  if (n <= Math.max(6, N0 >> 1) || !metropolis(t, -1)) return;
  const sb = mod(t - 1, T), below = S[sb], above = S[t], v = rint(n);
  let jb = -1, ja = -1, cb = 0, ca = 0;
  for (let i = 0; i < below.t.length; i++) if (below.t[i] === v) { jb = i; cb++; }
  for (let i = 0; i < above.b.length; i++) if (above.b[i] === v) { ja = i; ca++; }
  if (cb !== 1 || ca !== 1) return;                      // one edge down, one up
  const Mb = below.b.length, Ma = above.b.length;
  if (dB(below, sb, mod(jb - 1, Mb)) && dB(below, sb, jb)) return;   // QQ can't merge
  if (dT(above, t, mod(ja - 1, Ma)) && dT(above, t, ja)) return;
  removeEdge(below, jb); removeEdge(above, ja);
  for (let i = 0; i < below.t.length; i++) if (below.t[i] > v) below.t[i]--;
  for (let i = 0; i < above.b.length; i++) if (above.b[i] > v) above.b[i]--;
  X[t].splice(v, 1);
}

// ---------- embedding: springs along slices and timelike edges ---------------

function relax(alpha) {
  const sum = X.map(r => new Float64Array(r.length)), cnt = X.map(r => new Float64Array(r.length));
  const wt = 0.6, ws = 1;
  for (let s = 0; s < T; s++) {
    const st = S[s], u = (s + 1) % T;
    for (let i = 0; i < st.b.length; i++) {
      const b = st.b[i], t = st.t[i], d = wrapD(X[u][t] - X[s][b]);
      sum[s][b] += wt * d; cnt[s][b] += wt;
      sum[u][t] -= wt * d; cnt[u][t] += wt;
    }
  }
  for (let t = 0; t < T; t++) {
    const r = X[t], n = r.length, nx = new Float64Array(n);
    for (let i = 0; i < n; i++) {                        // gaps to cyclic neighbours
      const gl = mod(r[i] - r[(i - 1 + n) % n], W), gr = mod(r[(i + 1) % n] - r[i], W);
      const step = alpha * (ws * (gr - gl) + sum[t][i]) / (2 * ws + cnt[t][i]);
      nx[i] = r[i] + Math.max(-0.45 * gl, Math.min(0.45 * gr, step));  // never overtake
    }
    for (let i = 0; i < n; i++) r[i] = mod(nx[i], W);
  }
}

// ---------- Life ------------------------------------------------------------

function cellVerts(st, s, c, off) {                      // global vertex ids of a cell
  const M = st.b.length, u = (s + 1) % T, c1 = (c + 1) % M;
  const v = [off[s] + st.b[c], off[u] + st.t[c]];
  if (st.b[c1] !== st.b[c]) v.push(off[s] + st.b[c1]);
  if (st.t[c1] !== st.t[c]) v.push(off[u] + st.t[c1]);
  return v;
}

function lifeStep() {
  const off = [], cOff = []; let V = 0, C = 0;
  for (let t = 0; t < T; t++) { off[t] = V; V += N(t); cOff[t] = C; C += S[t].b.length; }
  const inc = Array.from({ length: V }, () => []), verts = [], alive = new Uint8Array(C);
  for (let s = 0; s < T; s++) {
    const st = S[s];
    for (let c = 0; c < st.b.length; c++) {
      const id = cOff[s] + c, vs = cellVerts(st, s, c, off);
      verts[id] = vs; alive[id] = st.st[c];
      for (const v of vs) inc[v].push(id);
    }
  }
  const stamp = new Int32Array(C).fill(-1);
  let pop = 0;
  for (let s = 0; s < T; s++) {
    const st = S[s], next = [];
    for (let c = 0; c < st.b.length; c++) {
      const id = cOff[s] + c; let a = 0, n = 0;
      stamp[id] = id;
      for (const v of verts[id]) for (const o of inc[v])
        if (stamp[o] !== id) { stamp[o] = id; n++; a += alive[o]; }
      const f = a / n, live = alive[id];
      const on = live ? f >= CFG.survive[0] && f <= CFG.survive[1]
                      : (f >= CFG.birth[0] && f <= CFG.birth[1]) || Math.random() < CFG.vacuum;
      next[c] = on ? 1 : 0;
      st.age[c] = on ? (live ? st.age[c] + 1 : 1) : 0;
      pop += next[c];
    }
    st.st = next;
  }
  if (pop < 0.02 * C) seedPatch();                       // keep the universe going
}

function seedPatch() {                                   // a random blob of matter
  const s0 = rint(T), st0 = S[s0], c0 = rint(st0.b.length), x0 = X[s0][st0.b[c0]];
  for (let ds = -2; ds <= 2; ds++) {
    const st = S[mod(s0 + ds, T)], s = mod(s0 + ds, T);
    for (let c = 0; c < st.b.length; c++)
      if (Math.abs(wrapD(X[s][st.b[c]] - x0)) < CFG.cell * 2.5 && Math.random() < 0.5) st.st[c] = 1;
  }
}

function ease(dt) {                                      // smooth height toward state
  const k = 1 - Math.exp(-dt / 0.18);
  for (const st of S) for (let c = 0; c < st.lv.length; c++) st.lv[c] += (st.st[c] - st.lv[c]) * k;
}

// ---------- rendering: bevelled cells, shaded like a lit relief --------------

function render() {
  const ctx = drawingContext, paths = new Map();
  const pathFor = g => { let p = paths.get(g); if (!p) paths.set(g, p = new Path2D()); return p; };
  const slices = new Path2D(), links = new Path2D();
  const [lx, ly] = CFG.light, bg = CFG.bg;
  const mouseOn = millis() - mouseT < 120, mr2 = (CFG.cell * 1.1) ** 2;

  background(bg);
  for (let s = 0; s < T; s++) {
    const st = S[s], u = (s + 1) % T, M = st.b.length, nb = N(s), nt = N(u);
    const yB = mod(H - s * h - scrollY, H) || H, yT = yB - h;
    const dys = yT < 0 ? [0, H] : [0];
    // unwrap x along the strip so cells never jump across the seam
    const xb = new Float64Array(M + 1), xt = new Float64Array(M + 1);
    xb[0] = X[s][st.b[0]];
    xt[0] = xb[0] + wrapD(X[u][st.t[0]] - xb[0]);
    for (let c = 0; c < M; c++) {
      const c1 = (c + 1) % M;
      xb[c + 1] = xb[c] + (st.b[c1] !== st.b[c] ? mod(X[s][st.b[c1]] - X[s][st.b[c]], W) : 0);
      xt[c + 1] = xt[c] + (st.t[c1] !== st.t[c] ? mod(X[u][st.t[c1]] - X[u][st.t[c]], W) : 0);
    }
    for (let c = 0; c < M; c++) {
      const P = [[xb[c], yB]];
      if (xb[c + 1] !== xb[c]) P.push([xb[c + 1], yB]);
      if (xt[c + 1] !== xt[c]) P.push([xt[c + 1], yT]);
      P.push([xt[c], yT]);
      let cx = 0, cy = 0;
      for (const p of P) { cx += p[0]; cy += p[1]; }
      cx /= P.length; cy /= P.length;

      if (mouseOn) for (const dy of dys) {               // the cursor seeds matter
        const ddx = wrapD(cx - mouseX), ddy = cy + dy - mouseY;
        if (ddx * ddx + ddy * ddy < mr2) { st.st[c] = 1; st.age[c] = Math.max(1, st.age[c]); }
      }

      const lv = st.lv[c], tall = Math.min(1, 0.55 + st.age[c] * 0.06);
      const z = CFG.relief + (CFG.bevel - CFG.relief) * lv * tall;
      const I = P.map(p => [cx + (p[0] - cx) * (1 - z), cy + (p[1] - cy) * (1 - z)]);
      const top = bg + 6 + lv * (22 + 20 * tall);
      const amp = 16 + 46 * lv * tall;
      const xs = [0];
      let minx = Infinity, maxx = -Infinity;
      for (const p of P) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); }
      if (minx < 0) xs.push(W);
      if (maxx > W) xs.push(-W);
      for (const dy of dys) for (const dx of xs) {
        addPoly(pathFor(Math.round(top)), I, dx, dy);
        for (let k = 0; k < P.length; k++) {             // bevel faces
          const a = P[k], b = P[(k + 1) % P.length];
          let nx = b[1] - a[1], ny = a[0] - b[0];
          const L = Math.hypot(nx, ny) || 1;
          nx /= L; ny /= L;
          if (nx * ((a[0] + b[0]) / 2 - cx) + ny * ((a[1] + b[1]) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
          const g = Math.round(Math.max(0, Math.min(255, top + (nx * lx + ny * ly) * amp)));
          addPoly(pathFor(g), [a, b, I[(k + 1) % P.length], I[k]], dx, dy);
        }
        if (xb[c + 1] !== xb[c]) { slices.moveTo(xb[c] + dx, yB + dy); slices.lineTo(xb[c + 1] + dx, yB + dy); }
        links.moveTo(xb[c] + dx, yB + dy); links.lineTo(xt[c] + dx, yT + dy);
      }
    }
  }
  for (const [g, p] of paths) { ctx.fillStyle = `rgb(${g},${g},${g})`; ctx.fill(p); }
  ctx.lineWidth = 0.6;
  ctx.strokeStyle = `rgba(0,0,0,0.55)`; ctx.stroke(links);            // timelike
  ctx.strokeStyle = `rgba(255,255,255,0.07)`; ctx.stroke(slices);     // spatial slices
}

function addPoly(p, pts, dx, dy) {
  p.moveTo(pts[0][0] + dx, pts[0][1] + dy);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0] + dx, pts[i][1] + dy);
  p.closePath();
}
