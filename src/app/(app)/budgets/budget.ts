// ---------------------------------------------------------------------------
// Budgets tab — shared types, formatting, and math
//
// Plain module (no "use server" / "use client") so it can be imported by the
// server page and the client budget card alike. Keeping the money formatting
// and the budget formulas here means the live preview in the browser and any
// server-side rendering stay in sync.
// ---------------------------------------------------------------------------

import { resolveDivision, type DivisionSlug, type Sport } from "../teams/divisions";

// Row shape returned by the Budgets page query: a team, its roster count, and
// its saved budget inputs (NULL when the team has no budget row yet).
export type TeamBudgetRow = {
  id: number;
  name: string;
  division: DivisionSlug;
  sport: Sport;
  /** Roster size from the Teams tab (source of the paying-player default). */
  player_count: number;
  tuition_per_player: number | null;
  portion_to_team_budget: number | null;
  /** Optional override for the paying-player count; NULL uses the roster. */
  paying_players: number | null;
  /** Sum of every scheduled event's cost for this team (the Schedules tab
   *  total), in dollars. 0 when the team has no events. */
  scheduled_cost: number;
};

// The saved inputs handed to the client card (already coalesced to numbers).
export type SavedBudget = {
  tuitionPerPlayer: number;
  portionToTeamBudget: number;
  /** null → fall back to the roster count. */
  payingPlayersOverride: number | null;
};

/** Human-readable label for a division slug (reuses the Teams definitions). */
export function divisionLabel(slug: string): string {
  return resolveDivision(slug).label;
}

// ---- formatting -----------------------------------------------------------

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a number as USD, e.g. 1200 → "$1,200.00". */
export function formatMoney(n: number): string {
  // Guard against NaN/Infinity from bad input so the sheet never shows "$NaN".
  return USD.format(Number.isFinite(n) ? n : 0);
}

/**
 * Parse a loosely-typed money string ("$1,200.00", "1200", "") into a number.
 * Returns 0 for anything that isn't a finite, non-negative amount.
 */
export function parseMoney(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const n = Number.parseFloat(String(raw).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// ---- budget math ----------------------------------------------------------

/**
 * The paying-player count used across the budget: the manual override when set,
 * otherwise the roster count from the Teams tab.
 */
export function resolvePayingCount(
  override: number | null,
  rosterCount: number,
): number {
  return override != null && override >= 0 ? override : rosterCount;
}

export function totalTuition(payingCount: number, tuitionPerPlayer: number): number {
  return payingCount * tuitionPerPlayer;
}

export function startingBalance(
  payingCount: number,
  portionToTeamBudget: number,
): number {
  return payingCount * portionToTeamBudget;
}

/**
 * Current team-budget balance: the starting balance less every scheduled cost
 * from the Schedules tab (the same per-team total shown there). Rounded to
 * whole cents so display and downstream math don't drift on float subtraction.
 */
export function currentBalance(starting: number, scheduledCost: number): number {
  return Math.round((starting - scheduledCost) * 100) / 100;
}

/**
 * Fundraising needed per player. The current balance already nets out every
 * scheduled cost, so a negative balance means the team is short and each paying
 * player raises an equal share to get back to zero; a non-negative balance
 * needs no fundraising.
 */
export function fundraisingPerPlayer(
  balance: number,
  payingCount: number,
): number {
  if (payingCount <= 0) return 0;
  return balance < 0 ? Math.abs(balance) / payingCount : 0;
}
