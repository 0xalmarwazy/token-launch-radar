// Farm plans for the token radar: six concrete steps per protocol, each netted
// to the dollar. Every plan is derived only from the protocol's own snapshot
// record (category, chains, TVL, age) and the model's implied value for it, and
// every step is kept inside the gate's 20..600 characters.
//
// The economics are the plan's own working figures, stated here so a reader can
// check them, and the dashboard states them too:
//
//   capital        by the protocol's TVL tier: $250 at $1B+, $150 at $100M+,
//                  $100 at $10M+, $50 below
//   gas            by the plan chain's usual fee tier, one transaction at a
//                  time: 2 to set up, 1 a week while holding, 1 to exit
//   time           15 minutes to set up, 10 a week while holding, 10 to claim,
//                  5 to log, 5 to exit — priced at $25 an hour, because a
//                  farmer's time is a cost like any other
//   opportunity    the capital at 5% a year over the hold, for what it would
//                  have earned parked elsewhere
//   airdrop pool   7% of the implied value, the community's share at launch
//                  (typical launches give 5-15% to the community)
//   farmers        about 1,000 per square root of $1M of TVL, clamped to
//                  500..500,000: bigger protocols draw more farmers, so the
//                  pool splits thinner
//   expected value the pool split evenly across the farmers, with a range of a
//                  third to three times for dilution either way
//   net EV         expected value minus gas, time and opportunity cost
//   verdict        FARM when net EV clears $100, THIN when it clears $0, SKIP
//                  when the costs eat the whole expected value
//
// Nothing here names a protocol: the same rules build every plan, and the same
// thresholds judge every verdict.

import type { SnapshotProtocol } from './model.ts';

/** One farm step as the board carries it: a single trimmed string. */
export type FarmPlan = string[];

/** A plan's verdict: worth farming, marginal, or not worth the costs. */
export type FarmVerdict = 'FARM' | 'THIN' | 'SKIP';

/** A plan's economics, as the detail view states them. */
export interface FarmEconomics {
  capital_usd: number;
  gas_per_tx_usd: number;
  tx_count: number;
  gas_total_usd: number;
  minutes: number;
  time_cost_usd: number;
  opportunity_cost_usd: number;
  cost_total_usd: number;
  hold_days: number;
  pool_usd: number;
  farmers: number;
  ev_low_usd: number;
  ev_mid_usd: number;
  ev_high_usd: number;
  net_ev_usd: number;
  verdict: FarmVerdict;
}

/** The economics' working assumptions, as the dashboard states them. */
export const FARM_ASSUMPTIONS = {
  pool_share: 0.07,
  farmers_per_sqrt_million: 1000,
  farmers_floor: 500,
  farmers_cap: 500000,
  ev_range: 3,
  hourly_rate_usd: 25,
  opportunity_apr: 0.05,
  farm_threshold_usd: 100,
};

/** Typical gas for one simple transaction on a chain, in whole US dollars. */
const GAS_BY_CHAIN: Record<string, number> = {
  Ethereum: 8,
  Solana: 1,
  Sui: 1,
  Aptos: 1,
  Arbitrum: 1,
  Optimism: 1,
  Base: 1,
  Linea: 1,
  Scroll: 1,
  Blast: 1,
  zkSync: 1,
  Binance: 1,
  Polygon: 1,
  Avalanche: 1,
  Tron: 1,
  Fantom: 1,
  Gnosis: 1,
  Bitcoin: 2,
  Hyperliquid: 1,
  'Hyperliquid L1': 1,
  Monad: 1,
  Plasma: 1,
  Berachain: 1,
  Sonic: 1,
  Sei: 1,
  Unichain: 1,
  Ink: 1,
  MegaETH: 1,
  'Robinhood Chain': 1,
  Abstract: 1,
  Corn: 1,
  Stable: 1,
  Tempo: 1,
  Katana: 1,
  Tac: 1,
};

/** The chain a plan is written for: the protocol's first chain, or a neutral phrase. */
export function planChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Gas for one transaction on the plan's chain, in whole dollars. */
export function gasFor(p: SnapshotProtocol): number {
  return GAS_BY_CHAIN[planChain(p)] ?? 1;
}

/** How much capital one farm position needs, from the protocol's TVL tier. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold the position, from how long the protocol has been tracked. */
export function holdDaysFor(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** Whole dollars, for the economics object and the plan's own words. */
function whole(n: number): number {
  return Math.max(0, Math.round(n));
}

/** A dollar figure in words: $1.2M, $48K, $222. */
export function moneyShort(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

/** A count in words: 52,478 farmers. */
function countLabel(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A protocol's farm economics: what the plan costs, what the airdrop is worth,
 * and the verdict. The expected value splits the pool evenly across the
 * farmers the protocol's size draws; the range either side is dilution.
 */
export function farmEconomics(p: SnapshotProtocol, ageDays: number | null, impliedValueUsd: number): FarmEconomics {
  const a = FARM_ASSUMPTIONS;
  const capital = capitalFor(p);
  const gas = gasFor(p);
  const hold = holdDaysFor(ageDays);
  const weeks = Math.ceil(hold / 7);
  const txCount = 2 + weeks + 1;
  const gasTotal = txCount * gas;
  const minutes = 15 + 10 * weeks + 10 + 5 + 5;
  const timeCost = (minutes / 60) * a.hourly_rate_usd;
  const opportunity = capital * a.opportunity_apr * (hold / 365);
  const costTotal = gasTotal + timeCost + opportunity;
  const pool = impliedValueUsd * a.pool_share;
  const farmers = Math.min(
    a.farmers_cap,
    Math.max(a.farmers_floor, Math.round(a.farmers_per_sqrt_million * Math.sqrt(p.tvl_usd / 1_000_000))),
  );
  const evMid = farmers > 0 ? pool / farmers : 0;
  const netEv = evMid - costTotal;
  const verdict: FarmVerdict = netEv >= a.farm_threshold_usd ? 'FARM' : netEv > 0 ? 'THIN' : 'SKIP';
  return {
    capital_usd: capital,
    gas_per_tx_usd: gas,
    tx_count: txCount,
    gas_total_usd: whole(gasTotal),
    minutes,
    time_cost_usd: whole(timeCost),
    opportunity_cost_usd: whole(opportunity),
    cost_total_usd: whole(costTotal),
    hold_days: hold,
    pool_usd: whole(pool),
    farmers,
    ev_low_usd: whole(evMid / a.ev_range),
    ev_mid_usd: whole(evMid),
    ev_high_usd: whole(evMid * a.ev_range),
    net_ev_usd: Math.round(netEv),
    verdict,
  };
}

/** The category's one action, in words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC on ${name} on ${chain} and leave the deposit earning.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and hold the LP position.`;
  }
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) {
    return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  }
  if (c.includes('rwa')) {
    return `Buy $${capital} of ${name}'s tokenized real-world asset on ${chain} and hold it.`;
  }
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator')) {
    return `Allocate $${capital} to a ${name} curator vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('option')) {
    return `Post $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC through ${name} to ${chain} and use the funds in its app.`;
  }
  if (c.includes('staking') || c.includes('restak') || c.includes('staking pool')) {
    return `Stake $${capital} through ${name} on ${chain} and hold the receipt token.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} and take one position on a ${name} market.`;
  }
  if (c.includes('stable')) {
    return `Mint or hold $${capital} of ${name}'s stable asset on ${chain}.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('basis trading')) {
    return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and hold the position.`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  }
  if (c === 'chain') {
    return `Use ${name}'s chain: bridge $${capital} in, make one swap, and hold a native position.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position active.`;
}

/** Trim a step to the gate's 20..600 characters without cutting a word in half. */
function fitStep(text: string): string {
  let s = text.replace(/\s+/g, ' ').trim();
  if (s.length > 600) {
    const cut = s.slice(0, 597);
    const lastSpace = cut.lastIndexOf(' ');
    s = `${cut.slice(0, lastSpace > 400 ? lastSpace : 597)}...`;
  }
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, and
 * the fourth step carries the whole economics — expected value, costs, net and
 * verdict — so the plan is netted to the dollar, not a list of chores.
 */
export function farmPlan(
  p: SnapshotProtocol,
  ageDays: number | null,
  impliedValueUsd: number,
  economics: FarmEconomics,
): FarmPlan {
  const chain = planChain(p);
  const gas = economics.gas_per_tx_usd;
  const capital = economics.capital_usd;
  const hold = economics.hold_days;
  const action = actionFor(p, capital, chain);
  const weeks = Math.ceil(hold / 7);
  const net = economics.net_ev_usd;
  const netLabel = net >= 0 ? `about $${net}` : `about -$${Math.abs(net)}`;
  const verdictLine =
    economics.verdict === 'FARM'
      ? 'Verdict: FARM — the expected value clears the costs by a wide margin.'
      : economics.verdict === 'THIN'
        ? 'Verdict: THIN — the expected value barely clears the costs; farm it only if you are already on this chain.'
        : 'Verdict: SKIP — the costs eat the whole expected value; a larger position or a cheaper chain would be needed.';
  return [
    fitStep(
      `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ` +
        `Budget about $${gas} of gas on ${chain} for the first transaction; allow 15 minutes.`,
    ),
    fitStep(
      `${action} ` +
        `Budget the $${capital} of capital plus about $${gas * 2} of gas for the setup; allow 15 minutes.`,
    ),
    fitStep(
      `Make one qualifying action each week for ${weeks} weeks, such as a deposit, a swap, a borrow or a vote, ` +
        `so the wallet stays active across snapshots. Budget about $${gas} of gas a week; allow 10 minutes a week.`,
    ),
    fitStep(
      `Check the math before you commit: if 7% of the ${moneyShort(impliedValueUsd)} implied value reaches ` +
        `about ${countLabel(economics.farmers)} farmers, one farmer expects about $${economics.ev_mid_usd} ` +
        `($${economics.ev_low_usd}–$${economics.ev_high_usd}) against about $${economics.cost_total_usd} of gas, time and capital costs. ` +
        `Net ${netLabel}. ${verdictLine}`,
    ),
    fitStep(
      `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it ` +
        `publishes; never pay anyone to claim for you. Budget nothing to check; allow 10 minutes.`,
    ),
    fitStep(
      `Write the wallet, the dates and every transaction in a farm log, and plan the exit: unwind in ` +
        `tranches if the protocol's TVL falls by a fifth in a week. Budget about $${gas} of exit gas; allow 5 minutes plus the exit.`,
    ),
  ];
}
