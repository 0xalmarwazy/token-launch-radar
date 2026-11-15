// Farm plans for the token radar: six concrete steps per protocol, derived only
// from the protocol's own snapshot record (category, chains, TVL, age). Every step
// carries what it costs and how long it takes, in the step's own words, and every
// step is kept inside the gate's 20..600 characters.
//
// The numbers are the plan's own working figures, stated here so a reader can
// check them: capital by the protocol's TVL tier, gas by its first chain's usual
// fee tier, and a hold window by how long the protocol has been tracked. Nothing
// here names a protocol: the same rules build every plan.

import type { SnapshotProtocol } from './model.ts';

/** One farm step as the board carries it: a single trimmed string. */
export type FarmPlan = string[];

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
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmPlan(p: SnapshotProtocol, ageDays: number | null): FarmPlan {
  const chain = planChain(p);
  const gas = gasFor(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(ageDays);
  const action = actionFor(p, capital, chain);
  const weeklyGas = Math.max(1, Math.round(gas * 2));
  return [
    fitStep(
      `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ` +
        `Budget about $${gas} of gas on ${chain} for the first transaction; allow 5 minutes.`,
    ),
    fitStep(
      `${action} ` +
        `Budget the $${capital} of capital plus about $${gas} of gas; allow 15 minutes to set it up.`,
    ),
    fitStep(
      `Make one qualifying action each week, such as a deposit, a swap, a borrow or a vote, so the wallet ` +
        `stays active across snapshots. Budget about $${weeklyGas} of gas a week; allow 10 minutes a week.`,
    ),
    fitStep(
      `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. ` +
        `Budget the $${capital} staying in the position; allow ${hold} days.`,
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
