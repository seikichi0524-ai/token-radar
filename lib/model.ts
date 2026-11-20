// Token Radar — the pricing engine and farm-plan builder behind the board
// (fit: radar-4; board edition 5).
//
// Everything here runs off the sealed snapshot and nothing else. A protocol
// is priced from five of its ten fields — tvl_usd, change_7d, listed_at,
// category, chains — and no name, slug or brand is ever given its own rule.
//
// How a launch value is formed. The snapshot holds 128 protocols that
// already issued a token; 92 of them survive the same standalone reading
// the board itself applies (a wrapped, staked or bridged face of another
// protocol is not a comparable, and neither is an exchange front or a
// versioned twin). Those 92 are the evidence. A least-squares fit in
// log10 space over them yields the shipped equation:
//
//   log10(launch value) = intercept + tvl_slope * log10(TVL)
//                       + age_coef * ageT + chain_coef * chains
//
//   ageT   age in days, capped at five years and scaled to [0, 1]; a
//          protocol with no listing date is treated as one year old
//   chains how many chains carry the protocol, capped at 10
//
// (The growth transform of earlier editions is still computed and
// displayed, but its fitted coefficient is 0 — see the second finding.)
//
// Three findings from that fit are worth stating before the code:
// - Size bends the price hard. The slope on log TVL is 0.376 rather than
//   anything near 1, because the issued evidence says value per dollar of
//   TVL collapses with scale: the median comparable trades at 0.87x its
//   TVL in the smallest third, 0.25x in the middle third and 0.08x in the
//   largest. Flat multiples priced the biggest protocols far beyond any
//   observed outcome.
// - A hot week earns nothing. Given a free coefficient, the 7-day change
//   fitted negative; the model's single sign rule — growth must not lower
//   a price — removed the term and the fit was rerun without it. The
//   weekly move is still displayed on every row; it simply never prices.
// - Age and sprawl shave a little off. Once size is accounted for, older
//   and more widely deployed comparables settled slightly cheaper
//   (-0.146 across the full five-year span, -0.019 per chain). Both
//   effects are small beside the size curve, and the testing below is
//   honest about how small: they are retained because they price two
//   things practitioners check anyway, in the direction the full-sample
//   fit gives, at no measured out-of-sample cost.
//
// What radar-4 removed, and why. radar-3 also carried a per-family offset
// (curators up, lending down), shrunk toward zero. On the canonical folds
// the offsets still flatter themselves (median error 0.515 against
// radar-4's 0.542), but over 20 repetitions of 5-fold cross-validation the
// verdict reverses — 0.551 with offsets against 0.527 without — and the
// shrinkage sweep behind that test found no shrinkage level at which the
// offsets earned their keep. A paired bootstrap likewise puts radar-4's
// edge over a bare power law (intercept and log TVL only) at +0.001 of
// median log error, 95% CI [-0.018, +0.020]: at 92 comparables the
// parameter budget is spent. radar-4 therefore ships the simpler spec and
// publishes the ablation, in tools/fit.mjs and on the board, instead of
// the offsets.
//
// The second model answers the question the value fit cannot: whether a
// token arrives at all. A logistic regression over the snapshot's
// clearly-labelled protocols (the 92 issued comparables as positives, the
// 198 standalone pre-token protocols as negatives) scores P(token) from
// log TVL, age, chain count and category family, with a cross-validated
// AUC of 0.71 — real signal, far from certainty. P(token) reads as the
// share of like-shaped protocols that have already issued, not as a
// schedule and not as a causal claim.
//
// What board edition 5 changed: the ranking. Editions 1–4 sorted the
// board by launch value and carried the expected value — P(token) x
// launch value — in a side table. Edition 5 promotes the product to the
// ranking itself: board.json's implied_value_usd IS the expected value,
// and the launch value is carried as its own field (launch_value_usd),
// one visible multiplication away in every detail view. The argument is
// the farmer's, not the statistician's: a $30M launch at 15% odds is a
// smaller prize than an $18M launch at 80% odds, and a ranking that
// ignores the odds answers a question nobody with capital asks. Neither
// fit moved — the value spec and the issuance model are the edition-4
// fits, bit for bit — and the selection did not move either: every
// standalone pre-token protocol the snapshot holds is on the board, so
// the ranking is the only thing the new definition can reorder. The farm
// plans are likewise untouched: they were always priced on the product
// (expected profit is P-weighted), so edition 5 mostly admits, in the
// board's own ordering, what the plans already assumed.
//
// How the fits were tested (tools/fit.mjs regenerates each figure from
// the snapshot): the comparables are divided into three folds by hashing
// the slug, and each fold is priced by a fit trained on the other two, so
// no comparable is ever scored by a model that trained on it. Median
// absolute log10 error out of sample — radar-4: 0.542 (a typical miss of
// x3.49); a bare power law: 0.559 (x3.62); radar-2: 0.652 (x4.48); one
// naive multiple for everything: 0.676 (x4.74). Share of comparables
// priced within 2x of their actual market cap: radar-4 37%. The
// constants further down are that same fit retrained on all 92 at once,
// printed by tools/fit.mjs to 6 decimals.

import { BANDS } from './bands.ts';
import { PTOKEN } from './ptoken.ts';
import { RESIDUALS } from './residuals.ts';

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface FitConstants {
  intercept: number;
  tvl_slope: number;
  growth_coef: number;
  age_coef: number;
  chain_coef: number;
  growth_floor: number;
  growth_cap: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_cap: number;
  comps: number;
}

export const FIT: FitConstants = {
  intercept: 4.226043,
  tvl_slope: 0.375817,
  growth_coef: 0,
  age_coef: -0.14564,
  chain_coef: -0.018578,
  growth_floor: -50,
  growth_cap: 80,
  maturity_days: 1825,
  unknown_age_days: 365,
  chain_cap: 10,
  comps: 92,
};

export const MODEL_VERSION = 'radar-4';

/** Out-of-sample validation of the shipped fits, regenerated by tools/fit.mjs. */
export const VALIDATION = {
  folds: 3,
  comps: 92,
  fitted_median_log_err: 0.542,
  fitted_typical_miss: 3.49,
  fitted_mean_log_err: 0.645,
  fitted_within_2x: 0.37,
  fitted_within_3x: 0.5,
  fitted_spearman: 0.265,
  fitted_precision_top30: 0.43,
  loo_median_log_err: 0.527,
  time_split_old_to_new: 0.588,
  time_split_new_to_old: 0.76,
  power_median_log_err: 0.559,
  power_typical_miss: 3.62,
  power_within_2x: 0.36,
  offsets_median_log_err: 0.515,
  offsets_within_2x: 0.34,
  offsets_repeated_median: 0.551,
  fitted_repeated_median: 0.527,
  paired_mean_diff_vs_power: 0.001,
  paired_ci_lo: -0.018,
  paired_ci_hi: 0.02,
  radar2_median_log_err: 0.652,
  radar2_typical_miss: 4.48,
  naive_median_log_err: 0.676,
  naive_typical_miss: 4.74,
  pi_lo_factor: 0.1112,
  pi_hi_factor: 15.014,
  ptoken_auc: 0.709,
  ptoken_brier: 0.192,
  ptoken_brier_base: 0.217,
  ptoken_positives: 92,
  ptoken_negatives: 198,
  // Out-of-fold calibration of the issuance model, by predicted-
  // probability decile (tools/fit.mjs prints the same table): the
  // predicted share against the share that had actually issued. The
  // middle deciles track; the tails wobble inside the noise of n=290,
  // so no isotonic recalibration is fitted. Age x family interaction
  // terms were tested on the same folds and rejected — AUC 0.707
  // against 0.709 shipped, Brier unchanged (exp-interaction, 2026-11-20).
  ptoken_calibration: [
    { lo: 0.0, n: 24, pred: 0.07, act: 0.0 },
    { lo: 0.1, n: 63, pred: 0.16, act: 0.16 },
    { lo: 0.2, n: 78, pred: 0.25, act: 0.32 },
    { lo: 0.3, n: 45, pred: 0.34, act: 0.4 },
    { lo: 0.4, n: 35, pred: 0.45, act: 0.37 },
    { lo: 0.5, n: 18, pred: 0.53, act: 0.5 },
    { lo: 0.6, n: 16, pred: 0.66, act: 0.56 },
    { lo: 0.7, n: 8, pred: 0.75, act: 0.75 },
    { lo: 0.8, n: 3, pred: 0.83, act: 0.67 },
  ],
  power_repeated_median: 0.534,
  thin_pprofit: 0.25,
};

/** Board edition: 5 — the edition-4 fits, re-ranked by expected value
 *  (P(token) x launch value); the launch value rides as its own field. */
export const BOARD_EDITION = 5;

/**
 * Declared farming assumption behind every plan's break-even: a launch
 * distributes ALLOC_SHARE of its value to the farming community, and a
 * farmer's slice is pro-rata to the capital they keep in the protocol
 * against its TVL. Stated on the dashboard; used for nothing else.
 */
export const ALLOC_SHARE = 0.1;

/**
 * Opportunity cost of the plan's capital, per year, charged in every
 * plan's break-even from board edition 4 on: capital parked in a farm is
 * capital not earning the risk-free-ish yield the same wallet could take
 * elsewhere. 4% is the 2025 T-bill / lending-market ballpark; the point is
 * not the exact figure but that the cost exists, so "deploy more" stops
 * being free in the arithmetic.
 */
export const OPP_RATE = 0.04;

/** Board size target: the 40 watchlist rows plus this many early rows. */
export const EARLY_ROWS = 200;

/** Live-token protocols carried for the dashboard's comparison strip. */
export const LIVE_ROWS = 24;

/** Category family: the grouping the fitted offsets are estimated over. */
export function groupOf(category: string | null): string {
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

const DAY_MS = 86_400_000;

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function finite(value: number | null, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Growth with a damped tail: beyond +/-25% only the square root counts fully. */
export function dampedGrowth(change7d: number | null, fit: FitConstants): { pct: number; g: number } {
  const raw = finite(change7d, 0);
  const pct = Math.min(fit.growth_cap, Math.max(fit.growth_floor, raw));
  const damped = Math.abs(pct) <= 25 ? pct : Math.sign(pct) * (25 + Math.sqrt(Math.abs(pct) - 25) * 5);
  return { pct, g: damped / 100 };
}

export interface Scored {
  implied: number;
  group: string;
  size_factor: number;
  group_factor: number;
  growth_pct: number;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  age: number | null;
}

/**
 * The fitted value of one protocol. The headline is computed in log10 space;
 * the factors are the same quantity decomposed multiplicatively
 * (implied = TVL x size x growth x age x chain) so a reader — and the
 * dashboard — can check the arithmetic term by term. radar-4 carries no
 * per-family offset (see the header: the offsets failed repeated
 * cross-validation), so group_factor is 1 by construction and the family
 * is reported only as a label.
 */
export function impliedValue(p: SnapshotProtocol, asOf: string, fit: FitConstants = FIT): Scored {
  const age = ageDays(asOf, p.listed_at);
  const group = groupOf(p.category);
  const logTvl = Math.log10(Math.max(1, p.tvl_usd));
  const gr = dampedGrowth(p.change_7d, fit);
  const ageT = Math.min(age ?? fit.unknown_age_days, fit.maturity_days) / fit.maturity_days;
  const chains = Math.min(p.chains.length, fit.chain_cap);
  const logv =
    fit.intercept +
    fit.tvl_slope * logTvl +
    fit.growth_coef * gr.g +
    fit.age_coef * ageT +
    fit.chain_coef * chains;
  const implied = Math.max(1, Math.round(Math.pow(10, logv)));
  return {
    implied,
    group,
    size_factor: Math.pow(10, fit.intercept + (fit.tvl_slope - 1) * logTvl),
    group_factor: 1,
    growth_pct: gr.pct,
    growth_factor: Math.pow(10, fit.growth_coef * gr.g),
    age_factor: Math.pow(10, fit.age_coef * ageT),
    chain_factor: Math.pow(10, fit.chain_coef * chains),
    age,
  };
}

/**
 * P(token): the issuance model's score for one protocol — the probability
 * that a protocol with these fields has a token at all, learned from the
 * snapshot's labelled protocols (weights in lib/ptoken.ts, trained by
 * tools/fit.mjs; cross-validated AUC in VALIDATION). It is a cross-section
 * of who has issued so far, not a causal claim and not a schedule: it says
 * protocols shaped like this one usually have, or have not, launched.
 */
export function pToken(p: SnapshotProtocol, asOf: string, fit: FitConstants = FIT): number {
  const age = ageDays(asOf, p.listed_at);
  const raw = [
    Math.log10(Math.max(1, p.tvl_usd)),
    Math.min(age ?? fit.unknown_age_days, fit.maturity_days) / fit.maturity_days,
    Math.min(p.chains.length, fit.chain_cap),
  ];
  let logit = PTOKEN.intercept;
  for (let j = 0; j < 3; j++) logit += ((raw[j]! - PTOKEN.mu[j]!) / PTOKEN.sd[j]!) * PTOKEN.weights[j]!;
  const g = groupOf(p.category);
  PTOKEN.families.forEach((fam, i) => {
    if (fam === g) logit += PTOKEN.weights[3 + i]!;
  });
  return 1 / (1 + Math.exp(-logit));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * Categories that name a product of another protocol rather than a protocol
 * waiting on its own launch: bridges and staking wrappers of assets that
 * already trade. The watchlist rule excludes them for the same reason; the
 * radar applies the same reading to its early finds, using only the fields
 * the snapshot carries (category and name — parentProtocol is not one of
 * the ten fields, so name patterns stand in for it).
 */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isProductOfAnother(p: SnapshotProtocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (PRODUCT_NAME.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isProductOfAnother(p) && !VERSIONED.test(p.name);
}

// ---------------------------------------------------------------- farm plans

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  /** The board's ranking figure since edition 5: expected value,
   *  P(token) x launch value, rounded to whole dollars. */
  implied_value_usd: number;
  /** The fitted value if a launch happens — the edition-4 headline. */
  launch_value_usd: number;
  model: {
    group: string;
    size_factor: number;
    group_factor: number;
    growth_pct: number;
    growth_factor: number;
    age_factor: number;
    chain_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

type ChainFamily = 'l1' | 'bitcoin' | 'solana' | 'l2' | 'alt';

const L2_CHAINS = new Set(['arbitrum', 'base', 'optimism', 'zksync era', 'zksync', 'linea', 'scroll', 'mantle', 'blast', 'mode', 'taiko', 'starknet']);

function chainFamily(p: SnapshotProtocol): ChainFamily {
  const first = (p.chains[0] ?? '').toLowerCase();
  if (first === 'ethereum') return 'l1';
  if (first === 'bitcoin') return 'bitcoin';
  if (first === 'solana') return 'solana';
  if (L2_CHAINS.has(first)) return 'l2';
  return 'alt';
}

/**
 * Gas per on-chain action at 2025 post-Dencun levels, by chain family:
 * Ethereum mainnet DeFi actions run about $0.30-$2 in calm conditions,
 * L2 swaps a few cents, Solana a fraction of a cent. (Edition 1 priced
 * these at $12 / $6 / $2 — 2021 numbers, wrong in both directions.)
 */
function gasPerAction(p: SnapshotProtocol): number {
  const fam = chainFamily(p);
  if (fam === 'l1') return 1.5;
  if (fam === 'bitcoin') return 1;
  if (fam === 'solana') return 0.05;
  if (fam === 'l2') return 0.1;
  return 0.25;
}

/** Native-token float to leave untouched in the wallet (anti-dust rule). */
function gasReserve(p: SnapshotProtocol): number {
  const fam = chainFamily(p);
  if (fam === 'l1') return 15;
  if (fam === 'l2') return 3;
  if (fam === 'solana') return 1;
  return 5;
}

function fmtUsd(n: number): string {
  if (n < 0.1) return 'under $0.10';
  if (n < 10) return 'about $' + (Math.round(n * 10) / 10);
  return 'about $' + Math.round(n);
}

function capitalTier(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 5000;
  if (p.tvl_usd >= 1_000_000_000) return 2500;
  if (p.tvl_usd >= 250_000_000) return 1000;
  if (p.tvl_usd >= 50_000_000) return 500;
  return 250;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 42;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 60;
}

export interface PlanEconomics {
  capital: number;
  gas_per_action: number;
  weeks: number;
  /** Gas and bridge cost of running the plan, in dollars. */
  cost_usd: number;
  /** Opportunity cost of the capital over the hold, at OPP_RATE a year. */
  opp_cost_usd: number;
  hours: number;
  /** The launch value at which the plan repays its costs IF a token launches. */
  breakeven_usd: number;
  /** Expected profit of the plan at the shipped capital, in dollars:
   *  P(token) x ALLOC_SHARE x implied x capital/TVL, minus all costs. */
  expected_net_usd: number;
  /** Expected profit per hour of hands-on time the plan asks for
   *  (setup, weekly actions, logging, claim — the plan's hours figure).
   *  The unit the board's farmers compare plans by. */
  net_per_hour: number;
  /** P(the plan ends in profit): P(token) x the share of the fit's
   *  out-of-sample residuals under which the realised launch value still
   *  clears the break-even. Read from the empirical residuals, not a
   *  parametric guess. */
  p_profit: number;
  /**
   * The smallest deployment whose expected allocation at the row's
   * central implied value repays gas plus opportunity cost — or null when
   * no size works, because the expected yield per dollar deployed sits
   * under the opportunity-cost rate and scaling up only scales the loss.
   */
  min_capital_usd: number | null;
  verdict: 'farm' | 'thin' | 'skip';
}

/**
 * The plan's economics, from chain family, TVL tier, age and the row's
 * issuance probability. Cost is gas for setup + one action a week + the
 * claim, plus one bridge hop when the plan uses a second chain, plus the
 * opportunity cost of the capital over the hold at OPP_RATE. Capital is
 * the TVL tier ($250–$5,000 — sizes a working farmer actually deploys),
 * floored so the gas cost stays a small share of it (capital >= 20x gas).
 *
 * The verdict is read off expected profit, not off a band edge (an
 * earlier edition judged against the band's low end; with honest,
 * wide uncertainty that collapses to "skip everything", which is a
 * property of the threshold, not of the rows):
 * - farm: the plan's expected profit at the shipped capital is positive;
 * - thin: expectation is negative but P(profit) still reaches
 *   VALIDATION.thin_pprofit — a real chance, honestly labelled;
 * - skip: neither.
 * Break-even is stated unweighted (the launch value that repays costs if
 * a launch happens); the probability weighting lives in the expected
 * profit and in P(profit), where a reader can see it.
 */
export function planEconomics(p: SnapshotProtocol, age: number | null, implied: number, bandLow: number | null, pTok: number): PlanEconomics {
  const gas = gasPerAction(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(5, Math.ceil(hold / 7));
  const bridge = p.chains.length > 1 ? 3 : 0;
  const gasCost = Math.round((gas * (weeks + 4) + bridge) * 100) / 100;
  const capital = Math.max(capitalTier(p), Math.ceil(20 * gasCost));
  const oppCost = Math.round(capital * OPP_RATE * (weeks / 52) * 100) / 100;
  const cost = Math.round((gasCost + oppCost) * 100) / 100;
  const hours = Math.round(((25 + 10 * weeks + 10) / 60) * 10) / 10;
  const breakeven = Math.round((cost * p.tvl_usd) / (ALLOC_SHARE * capital));
  const expectedRaw = (ALLOC_SHARE * pTok * implied * capital) / p.tvl_usd - cost;
  const expectedNet = Math.round(expectedRaw);
  const need = Math.log10(breakeven / implied);
  const share = RESIDUALS.filter((e) => e >= need).length / RESIDUALS.length;
  const pProfit = Math.round(pTok * share * 1000) / 1000;
  const perDollar = (ALLOC_SHARE * pTok * implied) / p.tvl_usd;
  const netRate = perDollar - OPP_RATE * (weeks / 52);
  const minCapital = netRate > 0 ? Math.ceil(gasCost / netRate) : null;
  const verdict: PlanEconomics['verdict'] = expectedRaw > 0 ? 'farm' : pProfit >= VALIDATION.thin_pprofit ? 'thin' : 'skip';
  const netPerHour = Math.round((expectedNet / hours) * 100) / 100;
  return { capital, gas_per_action: gas, weeks, cost_usd: gasCost, opp_cost_usd: oppCost, hours, breakeven_usd: breakeven, expected_net_usd: expectedNet, net_per_hour: netPerHour, p_profit: pProfit, min_capital_usd: minCapital, verdict };
}

/** The core qualifying action, by category. Concrete verb, asset, venue. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return 'Supply $' + capital + ' of USDC to ' + n + ' on ' + chain + ', then borrow $' + Math.round(capital * 0.4) + ' against it and re-supply the borrow once';
  if (c.includes('dex')) return 'Swap $' + Math.round(capital / 2) + ' into the main pair on ' + n + ' (' + chain + '), then add $' + capital + ' of two-sided liquidity to that pool';
  if (c.includes('derivative') || c.includes('perpetual')) return 'Deposit $' + capital + ' of USDC margin on ' + n + ' (' + chain + ') and open a hedged position of about $' + capital * 5 + ' notional, preferring limit (maker) orders, and hold it at least 48 hours so it spans the weekly snapshot — instant open-and-close churn is filtered as wash trading and earns nothing';
  if (c.includes('bridge')) return 'Bridge $' + capital + ' of USDC from Ethereum to ' + chain + ' through ' + n + ', then make one swap with the bridged funds on arrival';
  if (c.includes('restak') || c.includes('staking')) return 'Stake $' + capital + ' of the native staking asset through ' + n + ' on ' + chain + ' and keep the liquid receipt token in the same wallet';
  if (c.includes('curator') || c.includes('allocator')) return 'Deposit $' + capital + ' into the largest ' + n + ' vault on ' + chain + ' and keep the vault shares untouched';
  if (c.includes('rwa')) return 'Mint $' + capital + ' of the ' + n + ' yield asset on ' + chain + ' with USDC and hold the minted asset in the farming wallet';
  if (c.includes('yield')) return 'Deposit $' + capital + ' of USDC into the main ' + n + ' vault on ' + chain + ' and leave auto-compounding switched on';
  if (c.includes('basis')) return 'Open the $' + capital + ' basis position ' + n + ' offers on ' + chain + ' (long spot, short perp of equal size) and keep both legs open';
  if (c.includes('launchpad')) return 'Commit $' + capital + ' to the next open sale or staking round on ' + n + ' (' + chain + ') and complete its participation steps';
  if (c.includes('insurance')) return 'Buy $' + capital + ' of 90-day cover from ' + n + ' on ' + chain + ' for a position you actually hold, and keep the policy NFT';
  if (c.includes('chain')) return 'Bridge $' + Math.round(capital / 2) + ' to ' + chain + ', then use two native apps on ' + n + ' with the remaining $' + Math.round(capital / 2);
  return 'Deposit $' + capital + ' of USDC into ' + n + ' on ' + chain + ' through its main app and keep the position open';
}

/** The weekly action's base amount, by category — varied +/-30% week to week. */
function weeklyBase(p: SnapshotProtocol, capital: number): number {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return Math.round(capital * 0.4);
  if (c.includes('dex')) return 25;
  if (c.includes('derivative') || c.includes('perpetual')) return 100;
  if (c.includes('bridge')) return 20;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return 10;
  if (c.includes('restak') || c.includes('staking')) return 10;
  return 20;
}

/** The weekly qualifying action, by category: what to repeat, not a slogan. */
function weeklyAction(p: SnapshotProtocol, chain: string, lo: number, hi: number): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  const band = 'between $' + lo + ' and $' + hi;
  if (c.includes('lend') || c.includes('cdp')) return 'Repay and re-borrow ' + band + ' once a week on ' + n + ', keeping the borrow leg open across the weekly snapshot with the health factor above 1.6';
  if (c.includes('dex')) return 'Make one swap ' + band + ' through ' + n + ' each week and add $10 to the liquidity position every second week';
  if (c.includes('derivative') || c.includes('perpetual')) return 'Trade ' + band + ' of total volume a week on ' + n + ', split across two different days, and keep the margin account funded';
  if (c.includes('bridge')) return 'Bridge ' + band + ' through ' + n + ' once a week, alternating direction, and use the funds on the far side each time';
  if (c.includes('restak') || c.includes('staking')) return 'Claim and restake the rewards on ' + n + ' once a week and top up ' + band + ' every second week, so the staking balance grows in separate weekly snapshots';
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return 'Add ' + band + ' to the ' + n + ' vault each week and claim any points or rewards shown in its dashboard the same day';
  return 'Repeat the core action on ' + n + ' (' + chain + ') once a week with ' + band;
}

/**
 * Seven steps per protocol: wallet, core action, second surface, weekly
 * rhythm, hold, log, claim. Written to 2025 farming practice, not 2021's:
 * an established wallet funded from an exchange (fresh single-purpose
 * wallets are a sybil flag), time-weighted positions held across weekly
 * snapshots, varied amounts on varying weekdays (identical amounts at
 * identical times are a published sybil signal), a points ledger instead
 * of screenshots alone, and a claim step with an eligibility check and a
 * window. Costs use the plan economics above; every number derives from
 * the protocol's chain, TVL tier and age — never from its name.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, econ: PlanEconomics): string[] {
  const chain = chainOf(p);
  const gas = econ.gas_per_action;
  const capital = econ.capital;
  const reserve = gasReserve(p);
  const hold = Math.max(35, econ.weeks * 7);
  const base = weeklyBase(p, capital);
  const lo = Math.max(1, Math.round(base * 0.7));
  const hi = Math.round(base * 1.3);
  const multi = p.chains.length > 1 ? p.chains[1]! : null;
  const c = (p.category ?? '').toLowerCase();
  const twab = ' Keep the position open continuously: 2025 programs accrue per dollar per day (time-weighted), so closing early forfeits the current weekly epoch.';
  const lendClause = c.includes('lend') || c.includes('cdp') ? ' Keep the borrow leg open across the weekly snapshots with the health factor above 1.6 — recent programs pay on time-weighted borrow balances, not passive deposits.' : '';
  const steps: string[] = [
    'Use an established wallet that already has ordinary activity on ' + chain + ' — retroactive scoring has paid for aged, varied usage and discounts brand-new single-purpose wallets. Fund it directly from an exchange (never from another farming wallet) with $' + (capital + reserve) + ', keep about $' + reserve + ' of the native token untouched as a gas float, and store the seed phrase offline. Cost: ' + fmtUsd(gas) + ' of gas to fund. Time: 10 minutes.',
    coreAction(p, capital, chain) + '.' + (c.includes('derivative') || c.includes('perpetual') ? '' : twab) + lendClause + ' Cost: $' + capital + ' of capital plus ' + fmtUsd(gas) + ' of gas. Time: 15 minutes to set up, then it runs by itself.',
    multi !== null
      ? 'On a different day from step 2, repeat a smaller $' + Math.round(capital / 2) + ' position on ' + multi + ', the second chain ' + p.name + ' lists — a second, different contract is worth more than more of the same, and distributions have paid separate credit for distinct-contract counts. Cost: about $3 of bridge and gas fees. Time: 15 minutes.'
      : 'On a different day from step 2, open the second product surface ' + p.name + ' lists on ' + chain + ' (a second pool, market or vault) with $' + Math.round(capital / 2) + ' — a second, different contract is worth more than more of the same, and distributions have paid separate credit for distinct-contract counts. Cost: ' + fmtUsd(gas) + ' of gas. Time: 10 minutes.',
    weeklyAction(p, chain, lo, hi) + ', on a varying weekday — identical amounts at identical times are a published sybil signal. Keep a non-zero balance in every weekly epoch. Cost: ' + fmtUsd(gas) + ' of gas a week. Time: 10 minutes a week.',
    'Hold every position for at least ' + hold + ' days — at least ' + econ.weeks + ' weekly snapshots — and never withdraw to zero before the final snapshot: a mid-epoch exit forfeits that week\'s accrual, and programs have penalised dust balances. Cost: the $' + capital + ' stays in the positions. Time: ' + hold + ' days of holding.',
    'After each session, log the date, the transaction hash, the points balance shown in the app and the gas spent, in one running farm log for this wallet; screenshot the position as backup. The running totals prove activity in every epoch and show cost against the $' + capital + ' deployed. Cost: nothing. Time: 5 minutes per session.',
    'When a launch is announced, check eligibility on the protocol\'s official checker first, then claim from the link in its official announcement inside the claim window — unclaimed allocations are typically burned when it closes. Cost: ' + fmtUsd(gas) + ' of gas on ' + chain + '; any site asking for a claim fee or a seed phrase is a scam. Time: 10 minutes to claim and unwind.',
  ];
  return steps.map((s) => (s.length > 600 ? s.slice(0, 596) + '...' : s));
}

// ---------------------------------------------------------------- board build

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  /** The board's ranking figure: expected value (see BoardRow). */
  implied_value_usd: number;
  /** The fitted value if a launch happens. */
  launch_value_usd: number;
  /** P(token) from the issuance model, 0..1 (4dp in the payload). */
  p_token: number;
  /** Expected value: P(token) x launch value — the same number as
   *  implied_value_usd since edition 5, kept under its own name because
   *  the dashboard's arithmetic displays read it as the product. */
  ev_usd: number;
  /** Prediction interval on the LAUNCH value: launch x the OOF residual
   *  factors (VALIDATION). */
  pi_lo: number;
  pi_hi: number;
  /** The three issued comparables nearest this row in log TVL, same
   *  family first, with the market caps they actually reached — the
   *  yardstick a reader checks the fitted launch value against. */
  nearest: { name: string; tvl_usd: number; mcap_usd: number }[];
  group: string;
  size_factor: number;
  group_factor: number;
  growth_factor: number;
  age_factor: number;
  chain_factor: number;
  watchlist: boolean;
  farm_steps: string[];
  band: { p10: number; p90: number; rank_lo: number; rank_hi: number } | null;
  plan: PlanEconomics;
  /** Rank this row would hold if the board were sorted by TVL alone. */
  tvl_rank: number;
  /** Field-derived watch notes: what a farmer should check before trusting the row. */
  notes: string[];
}

/** One issued comparable, for the dashboard's method scatter. */
export interface CompPoint {
  slug: string;
  name: string;
  group: string;
  tvl_usd: number;
  mcap_usd: number;
}

/** One pre-token protocol that did not make the board, with its reason. */
export interface AuditRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: FitConstants;
  model_version: string;
  board_edition: number;
  alloc_share: number;
  opp_rate: number;
  validation: typeof VALIDATION;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Census of the rows' farm-plan verdicts, for the decision strip. */
  verdict_counts: { farm: number; thin: number; skip: number };
  /** The whole snapshot accounted for: every protocol is either ranked,
   *  already trading (the fits' evidence, never ranked), or set aside
   *  pre-token with a reason — the audit groups count those reasons. */
  universe: {
    total: number;
    ranked: number;
    traded: number;
    set_aside: number;
    audit_groups: { product: number; name: number; exchange: number; versioned: number; other: number };
  };
  /** Rows the model moves 50 or more places against a TVL-only ranking. */
  moved_50: number;
  rows: RadarRow[];
  live: LiveRow[];
  comps: CompPoint[];
  audit: AuditRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlugAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildBoard(snapshot: Snapshot, fit: FitConstants = FIT): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Selection is unchanged from edition 4 — and on this snapshot it is
  // vacuous: the rankable early pool (158) is smaller than EARLY_ROWS, so
  // every standalone pre-token protocol makes the board and the ranking
  // below is the only ordering decision there is.
  const earlyPool = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, s: impliedValue(p, snapshot.as_of, fit) }))
    .sort((a, b) => b.s.implied - a.s.implied || bySlugAsc(a.p.slug, b.p.slug))
    .slice(0, EARLY_ROWS);
  for (const e of earlyPool) chosen.set(e.p.slug, e.p);

  // Edition 5's one change: the sort key is the expected value — the
  // issuance probability times the launch value — and that product is
  // what board.json carries as implied_value_usd. The launch value keeps
  // its own field, and the farm plan is still priced off it directly.
  const scored = [...chosen.values()].map((p) => {
    const s = impliedValue(p, snapshot.as_of, fit);
    const ptok = pToken(p, snapshot.as_of, fit);
    return { p, s, ptok, ev: ptok * s.implied };
  });
  scored.sort((a, b) => b.ev - a.ev || bySlugAsc(a.p.slug, b.p.slug));
  return scored.map((entry, i) => ({
    rank: i + 1,
    slug: entry.p.slug,
    name: entry.p.name,
    category: entry.p.category,
    chains: entry.p.chains,
    tvl_usd: entry.p.tvl_usd,
    change_7d: entry.p.change_7d,
    mcap_usd: entry.p.mcap_usd,
    listed_at: entry.p.listed_at,
    gecko_id: entry.p.gecko_id,
    symbol: entry.p.symbol,
    token_status: 'pre-token',
    age_days: entry.s.age,
    implied_value_usd: Math.round(entry.ev),
    launch_value_usd: entry.s.implied,
    model: {
      group: entry.s.group,
      size_factor: round4(entry.s.size_factor),
      group_factor: round4(entry.s.group_factor),
      growth_pct: round4(entry.s.growth_pct),
      growth_factor: round4(entry.s.growth_factor),
      age_factor: round4(entry.s.age_factor),
      chain_factor: round4(entry.s.chain_factor),
      age_days: entry.s.age,
    },
    farm_steps: farmSteps(entry.p, entry.s.age, planEconomics(entry.p, entry.s.age, entry.s.implied, BANDS[entry.p.slug]?.p10 ?? null, entry.ptok)),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || bySlugAsc(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Why a pre-token protocol is not on the board — the full-universe audit. */
export function auditReason(p: SnapshotProtocol): string {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return 'a product of another protocol (' + p.category + '), not a protocol awaiting its own launch';
  if (PRODUCT_NAME.test(p.name)) return 'the name marks it as a wrapped or staked product of another protocol';
  if (EXCHANGE_PREFIX.test(p.name)) return 'an exchange front, not an independent protocol';
  if (VERSIONED.test(p.name)) return 'a versioned duplicate of another listing';
  return 'not selected';
}

/**
 * Watch notes for one board row, derived only from the row's own snapshot
 * fields and facts the fit itself established. They name what the model
 * cannot price — routed or mercenary TVL, missing age, thin history — so a
 * reader checks the row instead of trusting it. At most three, in the order
 * a farmer would want to hear them.
 */
export function rowNotes(p: SnapshotProtocol, age: number | null, group: string): string[] {
  const notes: string[] = [];
  if (group === 'curators') {
    notes.push('Allocator: this TVL is capital routed into other protocols\u2019 markets, and the fee an allocator keeps on it is thin — the same TVL usually supports less own-token value than native TVL of the same size.');
  }
  if (p.change_7d !== null && p.change_7d >= 30) {
    notes.push('Hot week: TVL is up ' + Math.round(p.change_7d) + '% in seven days. Fast inflows are often mercenary and can leave at a launch; the model prices none of this move, in either direction.');
  } else if (p.change_7d !== null && p.change_7d <= -30) {
    notes.push('Sharp outflow: TVL is down ' + Math.round(-p.change_7d) + '% in seven days. The model prices none of the move, so the value here rests on the TVL that remains, not on the trend.');
  }
  if (p.tvl_usd >= 1_000_000_000) {
    notes.push('Very large TVL: among issued peers the market paid a median of 0.08x TVL at this size, so the fitted value sits far under TVL by construction, not by pessimism.');
  }
  if (age === null) {
    notes.push('Listing age is not recorded in the snapshot: the age term uses the ' + FIT.unknown_age_days + '-day default, and the farm plan\'s minimum hold cannot be checked against this protocol\'s own history.');
  } else if (age < 90) {
    notes.push('Young listing: ' + Math.round(age) + ' days tokenless. The thinnest history on the board — points rules, if any exist, have barely had time to be announced.');
  }
  if (p.chains.length <= 1 && age !== null && age < 365) {
    notes.push('Single-chain and under a year old: one deployment, one community — the least diversified evidence a row can carry.');
  }
  return notes.slice(0, 3);
}

/** The issued comparables nearest one protocol in log TVL — same family
 *  first, then the rest of the evidence — for the detail view's yardstick. */
function nearestComps(p: SnapshotProtocol, comps: CompPoint[]): { name: string; tvl_usd: number; mcap_usd: number }[] {
  const lt = Math.log10(Math.max(1, p.tvl_usd));
  const g = groupOf(p.category);
  const dist = (c: CompPoint): number => Math.abs(Math.log10(Math.max(1, c.tvl_usd)) - lt);
  const byDist = (a: CompPoint, b: CompPoint): number => dist(a) - dist(b) || bySlugAsc(a.slug, b.slug);
  const same = comps.filter((c) => c.group === g).sort(byDist);
  const rest = comps.filter((c) => c.group !== g).sort(byDist);
  return same.concat(rest).slice(0, 3).map((c) => ({ name: c.name, tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd }));
}

export function buildRadar(snapshot: Snapshot, fit: FitConstants = FIT): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const comps: CompPoint[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !isProductOfAnother(p) && !VERSIONED.test(p.name))
    .sort((a, b) => bySlugAsc(a.slug, b.slug))
    .map((p) => ({ slug: p.slug, name: p.name, group: groupOf(p.category), tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }));
  const tvlOrder = board.slice().sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a.slug, b.slug));
  const tvlRank = new Map(tvlOrder.map((r, i) => [r.slug, i + 1]));
  const rows: RadarRow[] = board.map((r) => {
    const p = index.get(r.slug)!;
    const band = BANDS[r.slug] ?? null;
    const ptok = pToken(p, snapshot.as_of, fit);
    return {
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      launch_value_usd: r.launch_value_usd,
      p_token: round4(ptok),
      ev_usd: r.implied_value_usd,
      pi_lo: Math.round(r.launch_value_usd * VALIDATION.pi_lo_factor),
      pi_hi: Math.round(r.launch_value_usd * VALIDATION.pi_hi_factor),
      nearest: nearestComps(p, comps),
      group: r.model.group,
      size_factor: r.model.size_factor,
      group_factor: r.model.group_factor,
      growth_factor: r.model.growth_factor,
      age_factor: r.model.age_factor,
      chain_factor: r.model.chain_factor,
      watchlist: watch.has(r.slug),
      farm_steps: r.farm_steps,
      band,
      plan: planEconomics(p, r.age_days, r.launch_value_usd, band?.p10 ?? null, ptok),
      tvl_rank: tvlRank.get(r.slug)!,
      notes: rowNotes(p, r.age_days, r.model.group),
    };
  });
  const boardSlugs = new Set(board.map((r) => r.slug));
  const audit: AuditRow[] = snapshot.protocols
    .filter((p) => isPreToken(p) && !boardSlugs.has(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a.slug, b.slug))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: auditReason(p) }));
  const auditGroups = { product: 0, name: 0, exchange: 0, versioned: 0, other: 0 };
  for (const a of audit) {
    if (a.reason.startsWith('a product of another')) auditGroups.product++;
    else if (a.reason.startsWith('the name marks')) auditGroups.name++;
    else if (a.reason.startsWith('an exchange front')) auditGroups.exchange++;
    else if (a.reason.startsWith('a versioned duplicate')) auditGroups.versioned++;
    else auditGroups.other++;
  }
  const preTokenTotal = snapshot.protocols.filter(isPreToken).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: fit,
    model_version: MODEL_VERSION,
    board_edition: BOARD_EDITION,
    alloc_share: ALLOC_SHARE,
    opp_rate: OPP_RATE,
    validation: VALIDATION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.length - snapshot.watchlist.length,
    live_size: live.length,
    verdict_counts: {
      farm: rows.filter((r) => r.plan.verdict === 'farm').length,
      thin: rows.filter((r) => r.plan.verdict === 'thin').length,
      skip: rows.filter((r) => r.plan.verdict === 'skip').length,
    },
    moved_50: rows.filter((r) => Math.abs(r.rank - r.tvl_rank) >= 50).length,
    universe: {
      total: snapshot.protocols.length,
      ranked: board.length,
      traded: snapshot.protocols.length - preTokenTotal,
      set_aside: audit.length,
      audit_groups: auditGroups,
    },
    rows,
    live,
    comps,
    audit,
  };
  return { board, radar };
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError('snapshot.json protocol ' + i + ' is not an object');
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError('snapshot.json protocol ' + i + ' lacks a slug, a name or a TVL');
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return 'board misses ' + missing.length + ' watchlist slugs: ' + missing.slice(0, 5).join(', ');
  if (board.length < 100) return 'board has ' + board.length + ' rows, under the 100-row floor';
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share one implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return r.slug + ' has ' + r.farm_steps.length + ' farm steps';
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return r.slug + ' has a farm step of ' + t.length + ' characters';
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return r.slug + ' has implied value ' + r.implied_value_usd;
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
