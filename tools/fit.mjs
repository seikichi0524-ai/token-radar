// fit.mjs — how radar-4's constants were produced, how they were tested,
// and what was tried and rejected on the way. This file is the entry's lab
// notebook: every number the dashboard quotes is regenerated here from the
// snapshot, and the two files under lib/ that the build cannot compute for
// itself (the bootstrap bands and the issuance model's weights) are
// written here too.
//
// Run:  node tools/fit.mjs <snapshot.json>
//       (writes lib/bands.ts and lib/ptoken.ts when run from the repo root)
//
// THE VALUE FIT. radar-4 learns a launch multiple from the snapshot's own
// issued protocols. The comparables are the issued protocols that pass the
// radar's "a protocol in its own right" reading — no wrapped, staked or
// bridged products of another protocol, no exchange fronts, no versioned
// duplicates — 92 of the 128 issued rows. Least squares in log10 space:
//
//   log10(mcap) = b0 + b1*log10(TVL) + ba*ageT + bc*chains
//
//   ageT   min(age_days, 1825) / 1825, unknown age counting as 365 days
//   chains the protocol's chain count, capped at 10
//
// One sign is constrained on principle, not fitted: growth may not hurt.
// Given a free coefficient the 7-day change fits negative, so the term is
// dropped and the rest refit — a protocol is never marked down for
// growing. (Practitioner evidence agrees: pre-launch TVL spikes are
// usually rented, points-driven capital that leaves at TGE.)
//
// WHAT RADAR-4 REMOVED, AND WHY. radar-3 also carried a per-family offset
// (curators up, lending down, ...), shrunk toward zero by n/(n+4). On the
// canonical slug-hash folds those offsets looked like the model's best
// idea. They did not survive a sterner test: over 20 repetitions of
// 5-fold cross-validation the offsets made the median error WORSE at every
// shrinkage level tried (k = 2, 4, 8, 16, 32), monotonically — the
// no-offset spec scored 0.526 against 0.579 for the shipped k = 4 — and a
// paired bootstrap on the canonical folds puts the whole model's edge
// over a bare power law (intercept + log TVL only) at a mean of -0.002
// with a 95% CI of [-0.041, +0.037]: indistinguishable from zero. With 92
// comparables the parameter budget is spent; radar-4 ships the simpler
// spec and publishes the ablation below instead of the offsets.
//
// THE ISSUANCE MODEL. Value at issuance is only half a farmer's question;
// the other half is whether a token arrives at all. A logistic regression
// over the snapshot's clearly-labelled protocols (the 92 issued
// comparables as positives, the 198 standalone pre-token protocols as
// negatives) scores P(token) from log TVL, age, chain count and category
// family. Cross-validated AUC is printed below (about 0.71: real signal,
// far from certainty).
//
// WHAT EDITION 5 CHANGED. Editions up to 4 ranked the board by value at
// issuance and carried the expected value P x value in a side table. The
// board now ranks by the expected value itself: board.json's
// implied_value_usd IS P(token) x value at issuance, and the launch value
// rides as its own field (launch_value_usd), one multiplication away in
// every detail view. The reasoning is the farmer's, not the
// statistician's: a $30M launch that is 15% likely is a smaller prize
// than a $18M launch that is 80% likely, and a ranking that pretends
// otherwise answers a question nobody with capital asks. Neither fit
// changed — radar-4's value spec and the issuance model are exactly the
// edition-4 fits; only the ranking's definition moved, and the board
// says so wherever the number is printed.
//
// THE BANDS AND THE INTERVAL. Each board row carries two ranges that mean
// different things, and the dashboard says so. The band is fit
// uncertainty: 200 bootstrap refits that resample BOTH models' training
// sets together, reprice every row's launch value and issuance
// probability, and re-rank the board by the product (lib/bands.ts) — so
// a row's rank range is honest about the ranking the board actually
// uses. The prediction interval is wider and more honest still: the
// 10th–90th percentiles of the canonical folds' signed out-of-sample
// residuals, applied to the launch value — where launches actually
// landed relative to fits like this one.
//
// VALIDATION. All out-of-sample, all reproduced below: canonical 3-fold
// by slug hash for radar-4 against a bare power law, the offset ablation
// and a naive multiple (median error, Spearman, precision in the top
// 30%); leave-one-out; time splits both directions; the repeated-CV
// ablation; the paired bootstrap; and the issuance model's CV AUC.

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
const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;

const SHRINK_K = 4;

// Feature builders for the specs under test. radar-4 is 'value'; 'offsets'
// is the radar-3 ablation (same features plus shrunk family offsets);
// 'power' is the bare null (intercept + log TVL).
function featsValue(p, useGrowth) {
  const f = [1, Math.log10(Math.max(1, p.tvl_usd))];
  if (useGrowth) f.push(dampedGrowth(p));
  f.push(Math.min(ageDays(p) ?? 365, 1825) / 1825);
  f.push(Math.min(p.chains.length, 10));
  return f;
}
function fitSpec(train, kind) {
  let offsets = {};
  let beta = null;
  let useGrowth = kind !== 'power';
  for (let round = 0; round < 2; round++) {
    const featFn = kind === 'power' ? (p) => [1, Math.log10(Math.max(1, p.tvl_usd))] : (p) => featsValue(p, useGrowth);
    const rows = train.map((p) => ({ f: featFn(p), y: Math.log10(p.mcap_usd), grp: groupOf(p.category) }));
    beta = wls(rows.map((r) => r.f), rows.map((r) => r.y - (offsets[r.grp] ?? 0)), null);
    if (kind === 'offsets') {
      const byGrp = {};
      rows.forEach((r) => {
        const pred = r.f.reduce((s, v, j) => s + v * beta[j], 0) + (offsets[r.grp] ?? 0);
        (byGrp[r.grp] ??= []).push(r.y - pred);
      });
      const next = {};
      for (const [g, es] of Object.entries(byGrp)) next[g] = meanOf(es) * (es.length / (es.length + SHRINK_K));
      offsets = next;
    }
    if (round === 0 && useGrowth) {
      const gIdx = 2;
      if (beta[gIdx] < 0) { useGrowth = false; continue; } // growth may not hurt: drop and refit
    }
    break;
  }
  const featFn = kind === 'power' ? (p) => [1, Math.log10(Math.max(1, p.tvl_usd))] : (p) => featsValue(p, useGrowth);
  return { beta, offsets: kind === 'offsets' ? offsets : {}, featFn, useGrowth };
}
function predictSpec(model, p) {
  return model.featFn(p).reduce((s, v, i) => s + v * model.beta[i], 0) + (model.offsets[groupOf(p.category)] ?? 0);
}

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

// ------------------------------------------------------------------ metrics
function fnv(s, salt = '') {
  let h = 0x811c9dc5;
  const str = salt + s;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function metrics(errs) {
  const a = errs.map(Math.abs).sort((x, y) => x - y);
  return {
    median: a[Math.floor(a.length / 2)],
    mean: meanOf(a),
    within2: errs.filter((e) => Math.abs(e) <= Math.log10(2)).length / errs.length,
    within3: errs.filter((e) => Math.abs(e) <= Math.log10(3)).length / errs.length,
  };
}
function spearman(preds, actuals) {
  const rank = (arr) => { const s = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(arr.length); s.forEach(([, i], j) => { r[i] = j; }); return r; };
  const rp = rank(preds), ra = rank(actuals);
  const mp = meanOf(rp), ma = meanOf(ra);
  let num = 0, dp = 0, da = 0;
  for (let i = 0; i < preds.length; i++) { num += (rp[i] - mp) * (ra[i] - ma); dp += (rp[i] - mp) ** 2; da += (ra[i] - ma) ** 2; }
  return num / Math.sqrt(dp * da);
}
function precisionTop30(preds, actuals) {
  const n = preds.length, k = Math.round(n * 0.3);
  const topPred = new Set(preds.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, i]) => i));
  const topAct = new Set(actuals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, k).map(([, i]) => i));
  let hit = 0; topPred.forEach((i) => { if (topAct.has(i)) hit++; });
  return hit / k;
}
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ------------------------------------------------------------------ running
const issued = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
const comps = issued.filter((p) => !isProductOfAnother(p) && !VERSIONED.test(p.name));
process.stdout.write('comparables: ' + comps.length + ' of ' + issued.length + ' issued protocols pass the rankable reading\n');

// ---- the shipped fit, on all comparables at once
const shipped = fitSpec(comps, 'value');
{
  const b = shipped.beta;
  const gi = shipped.useGrowth ? 1 : 0;
  process.stdout.write('\nradar-4 fit on all ' + comps.length + ' comparables (growth ' + (shipped.useGrowth ? 'kept' : 'dropped by the sign rule') + '):\n');
  process.stdout.write('  intercept ' + b[0].toFixed(6) + ', tvl_slope ' + b[1].toFixed(6));
  if (shipped.useGrowth) process.stdout.write(', growth_coef ' + b[2].toFixed(6));
  process.stdout.write(', age_coef ' + b[2 + gi].toFixed(6) + ', chain_coef ' + b[3 + gi].toFixed(6) + '\n');
}

// ---- canonical 3-fold, all specs
const canonErr = {};
const canonPred = {};
for (const kind of ['value', 'power', 'offsets']) {
  const errs = [], preds = [], acts = [];
  canonErr[kind] = new Map();
  for (let fold = 0; fold < 3; fold++) {
    const test = comps.filter((p) => fnv(p.slug) % 3 === fold);
    const train = comps.filter((p) => fnv(p.slug) % 3 !== fold);
    const m = fitSpec(train, kind);
    for (const p of test) {
      const pr = predictSpec(m, p);
      errs.push(pr - Math.log10(p.mcap_usd)); preds.push(pr); acts.push(Math.log10(p.mcap_usd));
      canonErr[kind].set(p.slug, pr - Math.log10(p.mcap_usd));
    }
  }
  canonPred[kind] = preds;
  const mt = metrics(errs);
  const label = kind === 'value' ? 'radar-4' : kind === 'power' ? 'power law only' : 'radar-3 ablation (+offsets)';
  process.stdout.write('3-fold ' + label.padEnd(28) + ' median ' + mt.median.toFixed(3) + ' (x' + Math.pow(10, mt.median).toFixed(2) + '), mean ' + mt.mean.toFixed(3) + ', within2x ' + (mt.within2 * 100).toFixed(0) + '%, within3x ' + (mt.within3 * 100).toFixed(0) + '%, spearman ' + spearman(preds, acts).toFixed(3) + ', precision@top30% ' + precisionTop30(preds, acts).toFixed(2) + '\n');
}
{
  const errs = comps.map((p) => Math.log10(v1Implied(p)) - Math.log10(p.mcap_usd));
  // radar-2 read out-of-sample the way edition 2 measured it: refit-free hand
  // multiples are already out-of-sample by construction; kept for continuity.
  const mt = metrics(errs);
  process.stdout.write('reference radar-2 (hand-set)      median ' + mt.median.toFixed(3) + ' (in-sample-free hand multiples; see edition history)\n');
  const naiveErrs = [];
  for (let fold = 0; fold < 3; fold++) {
    const test = comps.filter((p) => fnv(p.slug) % 3 === fold);
    const train = comps.filter((p) => fnv(p.slug) % 3 !== fold);
    const mult = medianOf(train.map((p) => p.mcap_usd / p.tvl_usd));
    for (const p of test) naiveErrs.push(Math.log10(p.tvl_usd * mult) - Math.log10(p.mcap_usd));
  }
  const nm = metrics(naiveErrs);
  process.stdout.write('3-fold naive flat multiple       median ' + nm.median.toFixed(3) + ' (x' + Math.pow(10, nm.median).toFixed(2) + '), within2x ' + (nm.within2 * 100).toFixed(0) + '%\n');
}

// ---- leave-one-out and time splits for radar-4
{
  const errs = comps.map((p) => {
    const m = fitSpec(comps.filter((q) => q !== p), 'value');
    return predictSpec(m, p) - Math.log10(p.mcap_usd);
  });
  process.stdout.write('radar-4 leave-one-out median ' + metrics(errs).median.toFixed(3) + '\n');
  const sorted = [...comps].sort((a, b) => (ageDays(b) ?? 365) - (ageDays(a) ?? 365));
  const half = Math.floor(sorted.length / 2);
  const older = sorted.slice(0, half), newer = sorted.slice(half);
  const mOld = fitSpec(older, 'value');
  const eNew = newer.map((p) => predictSpec(mOld, p) - Math.log10(p.mcap_usd));
  const mNew = fitSpec(newer, 'value');
  const eOld = older.map((p) => predictSpec(mNew, p) - Math.log10(p.mcap_usd));
  process.stdout.write('radar-4 time splits: old->new ' + metrics(eNew).median.toFixed(3) + ', new->old ' + metrics(eOld).median.toFixed(3) + '\n');
}

// ---- repeated 5-fold ablation: offsets vs no offsets
{
  const acc = { value: [], offsets: [] };
  for (let rep = 0; rep < 20; rep++) {
    const r = rng(1000 + rep);
    const idx = comps.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (const kind of ['value', 'offsets']) {
      const errs = [];
      for (let f = 0; f < 5; f++) {
        const test = idx.filter((_, pos) => pos % 5 === f).map((i) => comps[i]);
        const train = idx.filter((_, pos) => pos % 5 !== f).map((i) => comps[i]);
        const m = fitSpec(train, kind);
        for (const p of test) errs.push(predictSpec(m, p) - Math.log10(p.mcap_usd));
      }
      acc[kind].push(metrics(errs).median);
    }
  }
  const sd = (arr) => Math.sqrt(meanOf(arr.map((v) => (v - meanOf(arr)) ** 2)));
  process.stdout.write('repeated 5-fold x20 median err: radar-4 ' + meanOf(acc.value).toFixed(3) + ' ± ' + sd(acc.value).toFixed(3) + ' | with offsets ' + meanOf(acc.offsets).toFixed(3) + ' ± ' + sd(acc.offsets).toFixed(3) + '\n');
}

// ---- paired bootstrap: radar-4 minus power law, canonical folds
{
  const slugs = comps.map((p) => p.slug);
  const diffs = slugs.map((s) => Math.abs(canonErr.value.get(s)) - Math.abs(canonErr.power.get(s)));
  const r = rng(20261119);
  const bootMean = [];
  for (let b = 0; b < 2000; b++) bootMean.push(meanOf(Array.from({ length: diffs.length }, () => diffs[Math.floor(r() * diffs.length)])));
  const s = [...bootMean].sort((x, y) => x - y);
  process.stdout.write('paired bootstrap, radar-4 - power law: mean diff ' + meanOf(diffs).toFixed(3) + ', 95% CI [' + s[Math.floor(0.025 * s.length)].toFixed(3) + ', ' + s[Math.floor(0.975 * s.length)].toFixed(3) + ']\n');
}

// ---- prediction interval factors from radar-4's OOF residuals
{
  const errs = comps.map((p) => canonErr.value.get(p.slug)).sort((a, b) => a - b);
  const q = (f) => errs[Math.floor(f * errs.length)];
  process.stdout.write('radar-4 OOF residual quantiles: q10 ' + q(0.10).toFixed(3) + ', q90 ' + q(0.90).toFixed(3) + ' -> PI factors lo x' + Math.pow(10, q(0.10)).toFixed(4) + ', hi x' + Math.pow(10, q(0.90)).toFixed(4) + '\n');
}

// ------------------------------------------------------------------ issuance
const FAMILIES = [...new Set(snap.protocols.map((p) => groupOf(p.category)))].sort();
function pFeatures(p) {
  const f = [Math.log10(Math.max(1, p.tvl_usd)), Math.min(ageDays(p) ?? 365, 1825) / 1825, Math.min(p.chains.length, 10)];
  const g = groupOf(p.category);
  for (const fam of FAMILIES) f.push(g === fam ? 1 : 0);
  return f;
}
const labelled = snap.protocols.filter((p) => ((p.mcap_usd !== null && p.mcap_usd > 0) || isPreToken(p)) && !isProductOfAnother(p) && !VERSIONED.test(p.name));
function fitLogistic(rows, iters = 3000, lr = 0.1, l2 = 0.01) {
  const X = rows.map((p) => pFeatures(p));
  const y = rows.map((p) => (p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0));
  const d = X[0].length;
  const mu = [], sd = [];
  for (let j = 0; j < d; j++) { mu[j] = meanOf(X.map((r) => r[j])); sd[j] = Math.max(1e-6, Math.sqrt(meanOf(X.map((r) => (r[j] - mu[j]) ** 2)))); }
  const Z = X.map((r) => r.map((v, j) => (j < 3 ? (v - mu[j]) / sd[j] : v)));
  let w = new Array(d).fill(0);
  const posN = y.reduce((s, v) => s + v, 0);
  let b0 = Math.log((posN + 1) / (y.length - posN + 1));
  const sig = (z) => 1 / (1 + Math.exp(-z));
  for (let t = 0; t < iters; t++) {
    const gw = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < Z.length; i++) {
      const pr = sig(b0 + Z[i].reduce((s, v, j) => s + v * w[j], 0));
      const e = pr - y[i];
      gb += e; for (let j = 0; j < d; j++) gw[j] += e * Z[i][j];
    }
    b0 -= (lr * gb) / Z.length;
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / Z.length + l2 * w[j]);
  }
  return { b0, w, mu, sd, predict: (p) => { const f = pFeatures(p).map((v, j) => (j < 3 ? (v - mu[j]) / sd[j] : v)); return sig(b0 + f.reduce((s, v, j) => s + v * w[j], 0)); } };
}
function aucOf(scores, labels) {
  const pairs = scores.map((s, i) => [s, labels[i]]).sort((a, b) => b[0] - a[0]);
  let tp = 0, area = 0;
  const P = labels.filter((v) => v === 1).length, N = labels.length - P;
  for (const [, l] of pairs) { if (l === 1) tp++; else area += (tp / P) * (1 / N); }
  return area;
}
let ptokenAuc = 0;
{
  const labelsArr = labelled.map((p) => (p.mcap_usd !== null && p.mcap_usd > 0 ? 1 : 0));
  const aucs = [];
  const oofSum = new Array(labelled.length).fill(0);
  const oofN = new Array(labelled.length).fill(0);
  for (let rep = 0; rep < 5; rep++) {
    const r = rng(5000 + rep);
    const idx = labelled.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const scores = new Array(labelled.length);
    for (let f = 0; f < 5; f++) {
      const test = idx.filter((_, pos) => pos % 5 === f);
      const train = idx.filter((_, pos) => pos % 5 !== f).map((i) => labelled[i]);
      const m = fitLogistic(train, 1500);
      for (const i of test) { scores[i] = m.predict(labelled[i]); oofSum[i] += scores[i]; oofN[i]++; }
    }
    aucs.push(aucOf(scores, labelsArr));
  }
  ptokenAuc = meanOf(aucs);
  // Calibration of the out-of-fold probabilities: a probability that is
  // multiplied into money has to mean what it says. Deciles of predicted
  // probability against the actual issued share, plus the Brier score
  // against the base-rate forecaster. The wobble in the middle deciles is
  // inside the noise of n=290, so no isotonic recalibration is applied —
  // fitting one would tune to that noise.
  const oof = oofSum.map((v, i) => v / oofN[i]);
  const brier = meanOf(oof.map((pr, i) => (pr - labelsArr[i]) ** 2));
  const baseRate = meanOf(labelsArr);
  const brierBase = meanOf(labelsArr.map((y) => (baseRate - y) ** 2));
  process.stdout.write('issuance calibration: Brier ' + brier.toFixed(3) + ' vs base-rate ' + brierBase.toFixed(3) + '\n');
  const bins = Array.from({ length: 10 }, () => ({ n: 0, pred: 0, act: 0 }));
  oof.forEach((pr, i) => { const b = Math.min(9, Math.floor(pr * 10)); bins[b].n++; bins[b].pred += pr; bins[b].act += labelsArr[i]; });
  bins.forEach((b, i) => { if (b.n) process.stdout.write('  decile ' + (i / 10).toFixed(1) + ': n=' + b.n + ', predicted ' + (b.pred / b.n).toFixed(2) + ', actual ' + (b.act / b.n).toFixed(2) + '\n'); });
  const fullBase = fitLogistic(labelled);
  process.stdout.write('  standardised coefficients: logTVL ' + fullBase.w[0].toFixed(3) + ', age ' + fullBase.w[1].toFixed(3) + ' (positive: in a cross-section, older protocols are the ones that have had time to issue — P reads as "share of like-shaped protocols that have already issued", not a forecast), chains ' + fullBase.w[2].toFixed(3) + '\n');
  process.stdout.write('\nissuance model: labelled ' + labelled.length + ' (' + labelsArr.filter((v) => v === 1).length + ' issued / ' + labelsArr.filter((v) => v === 0).length + ' pre-token), CV AUC ' + aucs.map((a) => a.toFixed(3)).join(', ') + ' -> mean ' + ptokenAuc.toFixed(3) + '\n');
  const full = fitLogistic(labelled);
  if (existsSync('lib')) {
    const body = '// Generated by tools/fit.mjs from the snapshot — do not edit by hand.\n'
      + '// The issuance model: logistic regression for P(a protocol like this\n'
      + '// has issued a token), trained on the snapshot\'s clearly-labelled\n'
      + '// protocols (issued comparables as positives, standalone pre-token\n'
      + '// protocols as negatives). Features: standardised log10 TVL, age and\n'
      + '// chain count, then one indicator per category family, in the order\n'
      + '// of `families`. Cross-validated AUC is recorded alongside.\n'
      + 'export const PTOKEN = {\n'
      + '  intercept: ' + full.b0.toFixed(6) + ',\n'
      + '  weights: [' + full.w.map((v) => v.toFixed(6)).join(', ') + '],\n'
      + '  mu: [' + full.mu.slice(0, 3).map((v) => v.toFixed(6)).join(', ') + '],\n'
      + '  sd: [' + full.sd.slice(0, 3).map((v) => v.toFixed(6)).join(', ') + '],\n'
      + '  families: [' + FAMILIES.map((f) => "'" + f + "'").join(', ') + '],\n'
      + '  auc_cv: ' + ptokenAuc.toFixed(3) + ',\n'
      + '  positives: ' + labelsArr.filter((v) => v === 1).length + ',\n'
      + '  negatives: ' + labelsArr.filter((v) => v === 0).length + ',\n'
      + '};\n';
    writeFileSync('lib/ptoken.ts', body);
    process.stdout.write('wrote lib/ptoken.ts\n');
  }
}

// ------------------------------------------------------------------ bands
// 200 bootstrap refits over resampled training sets. Each refit refits
// BOTH models — the radar-4 value spec on resampled comparables and the
// issuance logistic on resampled labelled protocols — reprices every
// board row's launch value and issuance probability, and re-ranks the
// board by the product, the ranking edition 5 ships. The value band
// (p10/p90) is read off the launch values; the rank band is read off the
// expected-value ranking, so the two bands describe the two numbers the
// detail view prints.
{
  const bySlug = new Map(snap.protocols.map((p) => [p.slug, p]));
  const chosen = new Map();
  for (const slug of snap.watchlist) { const p = bySlug.get(slug); if (p !== undefined) chosen.set(slug, p); }
  const earlyPool = snap.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p) && !isProductOfAnother(p) && !VERSIONED.test(p.name))
    .map((p) => ({ p, s: Math.pow(10, predictSpec(shipped, p)) }))
    .sort((a, b) => b.s - a.s || (a.p.slug < b.p.slug ? -1 : 1))
    .slice(0, 200);
  for (const e of earlyPool) chosen.set(e.p.slug, e.p);
  const boardProtos = [...chosen.values()];
  process.stdout.write('\nbootstrap bands over a board of ' + boardProtos.length + ' rows (joint value + issuance refits, ranked by expected value)...\n');
  const samples = new Map(boardProtos.map((p) => [p.slug, { vals: [], ranks: [] }]));
  const r = rng(20261114);
  for (let b = 0; b < 200; b++) {
    const resample = Array.from({ length: comps.length }, () => comps[Math.floor(r() * comps.length)]);
    const m = fitSpec(resample, 'value');
    const resampledLabelled = Array.from({ length: labelled.length }, () => labelled[Math.floor(r() * labelled.length)]);
    const pm = fitLogistic(resampledLabelled, 800);
    const priced = boardProtos.map((p) => {
      const v = Math.pow(10, predictSpec(m, p));
      return { slug: p.slug, v, ev: v * pm.predict(p) };
    }).sort((a, b2) => b2.ev - a.ev || (a.slug < b2.slug ? -1 : 1));
    priced.forEach((row, i) => { const s = samples.get(row.slug); s.vals.push(row.v); s.ranks.push(i + 1); });
  }
  const pct = (arr, f) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
  if (existsSync('lib')) {
    const lines = ['// Generated by tools/fit.mjs from the snapshot — do not edit by hand.',
      '// Per board row: the 10th–90th percentile of launch value and of rank',
      '// across 200 bootstrap refits that resample both models together and',
      '// re-rank by expected value (P(token) x launch value). This is fit',
      '// uncertainty only; the dashboard pairs it with a wider prediction',
      '// interval built from out-of-sample residuals.',
      'export const BANDS: Record<string, { p10: number; p90: number; rank_lo: number; rank_hi: number }> = {'];
    for (const p of boardProtos) {
      const s = samples.get(p.slug);
      lines.push('  ' + JSON.stringify(p.slug) + ': { p10: ' + Math.round(pct(s.vals, 0.1)) + ', p90: ' + Math.round(pct(s.vals, 0.9)) + ', rank_lo: ' + Math.round(pct(s.ranks, 0.1)) + ', rank_hi: ' + Math.round(pct(s.ranks, 0.9)) + ' },');
    }
    lines.push('};');
    writeFileSync('lib/bands.ts', lines.join('\n') + '\n');
    process.stdout.write('wrote lib/bands.ts (' + boardProtos.length + ' rows)\n');
  }
}

// ------------------------------------------------- per-term ablation, residuals
// The standard that removed the family offsets, applied to the terms that
// remain: repeated 5-fold x20 for the bare power law, +age, +chains and
// the full radar-4 spec. Every variant lands within about one standard
// deviation of the others (0.518–0.534); no term provably earns its keep
// and none provably costs anything. Age and chains stay because they
// price maturity and sprawl in the direction the full-sample fit gives,
// at no measured out-of-sample cost — and the table is published so the
// reader can apply the same scepticism to them as to the offsets.
// One caveat the board also carries: the spec was CHOSEN on these same
// resamples, so the repeated-CV figures are mildly optimistic as
// estimates of the chosen spec; a nested-CV estimate was not run.
{
  const FEATS = {
    'power only': (p) => [1, Math.log10(Math.max(1, p.tvl_usd))],
    '+ age': (p) => [1, Math.log10(Math.max(1, p.tvl_usd)), Math.min(ageDays(p) ?? 365, 1825) / 1825],
    '+ chains': (p) => [1, Math.log10(Math.max(1, p.tvl_usd)), Math.min(p.chains.length, 10)],
    'full radar-4': (p) => featsValue(p, false),
  };
  process.stdout.write('\nper-term ablation, repeated 5-fold x20 (median |log err|):\n');
  for (const [name, feat] of Object.entries(FEATS)) {
    const meds = [];
    for (let rep = 0; rep < 20; rep++) {
      const r = rng(1000 + rep);
      const idx = comps.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const errs = [];
      for (let f = 0; f < 5; f++) {
        const test = idx.filter((_, pos) => pos % 5 === f).map((i) => comps[i]);
        const train = idx.filter((_, pos) => pos % 5 !== f).map((i) => comps[i]);
        const beta = wls(train.map(feat), train.map((p) => Math.log10(p.mcap_usd)), null);
        for (const p of test) errs.push(feat(p).reduce((s, v, j) => s + v * beta[j], 0) - Math.log10(p.mcap_usd));
      }
      meds.push(metrics(errs).median);
    }
    const sd = Math.sqrt(meanOf(meds.map((v) => (v - meanOf(meds)) ** 2)));
    process.stdout.write('  ' + name.padEnd(14) + ' mean ' + meanOf(meds).toFixed(3) + ' ± ' + sd.toFixed(3) + '\n');
  }
  // The signed out-of-fold residuals of the shipped spec: the empirical
  // distribution the dashboard's P(profit) reads from, and the source of
  // the prediction-interval factors in VALIDATION.
  if (existsSync('lib')) {
    const resid = comps.map((p) => canonErr.value.get(p.slug)).sort((a, b) => a - b);
    const body = '// Generated by tools/fit.mjs from the snapshot — do not edit by hand.\n'
      + '// The ' + resid.length + ' signed out-of-sample residuals (log10) of the radar-4\n'
      + '// value fit on the canonical slug-hash folds, sorted. The dashboard\n'
      + '// integrates over this empirical distribution for P(profit) instead\n'
      + '// of assuming a tidy parametric one.\n'
      + 'export const RESIDUALS: number[] = [' + resid.map((v) => v.toFixed(3)).join(', ') + '];\n';
    writeFileSync('lib/residuals.ts', body);
    process.stdout.write('wrote lib/residuals.ts (' + resid.length + ' residuals)\n');
  }
}
