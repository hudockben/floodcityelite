// ---------------------------------------------------------------------------
// Fixed Cost tab — shared types and math
//
// Fixed costs are what the program pays for up front regardless of which team a
// player lands on: uniforms, insurance, facility time, equipment. They're
// grouped under *sections* the user names, each holding line items with an
// amount.
//
// Their total divided by the player count is the **fixed cost per player**, and
// that's what ties this tab to Budgets: a team's portion of each player's
// tuition that actually reaches the team budget is
//
//     portion to team budget = tuition per player − fixed cost per player
//
// so raising a fixed cost lowers every team's starting balance without anyone
// retyping a number.
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
