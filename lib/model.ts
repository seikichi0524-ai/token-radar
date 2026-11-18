// Token Radar — valuation model and farm-plan generator (radar-3 fit,
// board edition 2).
//
// Input is the sealed snapshot only: ten fields per protocol, nothing else.
// No protocol name is ever special-cased. Every number below is a function of
// tvl_usd, change_7d, listed_at, category and chains.
//
// Edition 2 keeps the radar-3 fit exactly (a pre-registered robust challenger
// failed to beat it — see tools/fit.mjs) and rebuilds everything around it:
// bootstrap value bands per row, a full-universe audit of the pre-token
// protocols that did not make the board, and farm plans costed at 2025 gas
// levels, netted to a break-even launch value with a farm / thin / skip
// verdict per row.
//
// What changed from radar-2: the multiples are no longer hand-picked. They
// are fitted on the snapshot's own evidence — the 128 protocols in the file
// that already carry a token. 92 of those pass the same "a protocol in its
// own right" reading the board applies (no wrapped, staked or bridged
// products of another protocol, no exchange fronts, no versioned
// duplicates), and those 92 are the comparables. Least squares in log10
// space over the comparables gives:
//
//   log10(implied) = intercept + tvl_slope * log10(TVL)
//                  + growth_coef * g + age_coef * ageT
//                  + chain_coef * chains + group_offset[category family]
//
//   g      7-day TVL change, clamped to [-50, +80], square-root damped past
//          +/-25%, in units of 1.0 = 100 damped points (radar-2's transform)
//   ageT   min(age_days, 1825) / 1825; unknown age counts as 365 days
//   chains chain count, capped at 10
//   group_offset: each category family's mean residual, shrunk toward zero
//          by n/(n+4) so a two-member family cannot shout down the curve
//
// Findings the fit produced, stated plainly:
// - The size curve is flat: tvl_slope is 0.395, not 1. Among the
//   comparables, value grows far slower than TVL — the median issued
//   protocol trades at 0.87x TVL in the smallest TVL third, 0.25x in the
//   middle third and 0.08x in the largest third. radar-2's flat category
//   multiples priced mega-TVL protocols far above anything the issued
//   evidence supports.
// - The 7-day change carried no usable signal: left free, its coefficient
//   fitted negative, and the model's one sign rule — growth may not hurt —
//   dropped the term and refit the rest (growth_coef is therefore 0).
//   A hot week is shown on the board; it does not move the price.
// - Age and breadth price slightly negative once size is accounted for
//   (-0.139 over five years, -0.021 per chain): among issued comparables,
//   longer-listed and wider-spread protocols trade a little lower, not
//   higher. The effects are small next to the size curve and the family
//   offsets, and they are what the evidence says, so they stand.
//
// Validation (tools/fit.mjs reproduces every number from the snapshot):
// the 92 comparables are split into 3 folds by a hash of the slug; each fold
// is scored by a model fitted on the other two, so every comparable is
// priced once by a model that never saw it. Median absolute log10 error:
// radar-3 0.509 (a typical miss of x3.23), radar-2 0.652 (x4.48), a naive
// single multiple 0.676 (x4.74). Within 2x of the actual market cap:
// radar-3 37%, radar-2 27%. The constants below are the same fit run on all
// 92 comparables at once, printed by tools/fit.mjs at 6 decimal places.

import { BANDS } from './bands.ts';

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
  group_offsets: Record<string, number>;
  growth_floor: number;
  growth_cap: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_cap: number;
  shrink_k: number;
  comps: number;
}

export const FIT: FitConstants = {
  intercept: 4.100966,
  tvl_slope: 0.394807,
  growth_coef: 0,
  age_coef: -0.139474,
  chain_coef: -0.021341,
  group_offsets: {
    basis: 0.226325,
    chain: 0.047799,
    curators: 0.141224,
    derivatives: 0.147715,
    dexs: 0.013832,
    farm: -0.003414,
    launchpad: 0.034301,
    lending: -0.271145,
    locker: 0.190298,
    other: 0.196478,
    rwa: 0.071,
    staking: -0.175584,
    yield: -0.215444,
  },
  growth_floor: -50,
  growth_cap: 80,
  maturity_days: 1825,
  unknown_age_days: 365,
  chain_cap: 10,
  shrink_k: 4,
  comps: 92,
};

export const MODEL_VERSION = 'radar-3';

/** Out-of-sample validation of the shipped fit against the model it replaces. */
export const VALIDATION = {
  folds: 3,
  comps: 92,
  fitted_median_log_err: 0.509,
  fitted_typical_miss: 3.23,
  fitted_mean_log_err: 0.643,
  fitted_within_2x: 0.37,
  fitted_within_3x: 0.48,
  fitted_spearman: 0.301,
  loo_median_log_err: 0.607,
  time_split_old_to_new: 0.554,
  time_split_new_to_old: 0.651,
  radar2_median_log_err: 0.652,
  radar2_typical_miss: 4.48,
  radar2_within_2x: 0.27,
  naive_median_log_err: 0.676,
  naive_typical_miss: 4.74,
  naive_within_2x: 0.33,
  challenger_median_log_err: 0.53,
  challenger_spearman: 0.244,
};

/** Board edition: 1 was the first submission; 2 adds bands, audit, netted plans. */
export const BOARD_EDITION = 2;

/**
 * Declared farming assumption behind every plan's break-even: a launch
 * distributes ALLOC_SHARE of its value to the farming community, and a
 * farmer's slice is pro-rata to the capital they keep in the protocol
 * against its TVL. Stated on the dashboard; used for nothing else.
 */
export const ALLOC_SHARE = 0.1;

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
 * (implied = TVL x size x group x growth x age x chain) so a reader — and
 * the dashboard — can check the arithmetic term by term.
 */
export function impliedValue(p: SnapshotProtocol, asOf: string, fit: FitConstants = FIT): Scored {
  const age = ageDays(asOf, p.listed_at);
  const group = groupOf(p.category);
  const offset = fit.group_offsets[group] ?? 0;
  const logTvl = Math.log10(Math.max(1, p.tvl_usd));
  const gr = dampedGrowth(p.change_7d, fit);
  const ageT = Math.min(age ?? fit.unknown_age_days, fit.maturity_days) / fit.maturity_days;
  const chains = Math.min(p.chains.length, fit.chain_cap);
  const logv =
    fit.intercept +
    fit.tvl_slope * logTvl +
    fit.growth_coef * gr.g +
    fit.age_coef * ageT +
    fit.chain_coef * chains +
    offset;
  const implied = Math.max(1, Math.round(Math.pow(10, logv)));
  return {
    implied,
    group,
    size_factor: Math.pow(10, fit.intercept + (fit.tvl_slope - 1) * logTvl),
    group_factor: Math.pow(10, offset),
    growth_pct: gr.pct,
    growth_factor: Math.pow(10, fit.growth_coef * gr.g),
    age_factor: Math.pow(10, fit.age_coef * ageT),
    chain_factor: Math.pow(10, fit.chain_coef * chains),
    age,
  };
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
  implied_value_usd: number;
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
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 50;
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
  cost_usd: number;
  hours: number;
  breakeven_usd: number;
  verdict: 'farm' | 'thin' | 'skip';
}

/**
 * The plan's economics, from chain family, TVL tier and age only.
 * Cost = gas for setup + one action a week + the claim, plus one bridge
 * hop when the plan uses a second chain. Capital is the TVL tier, floored
 * so the total plan cost stays a small single-digit share of it
 * (capital >= 20x cost). Break-even is the launch value at which a
 * pro-rata slice of a declared ALLOC_SHARE community distribution repays
 * the plan's cost; the verdict compares that break-even with the row's
 * bootstrap band: at or below the band's low end is a farm, at or below
 * the central estimate is thin, above it the plan costs more than the
 * evidence supports — skip.
 */
export function planEconomics(p: SnapshotProtocol, age: number | null, implied: number, bandLow: number | null): PlanEconomics {
  const gas = gasPerAction(p);
  const hold = holdDaysFor(age);
  const weeks = Math.max(5, Math.ceil(hold / 7));
  const bridge = p.chains.length > 1 ? 3 : 0;
  const cost = Math.round((gas * (weeks + 4) + bridge) * 100) / 100;
  const capital = Math.max(capitalTier(p), Math.ceil(20 * cost));
  const hours = Math.round(((25 + 10 * weeks + 10) / 60) * 10) / 10;
  const breakeven = Math.round((cost * p.tvl_usd) / (ALLOC_SHARE * capital));
  const low = bandLow ?? implied;
  const verdict: PlanEconomics['verdict'] = breakeven <= low ? 'farm' : breakeven <= implied ? 'thin' : 'skip';
  return { capital, gas_per_action: gas, weeks, cost_usd: cost, hours, breakeven_usd: breakeven, verdict };
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
  implied_value_usd: number;
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
  validation: typeof VALIDATION;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
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
  const earlyPool = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, s: impliedValue(p, snapshot.as_of, fit) }))
    .sort((a, b) => b.s.implied - a.s.implied || bySlugAsc(a.p.slug, b.p.slug))
    .slice(0, EARLY_ROWS);
  for (const e of earlyPool) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, fit) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || bySlugAsc(a.p.slug, b.p.slug));
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
    implied_value_usd: entry.s.implied,
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
    farm_steps: farmSteps(entry.p, entry.s.age, planEconomics(entry.p, entry.s.age, entry.s.implied, BANDS[entry.p.slug]?.p10 ?? null)),
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

export function buildRadar(snapshot: Snapshot, fit: FitConstants = FIT): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rows: RadarRow[] = board.map((r) => {
    const p = index.get(r.slug)!;
    const band = BANDS[r.slug] ?? null;
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
      group: r.model.group,
      size_factor: r.model.size_factor,
      group_factor: r.model.group_factor,
      growth_factor: r.model.growth_factor,
      age_factor: r.model.age_factor,
      chain_factor: r.model.chain_factor,
      watchlist: watch.has(r.slug),
      farm_steps: r.farm_steps,
      band,
      plan: planEconomics(p, r.age_days, r.implied_value_usd, band?.p10 ?? null),
    };
  });
  const boardSlugs = new Set(board.map((r) => r.slug));
  const audit: AuditRow[] = snapshot.protocols
    .filter((p) => isPreToken(p) && !boardSlugs.has(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || bySlugAsc(a.slug, b.slug))
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: auditReason(p) }));
  const comps: CompPoint[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && !isProductOfAnother(p) && !VERSIONED.test(p.name))
    .sort((a, b) => bySlugAsc(a.slug, b.slug))
    .map((p) => ({ slug: p.slug, name: p.name, group: groupOf(p.category), tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: fit,
    model_version: MODEL_VERSION,
    board_edition: BOARD_EDITION,
    alloc_share: ALLOC_SHARE,
    validation: VALIDATION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.length - snapshot.watchlist.length,
    live_size: live.length,
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
