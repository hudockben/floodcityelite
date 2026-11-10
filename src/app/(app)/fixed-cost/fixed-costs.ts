// ---------------------------------------------------------------------------
// Fixed Cost tab — shared types and math
//
// Fixed costs are what the program pays for up front regardless of which team a
// player lands on: uniforms, insurance, facility time, equipment. They're
// grouped under *sections* the user names, each holding line items with an
// amount.
//
// The year's total is split across that year's teams, and each team's share per
// player is its **fixed cost per player** — what ties this tab to Budgets: the
// portion of each player's tuition that actually reaches the team budget is
//
//     portion to team budget = tuition per player − fixed cost per player
//
// so raising a fixed cost lowers every team's starting balance without anyone
// retyping a number.
//
// There are two ways to split it (picked per year — see SplitMethod):
//
//   • Equal per player — total ÷ the paying players. Every player carries the
//     same dollars whatever their team charges, which lands hardest on the
//     lower-priced ages and seasons (a $975 fall tuition loses as much as a
//     $2,400 spring one).
//   • Share of tuition — total ÷ the year's tuition gives one rate, and every
//     team carries that percentage of its own tuition. Overhead such as rent,
//     insurance and software has no division of its own to charge, so this
//     spreads it the way a contractor spreads home-office overhead over jobs:
//     in proportion to revenue.
//
// Both recover the same total across the year; they differ only in which teams
// carry it.
//
// Plain module (no "use server" / "use client") so the server page/actions and
// the client cards share one definition. Money is summed in integer cents —
// the same currency handling the Budgets tab uses — so totals stay exact.
// ---------------------------------------------------------------------------

import { amountToCents } from "../budgets/budget";

/** Mirrors the VARCHAR(160) columns, so inputs and the DB agree. */
export const SECTION_NAME_MAX = 160;
export const ITEM_NAME_MAX = 160;

// A user-named group of fixed costs ("Uniforms", "Insurance", "Facility").
export type FixedCostSection = {
  id: number;
  name: string;
};

// One line item inside a section. `amount` arrives from Postgres NUMERIC as a
// string (e.g. "1250.00").
export type FixedCostItem = {
  id: number;
  section_id: number;
  name: string;
  amount: string | null;
};

/** Total of a set of line items, in integer cents. */
export function itemsTotalCents(
  items: { amount: string | number | null }[],
): number {
  let cents = 0;
  for (const item of items) cents += amountToCents(item.amount);
  return cents;
}

/**
 * The player count the fixed cost is divided across: the manual override when
 * set, otherwise the number of players marked "Paying" on the rosters of the
 * program's active seasons. Mirrors the Budgets tab's paying-player override so
 * the two behave the same way.
 */
export function resolvePlayerCount(
  override: number | null,
  rosterCount: number,
): number {
  return override != null && override >= 0 ? override : rosterCount;
}

/**
 * Fixed cost per player, in integer cents — rounded to the cent so the figure
 * shown on this tab is exactly the one the Budgets tab subtracts. A count of
 * zero has nothing to divide across and yields 0 rather than Infinity.
 */
export function perPlayerCents(totalCents: number, playerCount: number): number {
  if (playerCount <= 0) return 0;
  return Math.round(totalCents / playerCount);
}

// ---- how the year's total is split across teams ----------------------------

/** Stored in fixed_cost_settings.split_method (one per company per year). */
export type SplitMethod = "per_player" | "tuition";

/** What a year uses until someone picks: the split this tab always made. */
export const DEFAULT_SPLIT_METHOD: SplitMethod = "per_player";

export const SPLIT_METHODS: {
  value: SplitMethod;
  label: string;
  description: string;
}[] = [
  {
    value: "per_player",
    label: "Equal per player",
    description:
      "Every paying player carries the same dollar amount, whatever their team charges.",
  },
  {
    value: "tuition",
    label: "Share of tuition",
    description:
      "Every team carries the same percentage of its own tuition, so lower-priced ages and seasons carry less.",
  },
];

export function isSplitMethod(value: unknown): value is SplitMethod {
  return value === "per_player" || value === "tuition";
}

/**
 * Everything needed to work out any team's fixed cost per player for one year.
 * Plain data, so the server can hand it to the Budgets card and the card can
 * recompute a team's figure live as its tuition is typed.
 */
export type FixedCostRule = {
  method: SplitMethod;
  /** The year's fixed-cost total, in integer cents. */
  totalCents: number;
  /** Equal per player: the total ÷ the player count, rounded to the cent. */
  perPlayerCents: number;
  /**
   * Share of tuition: the tuition the total is spread over — every one of the
   * year's teams' paying players × its tuition per player — in integer cents.
   */
  tuitionBaseCents: number;
};

/**
 * No fixed cost at all: each team's portion equals its tuition, the behaviour
 * from before this tab existed. What the Budgets tab falls back to when the
 * fixed costs can't be loaded.
 */
export const NO_FIXED_COST: FixedCostRule = {
  method: DEFAULT_SPLIT_METHOD,
  totalCents: 0,
  perPlayerCents: 0,
  tuitionBaseCents: 0,
};

/**
 * One team's weight in the tuition base: paying players × tuition per player,
 * in cents. The same product the Budgets tab calls total team tuition.
 */
export function tuitionContributionCents(
  payingCount: number,
  tuitionCents: number,
): number {
  return Math.max(0, payingCount) * Math.max(0, tuitionCents);
}

/**
 * The share-of-tuition rate as a fraction (0.284 = 28.4%): the year's total ÷
 * the tuition it's spread over. 0 when no team has a tuition entered yet.
 */
export function tuitionRate(totalCents: number, tuitionBaseCents: number): number {
  return tuitionBaseCents > 0 ? totalCents / tuitionBaseCents : 0;
}

/**
 * A tuition's slice of the year's total, in cents: tuition × total ÷ base,
 * rounded to the cent. Worked from the two totals rather than a rounded rate so
 * the figure is as exact as the cents it's made of.
 */
export function tuitionShareCents(
  tuitionCents: number,
  totalCents: number,
  tuitionBaseCents: number,
): number {
  if (tuitionCents <= 0 || tuitionBaseCents <= 0) return 0;
  return Math.round((tuitionCents * totalCents) / tuitionBaseCents);
}

/** A team's fixed cost per player under the year's rule, in integer cents. */
export function fixedCostCentsFor(
  rule: FixedCostRule,
  tuitionPerPlayer: number,
): number {
  if (rule.method === "tuition") {
    return tuitionShareCents(
      Math.round(tuitionPerPlayer * 100),
      rule.totalCents,
      rule.tuitionBaseCents,
    );
  }
  return rule.perPlayerCents;
}

/** The same figure in dollars, for the budget math (which works in dollars). */
export function fixedCostFor(rule: FixedCostRule, tuitionPerPlayer: number): number {
  return fixedCostCentsFor(rule, tuitionPerPlayer) / 100;
}

/**
 * The rule with one team's weight in the tuition base swapped from its saved
 * figures to the ones on screen. A team's own tuition is part of what the total
 * is spread over, so without this the Budgets card's live preview would drift
 * from the figure the page settles on once the edit saves. A no-op under equal
 * per player, where tuition plays no part in the split.
 */
export function withTeamContribution(
  rule: FixedCostRule,
  savedCents: number,
  liveCents: number,
): FixedCostRule {
  if (rule.method !== "tuition" || savedCents === liveCents) return rule;
  return {
    ...rule,
    tuitionBaseCents: Math.max(0, rule.tuitionBaseCents - savedCents + liveCents),
  };
}

/**
 * A fraction as a percentage, e.g. 0.2843 → "28.4%". A sliver that would round
 * to nothing reads "<0.1%" rather than claiming a cost comes to zero.
 */
export function formatPercent(fraction: number, digits: number = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  const pct = fraction * 100;
  const floor = 10 ** -digits;
  if (pct > 0 && pct < floor) return `<${floor.toFixed(digits)}%`;
  return `${pct.toFixed(digits)}%`;
}
