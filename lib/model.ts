// Token Radar — valuation model and farm-plan generator (radar-2).
//
// Input is the sealed snapshot only: ten fields per protocol, nothing else.
// No protocol name is ever special-cased. Every number below is a function of
// tvl_usd, change_7d, listed_at, category and chains.
//
// Model shape (deliberately different from a flat TVL multiple):
//
//   implied = TVL x categoryMultiple(category)
//                 x growthFactor(change_7d)
//                 x maturityFactor(age_days)
//                 x breadthFactor(chain count)
//                 x scaleFactor(TVL)
//
// - categoryMultiple: what one dollar of TVL has historically been worth at
//   launch differs by business type. A DEX or lending market monetises flow,
//   so its TVL is worth more than the same TVL parked in a yield wrapper.
// - growthFactor: 7d TVL growth, clamped to [-50, +80], weight 0.65, with the
//   extreme tail damped by a square root so one hot week cannot dominate.
// - maturityFactor: 0.55 .. 1.10 over five years. Running longer with no
//   token on record is evidence of a real product, so it earns more than the
//   house curve, and it keeps rising past three years.
// - breadthFactor: +3% per extra chain, capped at +15%. Multi-chain reach is
//   distribution a launch can use on day one.
// - scaleFactor: mega-TVL protocols launch at a compressed FDV/TVL, so above
//   $1B the multiple eases down logarithmically, floored at 0.82.

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

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_cap: number;
  scale_start_usd: number;
  scale_floor: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.65,
  growth_floor: -50,
  growth_cap: 80,
  maturity_floor: 0.55,
  maturity_range: 0.55,
  maturity_days: 1825,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_cap: 1.15,
  scale_start_usd: 1_000_000_000,
  scale_floor: 0.82,
};

export const MODEL_VERSION = 'radar-2';

/** Board size target: the 40 watchlist rows plus this many early rows. */
export const EARLY_ROWS = 200;

/** Live-token protocols carried for the dashboard's comparison strip. */
export const LIVE_ROWS = 24;

/** Category multiples: value of $1 of TVL at launch, by business type. */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('dex')) return 0.34;
  if (c.includes('derivative') || c.includes('perpetual')) return 0.33;
  if (c.includes('lend') || c.includes('cdp')) return 0.31;
  if (c.includes('launchpad')) return 0.30;
  if (c.includes('rwa')) return 0.29;
  if (c.includes('chain')) return 0.29;
  if (c.includes('curator') || c.includes('allocator')) return 0.27;
  if (c.includes('restak') || c.includes('staking')) return 0.26;
  if (c.includes('basis')) return 0.25;
  if (c.includes('yield')) return 0.23;
  if (c.includes('bridge')) return 0.22;
  if (c.includes('farm') || c.includes('leveraged')) return 0.21;
  if (c.includes('index')) return 0.20;
  if (c.includes('insurance')) return 0.20;
  if (c.includes('locker') || c.includes('services')) return 0.19;
  return 0.24;
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
export function growthFactor(change7d: number | null, model: ModelConstants): { pct: number; factor: number } {
  const raw = finite(change7d, 0);
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
  const damped = Math.abs(pct) <= 25 ? pct : Math.sign(pct) * (25 + Math.sqrt(Math.abs(pct) - 25) * 5);
  return { pct, factor: 1 + (damped / 100) * model.growth_weight };
}

export function maturityFactor(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  const t = Math.min(Math.max(days, 0), model.maturity_days) / model.maturity_days;
  return model.maturity_floor + t * model.maturity_range;
}

export function breadthFactor(chainCount: number, model: ModelConstants): number {
  if (chainCount <= 1) return 1;
  return Math.min(model.breadth_cap, 1 + (chainCount - 1) * model.breadth_per_chain);
}

/** FDV/TVL compression for very large protocols, logarithmic past $1B. */
export function scaleFactor(tvl: number, model: ModelConstants): number {
  if (tvl <= model.scale_start_usd) return 1;
  const over = Math.log10(tvl / model.scale_start_usd);
  return Math.max(model.scale_floor, 1 - 0.09 * over);
}

export interface Scored {
  implied: number;
  category_multiple: number;
  growth_pct: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  scale_factor: number;
  age: number | null;
}

export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): Scored {
  const age = ageDays(asOf, p.listed_at);
  const cm = categoryMultiple(p.category);
  const g = growthFactor(p.change_7d, model);
  const mf = maturityFactor(age, model);
  const bf = breadthFactor(p.chains.length, model);
  const sf = scaleFactor(p.tvl_usd, model);
  const implied = Math.max(1, Math.round(p.tvl_usd * cm * g.factor * mf * bf * sf));
  return {
    implied,
    category_multiple: cm,
    growth_pct: g.pct,
    growth_factor: g.factor,
    maturity_factor: mf,
    breadth_factor: bf,
    scale_factor: sf,
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
    category_multiple: number;
    growth_pct: number;
    growth_factor: number;
    maturity_factor: number;
    breadth_factor: number;
    scale_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas profile by chain family: L1 mainnet costs more than any L2 or alt-L1. */
function gasUsd(p: SnapshotProtocol): number {
  const first = (p.chains[0] ?? '').toLowerCase();
  if (first === 'ethereum') return 12;
  if (first === 'bitcoin') return 6;
  return 2;
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 35;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 730) return 35;
  return 28;
}

/** The core qualifying action, by category. Concrete verb, asset, venue. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return 'Supply $' + capital + ' of USDC to ' + n + ' on ' + chain + ', then borrow $' + Math.round(capital * 0.4) + ' against it and re-supply the borrow once';
  if (c.includes('dex')) return 'Swap $' + Math.round(capital / 2) + ' into the main pair on ' + n + ' (' + chain + '), then add $' + capital + ' of two-sided liquidity to that pool';
  if (c.includes('derivative') || c.includes('perpetual')) return 'Deposit $' + capital + ' of USDC margin on ' + n + ' (' + chain + ') and trade one small hedged position of $' + Math.round(capital / 2) + ' notional';
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

/** The weekly qualifying action, by category: what to repeat, not a slogan. */
function weeklyAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return 'Repay and re-borrow once a week on ' + n + ' so the account shows fresh borrow activity in separate weeks';
  if (c.includes('dex')) return 'Make one swap of at least $25 through ' + n + ' each week and add $10 to the liquidity position every second week';
  if (c.includes('derivative') || c.includes('perpetual')) return 'Trade at least $100 of total volume a week on ' + n + ', split across two different days, and keep the margin account funded';
  if (c.includes('bridge')) return 'Bridge at least $20 through ' + n + ' once a week, alternating direction, and use the funds on the far side each time';
  if (c.includes('restak') || c.includes('staking')) return 'Claim and restake the rewards on ' + n + ' once a week so the staking balance grows in separate weekly snapshots';
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) return 'Add $10 to the ' + n + ' vault each week and claim any points or rewards shown in its dashboard the same day';
  return 'Repeat the core action on ' + n + ' (' + chain + ') once a week with at least $20, on a different weekday than the week before';
}

/**
 * Seven steps per protocol: wallet setup, core action, second surface,
 * weekly rhythm, hold, claim safety, exit. Costs and times are derived from
 * the protocol's chain, TVL tier and age — never from its name.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const gas = gasUsd(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const multi = p.chains.length > 1 ? p.chains[1]! : null;
  const steps: string[] = [
    'Create a fresh wallet for ' + p.name + ' only, fund it with $' + (capital + gas * 3) + ' on ' + chain + ', and store the seed phrase offline. Cost: about $' + gas + ' gas to fund and set up. Time: 10 minutes.',
    coreAction(p, capital, chain) + '. Cost: $' + capital + ' of capital plus about $' + gas + ' of gas. Time: 15 minutes to set up, then it runs by itself.',
    multi !== null
      ? 'Repeat a smaller $' + Math.round(capital / 2) + ' position on ' + multi + ', the second chain ' + p.name + ' lists, so activity exists on two networks. Cost: about $2 of bridge and gas fees. Time: 15 minutes.'
      : 'Open the second product surface ' + p.name + ' lists on ' + chain + ' (a second pool, market or vault) with $' + Math.round(capital / 2) + '. Cost: about $' + gas + ' of gas. Time: 10 minutes.',
    weeklyAction(p, chain) + '. Cost: about $' + Math.max(1, Math.round(gas / 2)) + ' of gas a week. Time: 10 minutes a week.',
    'Hold every position for at least ' + hold + ' days without a full withdrawal, so the activity spans more than one weekly snapshot. Cost: the $' + capital + ' stays locked in the positions. Time: ' + hold + ' days of holding.',
    'Screenshot the wallet address, position sizes and dates into a farm log after each session, so eligibility can be proven later. Cost: nothing. Time: 5 minutes per session.',
    'When a launch or points claim is announced, claim only from the link on the protocol\'s own page and never pay a claim fee. Cost: about $' + gas + ' of gas to claim, $0 in fees. Time: 10 minutes to claim and unwind.',
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
  category_multiple: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  scale_factor: number;
  watchlist: boolean;
  farm_steps: string[];
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
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlugAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const earlyPool = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }))
    .sort((a, b) => b.s.implied - a.s.implied || bySlugAsc(a.p.slug, b.p.slug))
    .slice(0, EARLY_ROWS);
  for (const e of earlyPool) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }));
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
      category_multiple: entry.s.category_multiple,
      growth_pct: round4(entry.s.growth_pct),
      growth_factor: round4(entry.s.growth_factor),
      maturity_factor: round4(entry.s.maturity_factor),
      breadth_factor: round4(entry.s.breadth_factor),
      scale_factor: round4(entry.s.scale_factor),
      age_days: entry.s.age,
    },
    farm_steps: farmSteps(entry.p, entry.s.age),
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

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows: RadarRow[] = board.map((r) => ({
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
    category_multiple: r.model.category_multiple,
    growth_factor: r.model.growth_factor,
    maturity_factor: r.model.maturity_factor,
    breadth_factor: r.model.breadth_factor,
    scale_factor: r.model.scale_factor,
    watchlist: watch.has(r.slug),
    farm_steps: r.farm_steps,
  }));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.length - snapshot.watchlist.length,
    live_size: live.length,
    rows,
    live,
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
