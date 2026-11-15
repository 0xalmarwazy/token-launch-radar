// The token radar's model, third version: comps-fitted valuation.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and every other launch candidate: the early rows the radar exists to
// find. A protocol is a launch candidate when its record shows no token and it
// is not a wrapped, staked or bridged product, not an exchange, and not a
// versioned pool of another protocol. Protocols whose token already trades are
// kept apart in the dashboard's Live view and never ranked: their market cap is
// the market's own value, not a model's — and they are the model's comparables.
//
// Implied value is fitted from the snapshot's own tokenized protocols:
//
//   comps        the tokenized protocols with a positive TVL and market cap,
//                minus exchanges, minus versioned pools (a V2 entry carries its
//                parent's token, so its ratio prices the parent), minus ratios
//                outside 0.001..20 (a dead token, or a token that prices a
//                parent protocol, is a data artifact, not a comparable)
//   global       the comps' median market-cap-to-TVL ratio
//   category     each category's median ratio, shrunk toward the global with a
//                prior weight of 8 comps, so a category with one comp cannot
//                decide its own multiple; then clamped to half..twice the
//                global, for the same reason
//   size curve   an ordinary least squares fit of log(market cap) on log(TVL)
//                over the comps: the market pays a lower multiple as protocols
//                grow, so a protocol's ratio is scaled by
//                (TVL / median comp TVL) ^ (slope - 1), clamped to 0.10..5.00
//   comps value  TVL x category ratio x size factor
//   overlays     small judgment adjustments the comps fit cannot see: growth
//                from the 7-day TVL change (clamped -50..+100%, weight 0.20),
//                tenure from days listed with no token (0.85 at day zero to
//                1.05 at three years), breadth from chains run (+1% each,
//                capped at six). The fit found no significant growth or age
//                signal among the comps (correlation -0.08 and -0.04), so the
//                overlays are kept small and are labeled as judgment.
//   implied      max(1, round(comps value x growth x tenure x breadth))
//
// The fit is validated out of sample, on the comps themselves, and the
// dashboard states the numbers: a five-fold cross-validation (folds by slug, so
// the split is the same on every run), a time split (fit on the older half of
// the comps by listing date, tested on the newer half), and a bootstrap of the
// global median (500 resamples from a fixed-seed generator). A flat 0.30x
// multiple — the previous version's model — is scored the same way, so the
// reader can see what the fit buys. No protocol name is ever special-cased:
// the same functions fit and score every row, and the dashboard states the
// formula, the fit and the validation.

import { farmEconomics, farmPlan } from './farm.ts';
import type { FarmEconomics, FarmVerdict } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  shrink_prior: number;
  factor_floor: number;
  factor_cap: number;
  size_floor: number;
  size_cap: number;
  ratio_floor: number;
  ratio_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  tenure_floor: number;
  tenure_range: number;
  tenure_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  cv_folds: number;
  bootstrap_draws: number;
  bootstrap_seed: number;
}

export const MODEL: ModelConstants = {
  shrink_prior: 8,
  factor_floor: 0.5,
  factor_cap: 2,
  size_floor: 0.1,
  size_cap: 5,
  ratio_floor: 0.001,
  ratio_cap: 20,
  growth_weight: 0.2,
  growth_floor: -50,
  growth_cap: 100,
  tenure_floor: 0.85,
  tenure_range: 0.2,
  tenure_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.01,
  breadth_max_chains: 5,
  cv_folds: 5,
  bootstrap_draws: 500,
  bootstrap_seed: 20261114,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many nearest comps a row's detail view names. */
export const NEAREST_COMPS = 3;

/** One comparable: a tokenized protocol the fit reads. */
export interface Comp {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  listed_at: string | null;
}

/** One category's fitted multiple. */
export interface CategoryFit {
  category: string;
  comps: number;
  median_ratio: number;
  fitted_ratio: number;
}

/** The fitted model: everything a row's value is computed from. */
export interface CompsFit {
  comps: number;
  excluded: number;
  global_ratio: number;
  size_slope: number;
  size_intercept: number;
  median_comp_tvl: number;
  categories: CategoryFit[];
}

/** One validation run's numbers: median error as a factor, and hit rates. */
export interface ValidationRun {
  n: number;
  median_factor_error: number;
  within_2x: number;
  within_3x: number;
}

/** The model's whole validation: cross-validation, time split, bootstrap, baseline. */
export interface Validation {
  cv: ValidationRun;
  time_split: (ValidationRun & { split_date: string; train_n: number; test_n: number }) | null;
  bootstrap: { draws: number; median_low: number; median: number; median_high: number };
  baseline_median_factor_error: number;
}

/** One row's model breakdown, as the detail view states it. */
export interface ModelBreakdown {
  comps: number;
  category_comps: number;
  category_ratio: number;
  global_ratio: number;
  size_factor: number;
  size_slope: number;
  comps_value_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  tenure_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
  nearest: { slug: string; name: string; ratio: number }[];
}

/** One row of board.json: the ranked board's row. */
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
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
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
  on_watchlist: boolean;
  verdict: FarmVerdict;
  net_ev_usd: number;
  model: ModelBreakdown;
  farm: FarmEconomics;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the fit and its validation. */
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
  fit: CompsFit;
  validation: Validation;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list; 0 when empty. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word that marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** Categories that are wrapped, staked or bridged products of a protocol whose token trades. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is a launch candidate: pre-token, not a wrapped, staked or
 * bridged product, not an exchange, and not a versioned pool. The same rule the
 * house used for its watchlist, applied to the whole snapshot.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * Whether a protocol is a comparable the fit may read: tokenized, with a
 * positive TVL and market cap, not an exchange, not a versioned pool, and with
 * a market-cap-to-TVL ratio inside the sane band. A V2 entry carries its
 * parent's token, so its ratio prices the parent; a ratio outside the band is a
 * dead token or a token pricing another protocol, not a comparable.
 */
export function isComp(p: SnapshotProtocol, model: ModelConstants): boolean {
  if (p.mcap_usd === null || p.mcap_usd <= 0) return false;
  if (p.tvl_usd <= 0) return false;
  if (p.category === 'CEX') return false;
  if (VERSIONED.test(p.name)) return false;
  const ratio = p.mcap_usd / p.tvl_usd;
  return ratio >= model.ratio_floor && ratio <= model.ratio_cap;
}

/** The snapshot's comparables, by slug, with their ratios. */
export function selectComps(snapshot: Snapshot, model: ModelConstants): { comps: Comp[]; excluded: number } {
  const tokenized = snapshot.protocols.filter((p) => p.mcap_usd !== null);
  const comps = tokenized
    .filter((p) => isComp(p, model))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      ratio: (p.mcap_usd as number) / p.tvl_usd,
      listed_at: p.listed_at,
    }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { comps, excluded: tokenized.length - comps.length };
}

/** The least-squares line of log(market cap) on log(TVL) over the comps. */
function sizeCurve(comps: Comp[]): { slope: number; intercept: number } {
  if (comps.length < 2) return { slope: 1, intercept: 0 };
  const xs = comps.map((c) => Math.log(c.tvl_usd));
  const ys = comps.map((c) => Math.log(c.mcap_usd));
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - meanX) * (ys[i]! - meanY);
    sxx += (xs[i]! - meanX) * (xs[i]! - meanX);
  }
  const slope = sxx === 0 ? 1 : sxy / sxx;
  return { slope, intercept: meanY - slope * meanX };
}

/** A category's fitted ratio: its median, shrunk toward the global, clamped to the factor band. */
function fittedCategoryRatio(
  category: string | null,
  categoryMedian: Map<string, number>,
  categoryCount: Map<string, number>,
  global: number,
  model: ModelConstants,
): { ratio: number; comps: number } {
  const key = category ?? '';
  const n = categoryCount.get(key) ?? 0;
  const med = categoryMedian.get(key);
  if (med === undefined || n === 0) return { ratio: global, comps: 0 };
  const shrunk = (n * med + model.shrink_prior * global) / (n + model.shrink_prior);
  const ratio = Math.min(model.factor_cap * global, Math.max(model.factor_floor * global, shrunk));
  return { ratio, comps: n };
}

/** The fitted model from one comp set: medians, category fits and the size curve. */
export function fitComps(comps: Comp[], model: ModelConstants): CompsFit & { compsList: Comp[] } {
  const global = median(comps.map((c) => c.ratio));
  const byCategory = new Map<string, number[]>();
  for (const c of comps) {
    const key = c.category ?? '';
    const list = byCategory.get(key) ?? [];
    list.push(c.ratio);
    byCategory.set(key, list);
  }
  const categoryMedian = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  for (const [key, ratios] of byCategory) {
    categoryMedian.set(key, median(ratios));
    categoryCount.set(key, ratios.length);
  }
  const categories: CategoryFit[] = [...byCategory.keys()]
    .map((key) => {
      const med = categoryMedian.get(key) as number;
      const n = categoryCount.get(key) as number;
      const { ratio } = fittedCategoryRatio(key === '' ? null : key, categoryMedian, categoryCount, global, model);
      return { category: key === '' ? '(no category)' : key, comps: n, median_ratio: round4(med), fitted_ratio: round4(ratio) };
    })
    .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  const curve = sizeCurve(comps);
  return {
    comps: comps.length,
    excluded: 0,
    global_ratio: global,
    size_slope: curve.slope,
    size_intercept: curve.intercept,
    median_comp_tvl: median(comps.map((c) => c.tvl_usd)),
    categories,
    compsList: comps,
  };
}

/** The size factor for one TVL: the curve's ratio at that size, relative to the median comp. */
function sizeFactor(tvl: number, fit: CompsFit, model: ModelConstants): number {
  if (fit.median_comp_tvl <= 0 || tvl <= 0) return 1;
  const raw = Math.pow(tvl / fit.median_comp_tvl, fit.size_slope - 1);
  return Math.min(model.size_cap, Math.max(model.size_floor, raw));
}

/** The judgment overlays for one protocol: growth, tenure and breadth. */
export function overlayMultipliers(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { growthPct: number; growth: number; tenure: number; breadth: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growth = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const tenure =
    model.tenure_floor + (Math.min(Math.max(ageForModel, 0), model.tenure_days) / model.tenure_days) * model.tenure_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadth = 1 + extraChains * model.breadth_per_chain;
  return { growthPct, growth, tenure, breadth, age };
}

/** The comps value and implied value one protocol gets under a fit, with the breakdown. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit & { compsList: Comp[] },
  model: ModelConstants,
): { implied: number; breakdown: ModelBreakdown } {
  const categoryMedian = new Map(fit.categories.map((c) => [c.category === '(no category)' ? '' : c.category, c.median_ratio]));
  const categoryCount = new Map(fit.categories.map((c) => [c.category === '(no category)' ? '' : c.category, c.comps]));
  const { ratio: categoryRatio, comps: categoryComps } = fittedCategoryRatio(
    protocol.category,
    categoryMedian,
    categoryCount,
    fit.global_ratio,
    model,
  );
  const factor = sizeFactor(protocol.tvl_usd, fit, model);
  const compsValue = protocol.tvl_usd * categoryRatio * factor;
  const { growthPct, growth, tenure, breadth, age } = overlayMultipliers(protocol, asOf, model);
  const implied = Math.max(1, Math.round(compsValue * growth * tenure * breadth));
  return {
    implied,
    breakdown: {
      comps: fit.comps,
      category_comps: categoryComps,
      category_ratio: round4(categoryRatio),
      global_ratio: round4(fit.global_ratio),
      size_factor: round4(factor),
      size_slope: round4(fit.size_slope),
      comps_value_usd: Math.round(compsValue),
      growth_pct: growthPct,
      growth_multiplier: round4(growth),
      tenure_multiplier: round4(tenure),
      breadth_multiplier: round4(breadth),
      age_days: age,
      nearest: nearestComps(protocol, fit.compsList),
    },
  };
}

/** The closest comparables to one protocol: same category first, then by TVL distance. */
function nearestComps(
  protocol: SnapshotProtocol,
  comps: Comp[],
): { slug: string; name: string; ratio: number }[] {
  const distance = (c: Comp): number => Math.abs(Math.log(c.tvl_usd) - Math.log(Math.max(1, protocol.tvl_usd)));
  const same = comps
    .filter((c) => (c.category ?? '') === (protocol.category ?? ''))
    .sort((a, b) => distance(a) - distance(b) || (a.slug < b.slug ? -1 : 1));
  const rest = comps
    .filter((c) => (c.category ?? '') !== (protocol.category ?? ''))
    .sort((a, b) => distance(a) - distance(b) || (a.slug < b.slug ? -1 : 1));
  return [...same, ...rest].slice(0, NEAREST_COMPS).map((c) => ({ slug: c.slug, name: c.name, ratio: round4(c.ratio) }));
}

/** The previous version's model, for the baseline: a flat 0.30x multiple and its overlays. */
function baselineValue(protocol: SnapshotProtocol, asOf: string): number {
  const growthPct = Math.min(100, Math.max(-50, finite(protocol.change_7d, 0)));
  const growth = 1 + (growthPct / 100) * 0.4;
  const age = ageDays(asOf, protocol.listed_at) ?? 365;
  const tenure = 0.7 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.3;
  const breadth = 1 + Math.min(Math.max(protocol.chains.length - 1, 0), 5) * 0.02;
  return Math.max(1, protocol.tvl_usd * 0.3 * growth * tenure * breadth);
}

/** One validation run's numbers from absolute log errors. */
function validationRun(errors: number[]): ValidationRun {
  const sorted = [...errors].sort((a, b) => a - b);
  const medianError = median(sorted);
  return {
    n: errors.length,
    median_factor_error: round2(Math.exp(medianError)),
    within_2x: round2(errors.filter((e) => e <= Math.log(2)).length / Math.max(1, errors.length)),
    within_3x: round2(errors.filter((e) => e <= Math.log(3)).length / Math.max(1, errors.length)),
  };
}

/** A small deterministic generator: the bootstrap's resamples are the same on every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/**
 * The model's validation, computed from the comps at run time: five-fold
 * cross-validation (folds by slug, refit per fold), a time split (fit on the
 * older half by listing date, tested on the newer half), a bootstrap of the
 * global median, and the flat-multiple baseline scored the same way.
 */
export function validateModel(
  comps: Comp[],
  snapshot: Snapshot,
  model: ModelConstants,
): Validation {
  const asOf = snapshot.as_of;
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const protocolOf = (c: Comp): SnapshotProtocol => bySlug.get(c.slug) as SnapshotProtocol;

  // Five-fold cross-validation: each fold is refit from the other four, and
  // predicts the held-out comps' market caps with the full model.
  const cvErrors: number[] = [];
  for (let fold = 0; fold < model.cv_folds; fold++) {
    const train = comps.filter((_, i) => i % model.cv_folds !== fold);
    const test = comps.filter((_, i) => i % model.cv_folds === fold);
    if (train.length < 2 || test.length === 0) continue;
    const fit = fitComps(train, model);
    for (const c of test) {
      const { implied } = impliedValue(protocolOf(c), asOf, fit, model);
      cvErrors.push(Math.abs(Math.log(implied / c.mcap_usd)));
    }
  }
  const cv = validationRun(cvErrors);

  // Time split: the comps with a listing date, split at their median date.
  const dated = comps.filter((c) => c.listed_at !== null).sort((a, b) => (a.listed_at as string) < (b.listed_at as string) ? -1 : 1);
  let timeSplit: Validation['time_split'] = null;
  if (dated.length >= 10) {
    const splitAt = Math.floor(dated.length / 2);
    const splitDate = dated[splitAt]!.listed_at as string;
    const train = dated.slice(0, splitAt);
    const test = dated.slice(splitAt);
    if (train.length >= 5 && test.length >= 5) {
      const fit = fitComps(train, model);
      const errors = test.map((c) => {
        const { implied } = impliedValue(protocolOf(c), asOf, fit, model);
        return Math.abs(Math.log(implied / c.mcap_usd));
      });
      timeSplit = { ...validationRun(errors), split_date: splitDate, train_n: train.length, test_n: test.length };
    }
  }

  // Bootstrap: resample the comps' ratios, refit the global median each time.
  const ratios = comps.map((c) => c.ratio);
  const random = lcg(model.bootstrap_seed);
  const medians: number[] = [];
  for (let draw = 0; draw < model.bootstrap_draws; draw++) {
    const sample: number[] = [];
    for (let i = 0; i < ratios.length; i++) sample.push(ratios[Math.floor(random() * ratios.length)]!);
    medians.push(median(sample));
  }
  medians.sort((a, b) => a - b);
  const low = medians[Math.floor(medians.length * 0.05)] ?? 0;
  const high = medians[Math.floor(medians.length * 0.95)] ?? 0;

  // Baseline: the flat 0.30x multiple on every comp, no fitting at all.
  const baselineErrors = comps.map((c) => Math.abs(Math.log(baselineValue(protocolOf(c), asOf) / c.mcap_usd)));
  const baseline = validationRun(baselineErrors);

  return {
    cv,
    time_split: timeSplit,
    bootstrap: {
      draws: model.bootstrap_draws,
      median_low: round4(low),
      median: round4(median(ratios)),
      median_high: round4(high),
    },
    baseline_median_factor_error: baseline.median_factor_error,
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  fit: CompsFit & { compsList: Comp[] },
  model: ModelConstants = MODEL,
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever the candidate rule
  // says about it, because the gate's coverage row is never gambled.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every launch candidate the watchlist does not name, with no
  // cap and no TVL floor of its own. A chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, fit, model);
    const economics = farmEconomics(p, breakdown.age_days, implied);
    return { p, implied, breakdown, economics };
  });
  // Strongest first; the slug breaks ties so the order is the same on every run.
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlist = new Set(snapshot.watchlist);
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm: s.economics,
    farm_steps: farmPlan(s.p, s.breakdown.age_days, s.implied, s.economics),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
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

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    on_watchlist: row.on_watchlist,
    verdict: row.farm.verdict,
    net_ev_usd: row.farm.net_ev_usd,
    model: row.model,
    farm: row.farm,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData; fit: CompsFit; validation: Validation } {
  const { comps, excluded } = selectComps(snapshot, model);
  const fit = fitComps(comps, model);
  fit.excluded = excluded;
  const validation = validateModel(comps, snapshot, model);
  const board = buildBoard(snapshot, fit, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    fit: {
      comps: fit.comps,
      excluded: fit.excluded,
      global_ratio: round4(fit.global_ratio),
      size_slope: round4(fit.size_slope),
      size_intercept: round4(fit.size_intercept),
      median_comp_tvl: fit.median_comp_tvl,
      categories: fit.categories,
    },
    validation,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, fit, validation };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
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
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
