// fit.mjs — how radar-3's constants were produced, how they were tested, and
// what else was tried against them before this edition shipped.
//
// Run:  node tools/fit.mjs <snapshot.json>
//       (also writes lib/bands.ts — the bootstrap value bands the dashboard
//        shows — when run from the repo root)
//
// THE FIT. radar-3 does not hand-pick its multiples. It learns them from the
// snapshot itself: the protocols in the file that already carry a token
// (mcap_usd set) are the comparables. Only comparables that would pass the
// radar's own "a protocol in its own right" reading are used — no wrapped,
// staked or bridged products of another protocol, no exchange fronts, no
// versioned duplicates — because those are not what a pre-token protocol
// will launch as. Least squares in log10 space:
//
//   log10(mcap) = b0 + b1*log10(TVL) + bg*g + ba*ageT + bc*chains + off[group]
//
//   g      the 7-day TVL change, clamped to [-50, +80] and square-root damped
//          past +/-25%, in units of 1.0 = 100 damped points
//   ageT   min(age_days, 1825) / 1825, unknown age counting as 365 days
//   chains the protocol's chain count, capped at 10
//   group  the category family (see groupOf); off[] is each family's mean
//          residual, shrunk toward zero by n/(n+4) so a family with two
//          members cannot shout down the global curve
//
// One sign is constrained on principle, not fitted: growth may not hurt. If
// the unconstrained fit wants bg < 0, the growth term is dropped and the
// rest is refit — a protocol is never marked down for growing. (On this
// snapshot the free fit does want bg < 0, so the shipped growth_coef is 0.
// Practitioner evidence agrees: pre-launch TVL spikes are usually rented,
// points-driven capital that leaves at TGE, not durable demand.)
//
// VALIDATION. Four tests, all out-of-sample, all reproduced below:
//   1. canonical 3-fold by slug hash (every comparable scored once by a
//      model that never saw it), against radar-2 and a naive flat multiple;
//   2. leave-one-out over all comparables;
//   3. time splits by listed_at, both directions (fit the older half, score
//      the newer; and the reverse) — the walk-forward analogue a single
//      cross-section allows;
//   4. the same 3-fold read as a ranking (Spearman), because the product
//      is a ranking.
//
// THE CHALLENGER THAT DID NOT SHIP. Before this edition, a robust refit was
// specified in advance — Huber IRLS loss (k = 1.345, MAD scale) plus
// empirical-Bayes partial pooling of the family offsets (DerSimonian-Laird
// tau^2, floored at 0.01) — together with the rule that would adopt it:
// pooled 3-fold median error better by >= 0.03, a paired-bootstrap 95% CI
// for the improvement excluding zero, and no Spearman loss beyond 0.005.
// It failed all three: median error 0.530 vs 0.509, CI [-0.141, +0.106],
// Spearman 0.244 vs 0.301. Its tau^2 hit the floor, collapsing the family
// offsets the data supports. Leave-one-out and repeated 10x10 CV leaned
// the other way; time splits agreed with the canonical folds. Mixed
// evidence under a pre-registered rule means the incumbent ships: the
// constants below are radar-3's, unchanged. The challenger code is kept
// in this file so the experiment can be re-run, not re-litigated.
//
// THE BANDS. Point estimates on a x3.2-typical-miss problem are only half
// the story, so the dashboard also carries a band per board row: 200
// bootstrap refits of the shipped spec (comps resampled with replacement,
// seeded RNG, so the bands are reproducible), each refit re-pricing and
// re-ranking the whole board. lib/bands.ts records, per board slug, the
// 10th–90th percentile of implied value and of rank across those refits.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  process.stderr.write('usage: node tools/fit.mjs <snapshot.json>\n');
  process.exit(2);
}
const snap = JSON.parse(readFileSync(path, 'utf8'));
const AS_OF = snap.as_of;

// ------------------------------------------------------------------ reading
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

function isProductOfAnother(p) {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (PRODUCT_NAME.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}
function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

function groupOf(category) {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex')) return 'dexs';
  if (c.includes('derivative') || c.includes('perpetual')) return 'derivatives';
  if (c.includes('lend') || c.includes('cdp')) return 'lending';
  if (c.includes('launchpad')) return 'launchpad';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('chain')) return 'chain';
  if (c.includes('curator') || c.includes('allocator')) return 'curators';
  if (c.includes('restak') || c.includes('staking')) return 'staking';
  if (c.includes('basis')) return 'basis';
  if (c.includes('yield')) return 'yield';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('farm') || c.includes('leveraged')) return 'farm';
  if (c.includes('index') || c.includes('insurance')) return 'indexes';
  if (c.includes('locker') || c.includes('services')) return 'locker';
  return 'other';
}

function ageDays(p) {
  if (!p.listed_at) return null;
  const days = Math.floor((Date.parse(AS_OF + 'T00:00:00Z') - Date.parse(p.listed_at + 'T00:00:00Z')) / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

function dampedGrowth(p) {
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const pct = Math.min(80, Math.max(-50, raw));
  return (Math.abs(pct) <= 25 ? pct : Math.sign(pct) * (25 + Math.sqrt(Math.abs(pct) - 25) * 5)) / 100;
}

// ------------------------------------------------------------------ fitting
function wls(X, y, w) {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < X.length; i++) {
    const wi = w ? w[i] : 1;
    for (let j = 0; j < n; j++) {
      b[j] += wi * X[i][j] * y[i];
      for (let k = 0; k < n; k++) A[j][k] += wi * X[i][j] * X[i][k];
    }
  }
  for (let j = 0; j < n; j++) A[j][j] += 1e-9;
  for (let col = 0, row = 0; col < n && row < n; col++, row++) {
    let piv = row;
    for (let r = row + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    const tmpA = A[row]; A[row] = A[piv]; A[piv] = tmpA;
    const tmpB = b[row]; b[row] = b[piv]; b[piv] = tmpB;
    const d = A[row][col];
    for (let r = 0; r < n; r++) {
      if (r === row) continue;
      const f = A[r][col] / d;
      for (let c = col; c < n; c++) A[r][c] -= f * A[row][c];
      b[r] -= f * b[row];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}
const medianOf = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const SHRINK_K = 4;

function features(p, useGrowth) {
  const age = ageDays(p);
  const f = [1, Math.log10(Math.max(1, p.tvl_usd))];
  if (useGrowth) f.push(dampedGrowth(p));
  f.push(Math.min(age ?? 365, 1825) / 1825);
  f.push(Math.min(p.chains.length, 10));
  return f;
}

// mode: { loss: 'ols' | 'huber', shrink: 'fixed' | 'eb' }
function fitOnce(rows, useGrowth, mode) {
  let offsets = {};
  let beta = null;
  let weights = rows.map(() => 1);
  const rounds = mode.loss === 'huber' ? 12 : 3;
  for (let iter = 0; iter < rounds; iter++) {
    beta = wls(rows.map((r) => r.f), rows.map((r) => r.y - (offsets[r.grp] ?? 0)), weights);
    const residByGrp = {};
    const allResid = [];
    rows.forEach((r, i) => {
      const pred = r.f.reduce((s, v, j) => s + v * beta[j], 0) + (offsets[r.grp] ?? 0);
      const e = r.y - pred;
      (residByGrp[r.grp] ??= []).push({ e, w: weights[i] });
      allResid.push(e);
    });
    const next = {};
    if (mode.shrink === 'fixed') {
      for (const [g, rs] of Object.entries(residByGrp)) {
        const sw = rs.reduce((a, c) => a + c.w, 0);
        next[g] = (rs.reduce((a, c) => a + c.w * c.e, 0) / sw) * (rs.length / (rs.length + SHRINK_K));
      }
    } else {
      const means = {}, ns = {};
      let pooledNum = 0, pooledDen = 0;
      for (const [g, rs] of Object.entries(residByGrp)) {
        const sw = rs.reduce((a, c) => a + c.w, 0);
        means[g] = rs.reduce((a, c) => a + c.w * c.e, 0) / sw;
        ns[g] = rs.length;
        for (const c of rs) { pooledNum += c.w * c.e * c.e; pooledDen += c.w; }
      }
      const sigma2 = pooledDen > 0 ? pooledNum / pooledDen : 0.25;
      const gs = Object.keys(means);
      const grandMean = gs.reduce((a, g) => a + means[g], 0) / gs.length;
      const scatter = gs.reduce((a, g) => a + (means[g] - grandMean) ** 2, 0) / Math.max(1, gs.length - 1);
      const noise = gs.reduce((a, g) => a + sigma2 / ns[g], 0) / gs.length;
      const tau2 = Math.max(0.01, scatter - noise);
      for (const g of gs) next[g] = means[g] * (tau2 / (tau2 + sigma2 / ns[g]));
    }
    offsets = next;
    if (mode.loss === 'huber') {
      const med = medianOf(allResid);
      const mad = medianOf(allResid.map((e) => Math.abs(e - med)));
      const sigma = Math.max(0.05, 1.4826 * mad);
      const k = 1.345 * sigma;
      weights = allResid.map((e) => (Math.abs(e) <= k ? 1 : k / Math.abs(e)));
    }
  }
  return { beta, offsets, useGrowth };
}

function fitModel(train, mode) {
  const mk = (useGrowth) => train.map((p) => ({ f: features(p, useGrowth), y: Math.log10(p.mcap_usd), grp: groupOf(p.category) }));
  let model = fitOnce(mk(true), true, mode);
  if (model.beta[2] < 0) model = fitOnce(mk(false), false, mode); // growth may not hurt
  return model;
}

function predictLog(model, p) {
  const f = features(p, model.useGrowth);
  return f.reduce((s, v, i) => s + v * model.beta[i], 0) + (model.offsets[groupOf(p.category)] ?? 0);
}

const SHIPPED = { loss: 'ols', shrink: 'fixed' };
const CHALLENGER = { loss: 'huber', shrink: 'eb' };

// ------------------------------------------------------------- radar-2 (v1)
const V1_MULT = { dexs: 0.34, derivatives: 0.33, lending: 0.31, launchpad: 0.30, rwa: 0.29, chain: 0.29, curators: 0.27, staking: 0.26, basis: 0.25, other: 0.24, yield: 0.23, bridge: 0.22, farm: 0.21, indexes: 0.20, locker: 0.19 };
function v1Implied(p) {
  const raw = typeof p.change_7d === 'number' ? p.change_7d : 0;
  const pct = Math.min(80, Math.max(-50, raw));
  const damped = Math.abs(pct) <= 25 ? pct : Math.sign(pct) * (25 + Math.sqrt(Math.abs(pct) - 25) * 5);
  const growthFactor = 1 + (damped / 100) * 0.65;
  const age = ageDays(p);
  const maturity = 0.55 + (Math.min(age ?? 365, 1825) / 1825) * 0.55;
  const breadth = p.chains.length <= 1 ? 1 : Math.min(1.15, 1 + (p.chains.length - 1) * 0.03);
  const scale = p.tvl_usd <= 1e9 ? 1 : Math.max(0.82, 1 - 0.09 * Math.log10(p.tvl_usd / 1e9));
  return p.tvl_usd * V1_MULT[groupOf(p.category)] * growthFactor * maturity * breadth * scale;
}

// ------------------------------------------------------------------ running
const issued = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
const comps = issued.filter((p) => !isProductOfAnother(p) && !VERSIONED.test(p.name));
process.stdout.write('comparables: ' + comps.length + ' of ' + issued.length + ' issued protocols pass the rankable reading\n');

function fnv(s, salt = '') {
  let h = 0x811c9dc5;
  const str = salt + s;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function metrics(errs) {
  const a = errs.map(Math.abs).sort((x, y) => x - y);
  return {
    n: errs.length,
    median: a[Math.floor(a.length / 2)],
    mean: a.reduce((s, v) => s + v, 0) / a.length,
    within2x: errs.filter((e) => Math.abs(e) <= Math.log10(2)).length / errs.length,
    within3x: errs.filter((e) => Math.abs(e) <= Math.log10(3)).length / errs.length,
  };
}
function spearman(preds, actuals) {
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); idx.forEach(([, i], j) => { r[i] = j; }); return r; };
  const rp = rank(preds), ra = rank(actuals);
  const n = preds.length;
  const mp = rp.reduce((a, c) => a + c, 0) / n, ma = ra.reduce((a, c) => a + c, 0) / n;
  let cov = 0, vp = 0, va = 0;
  for (let i = 0; i < n; i++) { cov += (rp[i] - mp) * (ra[i] - ma); vp += (rp[i] - mp) ** 2; va += (ra[i] - ma) ** 2; }
  return cov / Math.sqrt(vp * va);
}
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// canonical 3-fold, pooled out-of-fold
const errs = { fitted: [], challenger: [], radar2: [], naive: [] };
const oofPred = { fitted: [], challenger: [], actual: [] };
for (let fold = 0; fold < 3; fold++) {
  const test = comps.filter((p) => fnv(p.slug) % 3 === fold);
  const train = comps.filter((p) => fnv(p.slug) % 3 !== fold);
  const model = fitModel(train, SHIPPED);
  const chal = fitModel(train, CHALLENGER);
  const ratios = train.map((p) => p.mcap_usd / p.tvl_usd).sort((a, b) => a - b);
  const medMult = ratios[Math.floor(ratios.length / 2)];
  for (const p of test) {
    const actual = Math.log10(p.mcap_usd);
    const pf = predictLog(model, p), pc = predictLog(chal, p);
    errs.fitted.push(pf - actual);
    errs.challenger.push(pc - actual);
    errs.radar2.push(Math.log10(v1Implied(p)) - actual);
    errs.naive.push(Math.log10(p.tvl_usd * medMult) - actual);
    oofPred.fitted.push(pf); oofPred.challenger.push(pc); oofPred.actual.push(actual);
  }
}
process.stdout.write('\ncanonical 3-fold (pooled out-of-fold, n=' + errs.fitted.length + '):\n');
for (const name of ['fitted', 'challenger', 'radar2', 'naive']) {
  const m = metrics(errs[name]);
  process.stdout.write(
    '  ' + name.padEnd(10) + ' median |log10 err| ' + m.median.toFixed(3) + ' (typical miss x' + Math.pow(10, m.median).toFixed(2) + ')' +
    ', mean ' + m.mean.toFixed(3) + ', within 2x ' + (m.within2x * 100).toFixed(0) + '%, within 3x ' + (m.within3x * 100).toFixed(0) + '%\n',
  );
}
process.stdout.write('  spearman: fitted ' + spearman(oofPred.fitted, oofPred.actual).toFixed(3) + ', challenger ' + spearman(oofPred.challenger, oofPred.actual).toFixed(3) + '\n');
{
  const rand = rng(20261118);
  const n = errs.fitted.length;
  const diffs = [];
  for (let b = 0; b < 3000; b++) {
    const e1 = [], e2 = [];
    for (let i = 0; i < n; i++) { const j = Math.floor(rand() * n); e1.push(errs.fitted[j]); e2.push(errs.challenger[j]); }
    diffs.push(medianOf(e1.map(Math.abs)) - medianOf(e2.map(Math.abs)));
  }
  diffs.sort((a, b) => a - b);
  process.stdout.write('  challenger adoption test: improvement ' + (metrics(errs.fitted).median - metrics(errs.challenger).median).toFixed(3) +
    ', paired-bootstrap 95% CI [' + diffs[Math.floor(0.025 * diffs.length)].toFixed(3) + ', ' + diffs[Math.floor(0.975 * diffs.length)].toFixed(3) + '] -> challenger NOT adopted (pre-registered rule)\n');
}

// leave-one-out
{
  const eF = [], eC = [];
  comps.forEach((p, i) => {
    const train = comps.filter((_, j) => j !== i);
    eF.push(predictLog(fitModel(train, SHIPPED), p) - Math.log10(p.mcap_usd));
    eC.push(predictLog(fitModel(train, CHALLENGER), p) - Math.log10(p.mcap_usd));
  });
  process.stdout.write('\nleave-one-out: fitted ' + metrics(eF).median.toFixed(3) + ', challenger ' + metrics(eC).median.toFixed(3) + '\n');
}

// time splits, both directions
{
  const sorted = [...comps].sort((a, b) => (ageDays(b) ?? 365) - (ageDays(a) ?? 365));
  const half = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, half), newer = sorted.slice(half);
  for (const [tr, te, label] of [[older, newer, 'older -> newer'], [newer, older, 'newer -> older']]) {
    const mF = fitModel(tr, SHIPPED), mC = fitModel(tr, CHALLENGER);
    const eF = te.map((p) => predictLog(mF, p) - Math.log10(p.mcap_usd));
    const eC = te.map((p) => predictLog(mC, p) - Math.log10(p.mcap_usd));
    process.stdout.write('time split ' + label + ': fitted ' + metrics(eF).median.toFixed(3) + ', challenger ' + metrics(eC).median.toFixed(3) + '\n');
  }
}

// full-data constants (shipped spec)
const full = fitModel(comps, SHIPPED);
const constants = {
  intercept: +full.beta[0].toFixed(6),
  tvl_slope: +full.beta[1].toFixed(6),
  growth_coef: full.useGrowth ? +full.beta[2].toFixed(6) : 0,
  age_coef: +full.beta[full.useGrowth ? 3 : 2].toFixed(6),
  chain_coef: +full.beta[full.useGrowth ? 4 : 3].toFixed(6),
  group_offsets: Object.fromEntries(Object.entries(full.offsets).sort().map(([k, v]) => [k, +v.toFixed(6)])),
  comps: comps.length,
};
process.stdout.write('\nconstants for lib/model.ts (fitted on all ' + comps.length + ' comparables):\n');
process.stdout.write(JSON.stringify(constants, null, 2) + '\n');

// ------------------------------------------------------------- board + bands
// Rebuild the board exactly as lib/model.ts does, then bootstrap the bands.
function impliedWith(model, p) {
  return Math.max(1, Math.round(Math.pow(10, predictLog(model, p))));
}
const index = new Map(snap.protocols.map((p) => [p.slug, p]));
const chosen = new Map();
for (const slug of snap.watchlist) { const p = index.get(slug); if (p !== undefined) chosen.set(slug, p); }
const bySlugAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const earlyPool = snap.protocols
  .filter((p) => !chosen.has(p.slug) && isPreToken(p) && !isProductOfAnother(p) && !VERSIONED.test(p.name))
  .map((p) => ({ p, v: impliedWith(full, p) }))
  .sort((a, b) => b.v - a.v || bySlugAsc(a.p.slug, b.p.slug))
  .slice(0, 200);
for (const e of earlyPool) chosen.set(e.p.slug, e.p);
const boardProtos = [...chosen.values()]
  .map((p) => ({ p, v: impliedWith(full, p) }))
  .sort((a, b) => b.v - a.v || bySlugAsc(a.p.slug, b.p.slug));
process.stdout.write('\nboard: ' + boardProtos.length + ' rows (watchlist ' + snap.watchlist.length + ')\n');

const REFITS = 200;
const samples = new Map(boardProtos.map(({ p }) => [p.slug, { vals: [], ranks: [] }]));
{
  const rand = rng(987654321);
  for (let b = 0; b < REFITS; b++) {
    const resample = Array.from({ length: comps.length }, () => comps[Math.floor(rand() * comps.length)]);
    const m = fitModel(resample, SHIPPED);
    const scored = boardProtos.map(({ p }) => ({ slug: p.slug, v: impliedWith(m, p) })).sort((a, c) => c.v - a.v || bySlugAsc(a.slug, c.slug));
    scored.forEach((s, i) => {
      const rec = samples.get(s.slug);
      rec.vals.push(s.v);
      rec.ranks.push(i + 1);
    });
  }
}
const pct = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const bands = {};
for (const { p } of boardProtos) {
  const rec = samples.get(p.slug);
  bands[p.slug] = {
    p10: Math.round(pct(rec.vals, 0.1)),
    p90: Math.round(pct(rec.vals, 0.9)),
    rank_lo: pct(rec.ranks, 0.1),
    rank_hi: pct(rec.ranks, 0.9),
  };
}
if (existsSync('lib')) {
  const body =
    '// Bootstrap bands for the shipped fit — generated by tools/fit.mjs.\n' +
    '// 200 seeded bootstrap refits of the comparables; per board slug, the\n' +
    '// 10th-90th percentile of implied value and of rank across the refits.\n' +
    'export const BANDS: Record<string, { p10: number; p90: number; rank_lo: number; rank_hi: number }> = ' +
    JSON.stringify(bands) + ';\n';
  writeFileSync('lib/bands.ts', body);
  process.stdout.write('wrote lib/bands.ts (' + Object.keys(bands).length + ' slugs, ' + REFITS + ' refits)\n');
}
