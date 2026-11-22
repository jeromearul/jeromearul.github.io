// Causal Dynamical Triangulation × Game of Life — v3  (p5.js, global mode)
// ----------------------------------------------------------------------------
// Flat, five-tone, triangles only, jagged slices. Click to enter /work.
// Spacetime is a stack of 1D spatial slices (horizontal rows, time runs up).
// Between slice s and s+1 lies a strip of triangles glued along timelike edges:
//   U = (2,1) triangle  – base on the past slice, apex on the future slice
//   D = (1,2) triangle  – apex in the past, base in the future
// A strip is a cyclic list of timelike edges (b,t); each triangle sits between
// two consecutive edges and advances either b (U) or t (D).
// The geometry fluctuates through the local CDT moves:
//   flip  : UD <-> DU                 (swap a diamond's diagonal)
//   (2,4) : insert a vertex on a slice (space grows), (4,2) removes one
// Moves are weighted by a curvature-squared term (deficit angle per vertex)
// and slice lengths by the CDT effective action, with the cosmological
// constant tuned to hold the mean volume. Life runs on the triangles, with
// every triangle sharing a vertex counted as a neighbour.
//
// Each vertex sits slightly above or below its slice, so a spatial slice is
// a jagged line rather than a straight one (its angles don't add to 180°).
//
// Palette, white to black in equal steps:
//           #fff  newborn (this generation)
//           #bfbfbf  young matter (survived a few generations)
//           #808080  old matter
//           #404040  geometry in motion: triangles a CDT move just touched
//           #000  vacuum

const CFG = {
  cell: 24,                 // target spatial edge length (px)
  jag: 0.22,                // max vertical offset of a vertex, × slice spacing
  youngGens: 2,             // generations a cell stays #bfbfbf before #808080
  link: '/work',            // where a click goes
  curvature: 0.35,          // R² term: 0 = wild quantum foam, 1+ = nearly flat
  flipsPerSec: 1100,        // diagonal flip attempts
  volMovesPerSec: 120,      // vertex insert / remove attempts
  kinetic: 1.2,             // CDT kinetic term  (N_t+1 - N_t)^2 / (N_t+1 + N_t)
  pin: 0.02,                // soft pin of each slice to its target length
  gravity: 0.35,            // how much life stretches its slice
  lifeMs: 450,              // ms per Life generation
  birth: [0.27, 0.37],      // live-neighbour fraction that gives birth
  survive: [0.17, 0.42],    // live-neighbour fraction that survives
  vacuum: 0.0004,           // spontaneous birth chance per cell per generation
  flashMs: 600,             // how long a moved triangle stays #404040
  drift: 7,                 // upward scroll, px per second (0 = still)
  colors: { vacuum: '#000', born: '#fff', young: '#bfbfbf', old: '#808080', moved: '#404040' },
};
const TONES = ['moved', 'old', 'young', 'born'];         // drawn back to front

let W, H, T, N0, h;         // canvas, slice count, target length, slice spacing
let X = [];                 // X[t][i]: x of vertex i on slice t (cyclic order)
let J = [];                 // J[t][i]: its vertical offset from the slice (px)
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
  render();
}

function mouseMoved() { mouseT = millis(); }
function touchMoved() { mouseT = millis(); }

function mousePressed() { window.location.href = CFG.link; }

function keyPressed() {
  if (key === ' ') paused = !paused;
  if (key === 'r') seedLife(0.3);
}

// ---------- spacetime construction ------------------------------------------

function buildSpacetime() {
  N0 = Math.max(8, Math.round(W / CFG.cell));
  const h0 = CFG.cell * Math.sqrt(3) / 2;
  T = Math.max(4, 2 * Math.round(H / h0 / 2));          // even, so rows interlock
  h = H / T;                                             // exact fit: seamless wrap
  const dx = W / N0;
  X = []; J = []; S = [];
  for (let t = 0; t < T; t++) {                          // staggered, jagged rows
    X[t] = Array.from({ length: N0 }, (_, i) => (i + 0.5 * (t % 2)) * dx);
    J[t] = Array.from({ length: N0 }, jag);
  }
  for (let s = 0; s < T; s++) {
    const st = { b: [], t: [], st: [], age: [], fx: [] };
    for (let i = 0; i < N0; i++) {
      if (s % 2 === 0) { pushEdge(st, i, i); pushEdge(st, (i + 1) % N0, i); }  // U D
      else             { pushEdge(st, i, i); pushEdge(st, i, (i + 1) % N0); }  // D U
    }
    S[s] = st;
  }
  lambda = 0;
  for (let i = 0; i < 4 * T * N0; i++) {                 // thermalise geometry
    (i % 2 ? insertVertex : removeVertex)();
    if (i % 50 === 0) tuneLambda();
  }
  for (let i = 0; i < 40 * T * N0; i++) flipMove();
  for (let i = 0; i < 80; i++) relax(0.5);
  for (const st of S) st.fx.fill(-1e9);                  // no flashes at start
  seedLife(0.3);
}

function jag() { return (Math.random() * 2 - 1) * CFG.jag * h; }

function pushEdge(st, b, t) { st.b.push(b); st.t.push(t); st.st.push(0); st.age.push(0); st.fx.push(0); }

function seedLife(p) {
  for (const st of S) for (let c = 0; c < st.b.length; c++) {
    st.st[c] = Math.random() < p ? 1 : 0; st.age[c] = st.st[c] ? 2 : 0;
  }
}

// triangle c of strip s is U when it advances the past slice, else D
const isU = (st, c) => st.b[(c + 1) % st.b.length] !== st.b[c];

function insertEdge(st, c, b, t) {                       // new edge after edge c;
  const j = c + 1, now = millis();                       // both halves inherit c
  st.b.splice(j, 0, b); st.t.splice(j, 0, t);
  st.st.splice(j, 0, st.st[c]); st.age.splice(j, 0, st.age[c]); st.fx.splice(j, 0, now);
  st.fx[c] = now;
}

function removeEdge(st, j) {                             // merge triangles j-1 and j
  const p = mod(j - 1, st.b.length);
  st.st[p] |= st.st[j];
  st.age[p] = Math.max(st.age[p], st.age[j]);
  st.fx[p] = millis();
  for (const a of [st.b, st.t, st.st, st.age, st.fx]) a.splice(j, 1);
}

// ---------- CDT moves ------------------------------------------------------

function angleAt(t, v) {                                 // 60° per incident triangle
  let n = 0;
  for (const [st, side] of [[S[t], 'b'], [S[mod(t - 1, T)], 't']]) {
    const a = st[side], M = a.length;
    for (let c = 0; c < M; c++) if (a[c] === v || a[(c + 1) % M] === v) n++;
  }
  return 60 * n;
}

function flipMove() {                                    // Metropolis on a diamond
  const s = rint(T), st = S[s], M = st.b.length, c = rint(M), c1 = (c + 1) % M;
  const u = (s + 1) % T, nb = N(s), nt = N(u);
  const up = isU(st, c);
  if (up === isU(st, c1)) return;                        // UU or DD: not a diamond
  // UD -> DU moves 60° from b+1 and t to b and t+1 (and the reverse for DU -> UD)
  const b = st.b[c], t = st.t[c];
  const v = [angleAt(s, b), angleAt(s, (b + 1) % nb), angleAt(u, t), angleAt(u, (t + 1) % nt)];
  const d = up ? [60, -60, -60, 60] : [-60, 60, 60, -60];
  let dR2 = 0;
  for (let i = 0; i < 4; i++) dR2 += ((360 - v[i] - d[i]) / 60) ** 2 - ((360 - v[i]) / 60) ** 2;
  if (dR2 > 0 && Math.random() > Math.exp(-CFG.curvature * dR2)) return;
  st.b[c1] = up ? b : (b + 1) % nb;                      // swap the diagonal
  st.t[c1] = up ? (t + 1) % nt : t;
  st.fx[c] = st.fx[c1] = millis();
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
  const below = S[mod(t - 1, T)], above = S[t];
  const k = rint(n);
  let cb = -1, ca = -1;                                  // the D below, the U above
  for (let c = 0; c < below.t.length; c++) if (below.t[c] === k && !isU(below, c)) { cb = c; break; }
  for (let c = 0; c < above.b.length; c++) if (above.b[c] === k && isU(above, c)) { ca = c; break; }
  if (cb < 0 || ca < 0) return;
  for (let i = 0; i < below.t.length; i++) if (below.t[i] > k) below.t[i]++;
  for (let i = 0; i < above.b.length; i++) if (above.b[i] > k) above.b[i]++;
  const x0 = X[t][k], x1 = X[t][(k + 1) % n];
  X[t].splice(k + 1, 0, mod(x0 + wrapD(x1 - x0) / 2, W));
  J[t].splice(k + 1, 0, jag());
  insertEdge(below, cb, below.b[cb], k + 1);             // D -> D D
  insertEdge(above, ca, k + 1, above.t[ca]);             // U -> U U
}

function removeVertex() {                                // (4,2): drop a 4-valent vertex
  const t = rint(T), n = N(t);
  if (n <= Math.max(6, N0 >> 1) || !metropolis(t, -1)) return;
  const below = S[mod(t - 1, T)], above = S[t], v = rint(n);
  let jb = -1, ja = -1, cb = 0, ca = 0;
  for (let i = 0; i < below.t.length; i++) if (below.t[i] === v) { jb = i; cb++; }
  for (let i = 0; i < above.b.length; i++) if (above.b[i] === v) { ja = i; ca++; }
  if (cb !== 1 || ca !== 1) return;                      // one edge down, one up
  removeEdge(below, jb); removeEdge(above, ja);
  for (let i = 0; i < below.t.length; i++) if (below.t[i] > v) below.t[i]--;
  for (let i = 0; i < above.b.length; i++) if (above.b[i] > v) above.b[i]--;
  X[t].splice(v, 1);
  J[t].splice(v, 1);
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

function lifeStep() {
  const off = [], cOff = []; let V = 0, C = 0;
  for (let t = 0; t < T; t++) { off[t] = V; V += N(t); cOff[t] = C; C += S[t].b.length; }
  const inc = Array.from({ length: V }, () => []), verts = [], alive = new Uint8Array(C);
  for (let s = 0; s < T; s++) {
    const st = S[s], u = (s + 1) % T, M = st.b.length;
    for (let c = 0; c < M; c++) {
      const id = cOff[s] + c, c1 = (c + 1) % M;
      const vs = [off[s] + st.b[c], off[u] + st.t[c],
                  isU(st, c) ? off[s] + st.b[c1] : off[u] + st.t[c1]];
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
      st.age[c] = on ? st.age[c] + 1 : 0;
      pop += next[c];
    }
    st.st = next;
  }
  if (pop < 0.02 * C) seedPatch();                       // keep the universe going
}

function seedPatch() {                                   // a random blob of matter
  const s0 = rint(T), st0 = S[s0], c0 = rint(st0.b.length), x0 = X[s0][st0.b[c0]];
  for (let ds = -2; ds <= 2; ds++) {
    const s = mod(s0 + ds, T), st = S[s];
    for (let c = 0; c < st.b.length; c++)
      if (Math.abs(wrapD(X[s][st.b[c]] - x0)) < CFG.cell * 2.5 && Math.random() < 0.5) {
        st.st[c] = 1; st.age[c] = 1;
      }
  }
}

// ---------- rendering: flat triangles, five tones --------------------------

function render() {
  const ctx = drawingContext, now = millis(), C = CFG.colors;
  const P = Object.fromEntries(TONES.map(k => [k, new Path2D()]));
  const mouseOn = now - mouseT < 120, mr2 = (CFG.cell * 1.1) ** 2, pad = CFG.jag * h;

  background(C.vacuum);
  for (let s = 0; s < T; s++) {
    const st = S[s], u = (s + 1) % T, M = st.b.length;
    const yB = mod(H - s * h - scrollY, H) || H, yT = yB - h;
    const dys = [0];                                     // repeat across the seam
    if (yT - pad < 0) dys.push(H);
    if (yB + pad > H) dys.push(-H);
    // unwrap x along the strip so triangles never jump across the seam
    const xb = new Float64Array(M + 1), xt = new Float64Array(M + 1);
    xb[0] = X[s][st.b[0]];
    xt[0] = xb[0] + wrapD(X[u][st.t[0]] - xb[0]);
    for (let c = 0; c < M; c++) {
      const c1 = (c + 1) % M;
      xb[c + 1] = xb[c] + (st.b[c1] !== st.b[c] ? mod(X[s][st.b[c1]] - X[s][st.b[c]], W) : 0);
      xt[c + 1] = xt[c] + (st.t[c1] !== st.t[c] ? mod(X[u][st.t[c1]] - X[u][st.t[c]], W) : 0);
    }
    for (let c = 0; c < M; c++) {
      const c1 = (c + 1) % M, up = xb[c + 1] !== xb[c];
      const bx = xb[c], by = yB + J[s][st.b[c]];         // past corner
      const tx = xt[c], ty = yT + J[u][st.t[c]];         // future corner
      const ax = up ? xb[c + 1] : xt[c + 1];             // third corner
      const ay = up ? yB + J[s][st.b[c1]] : yT + J[u][st.t[c1]];

      if (mouseOn) {                                     // the cursor seeds matter
        const cx = (bx + tx + ax) / 3, cy = (by + ty + ay) / 3;
        for (const dy of dys) {
          const ddx = wrapD(cx - mouseX), ddy = cy + dy - mouseY;
          if (ddx * ddx + ddy * ddy < mr2 && !st.st[c]) { st.st[c] = 1; st.age[c] = 1; }
        }
      }

      const age = st.age[c];
      const p = st.st[c] ? P[age <= 1 ? 'born' : age <= CFG.youngGens ? 'young' : 'old']
              : now - st.fx[c] < CFG.flashMs ? P.moved : null;
      if (!p) continue;
      const minx = Math.min(bx, tx, ax), maxx = Math.max(bx, tx, ax);
      const xs = minx < 0 ? [0, W] : maxx > W ? [0, -W] : [0];
      for (const dy of dys) for (const dx of xs) {
        p.moveTo(bx + dx, by + dy); p.lineTo(ax + dx, ay + dy); p.lineTo(tx + dx, ty + dy);
        p.closePath();
      }
    }
  }
  for (const k of TONES) { ctx.fillStyle = C[k]; ctx.fill(P[k]); }
  ctx.lineWidth = 1;                                     // hairline gaps between tiles
  ctx.strokeStyle = C.vacuum;
  for (const k of TONES) ctx.stroke(P[k]);
}
