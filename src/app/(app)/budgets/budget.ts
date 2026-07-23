// ---------------------------------------------------------------------------
// Budgets tab — shared types, formatting, and math
//
// Plain module (no "use server" / "use client") so it can be imported by the
// server page and the client budget card alike. Keeping the money formatting
// and the budget formulas here means the live preview in the browser and any
// server-side rendering stay in sync.
// ---------------------------------------------------------------------------

import { type DivisionSlug, type Sport } from "../teams/divisions";
import { type EventStatus } from "../schedules/events";

// Row shape returned by the Budgets page query: a team, its roster count, and
// its saved budget inputs (NULL when the team has no budget row yet).
export type TeamBudgetRow = {
  id: number;
  name: string;
  division: DivisionSlug;
  sport: Sport;
  /** Total roster size from the Teams tab (shown for context). */
  player_count: number;
  /** Roster players marked "Paying" — the paying-player default. */
  paying_count: number;
  tuition_per_player: number | null;
  portion_to_team_budget: number | null;
  /** Optional manual override for the paying-player count; NULL uses the
   *  roster's paying_count. */
  paying_players: number | null;
  /** Sum of every scheduled event's cost for this team (the Schedules tab
   *  total), in dollars. 0 when the team has no events. */
  scheduled_cost: number;
};

// The saved inputs handed to the client card (already coalesced to numbers).
export type SavedBudget = {
  tuitionPerPlayer: number;
  portionToTeamBudget: number;
  /** null → fall back to the roster's paying-player count. */
  payingPlayersOverride: number | null;
};

// ---- team expenses --------------------------------------------------------
//
// Ad-hoc costs logged against a team on the Budgets tab (a coach's hotel, gas,
// gear, etc.). The status decides how the expense hits the current balance:
//   • paid     → deducted from the balance (money spent)
//   • refund   → credited back to the balance (money returned)
//   • not_paid → tracked only; no effect on the balance until marked paid
// `key` (the DB `status` value) is also the value submitted by the dropdown.

export type ExpenseStatus = "paid" | "not_paid" | "refund";

export const EXPENSE_STATUSES: { value: ExpenseStatus; label: string }[] = [
  { value: "paid", label: "Paid" },
  { value: "not_paid", label: "Not Paid" },
  { value: "refund", label: "Refund" },
];

export const DEFAULT_EXPENSE_STATUS: ExpenseStatus = "paid";

export function isExpenseStatus(value: string): value is ExpenseStatus {
  return value === "paid" || value === "not_paid" || value === "refund";
}

export function expenseStatusLabel(value: string): string {
  return EXPENSE_STATUSES.find((s) => s.value === value)?.label ?? value;
}

// Shape returned by the expenses query (snake_case columns from Postgres).
// `amount` comes back as text (NUMERIC cast to text) so we format it and sum it
// in integer cents without floating-point surprises.
export type ExpenseRow = {
  id: number;
  team_id: number;
  expense_date: string | null;
  vendor: string | null;
  amount: string | null;
  status: ExpenseStatus;
};

// ---- scheduled tournaments ------------------------------------------------
//
// Read-only view of a team's Schedules-tab tournaments, surfaced under the
// Budgets tab so the scheduled cost that comes off the balance is itemized in
// one place. Each row mirrors the schedule_events columns the budget cares
// about; `cost` arrives as text (NUMERIC cast to text) so it sums in integer
// cents like everything else here. These rows are display-only on the Budgets
// tab — they're added and edited on the Schedules tab.
export type TournamentRow = {
  id: number;
  team_id: number;
  event_date: string | null;
  event_end_date: string | null;
  event_name: string;
  event_host: string | null;
  location: string | null;
  cost: string | null;
  status: EventStatus;
};

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

// Deterministic date formatting (no locale/timezone lookups) so server- and
// client-rendered expense rows always match — the rows hydrate as client
// components, so a locale-dependent formatter could cause a mismatch.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-07-21" → "Jul 21, 2026". Empty/invalid → em dash. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/**
 * Compact date range for a (possibly multi-day) tournament. Single day →
 * "Jul 21, 2026"; same month → "Jul 21 – 23, 2026"; same year, different month
 * → "Jul 30 – Aug 2, 2026"; spanning years → "Dec 30, 2026 – Jan 2, 2027". A
 * missing/earlier end date collapses to the single start date, and an empty
 * start date is an em dash. Deterministic (no Date/locale) so the server- and
 * client-rendered tournament rows always match.
 */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  if (!start) return "—";
  const s = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!s) return formatDate(start);
  const e = end ? /^(\d{4})-(\d{2})-(\d{2})/.exec(end) : null;
  // No usable end, or it isn't after the start → just the start date.
  if (!e || end! <= start) return formatDate(start);
  const sMon = MONTHS[Number(s[2]) - 1];
  const eMon = MONTHS[Number(e[2]) - 1];
  const sDay = Number(s[3]);
  const eDay = Number(e[3]);
  if (s[1] === e[1] && s[2] === e[2]) return `${sMon} ${sDay} – ${eDay}, ${s[1]}`;
  if (s[1] === e[1]) return `${sMon} ${sDay} – ${eMon} ${eDay}, ${s[1]}`;
  return `${sMon} ${sDay}, ${s[1]} – ${eMon} ${eDay}, ${e[1]}`;
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
 * otherwise the number of roster players marked "Paying" on the Teams tab.
 */
export function resolvePayingCount(
  override: number | null,
  payingRosterCount: number,
): number {
  return override != null && override >= 0 ? override : payingRosterCount;
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
 * from the Schedules tab (the same per-team total shown there) and less the net
 * of logged expenses (paid amounts minus refunds). `expenseNet` defaults to 0
 * so existing callers stay correct, and it may be negative (refunds exceeding
 * paid expenses), which lifts the balance back up. The arithmetic is done in
 * integer cents so it stays exact and never yields a stray negative zero from
 * float drift (e.g. an exactly-funded team showing "-$0.00").
 */
export function currentBalance(
  starting: number,
  scheduledCost: number,
  expenseNet: number = 0,
): number {
  const cents =
    Math.round(starting * 100) -
    Math.round(scheduledCost * 100) -
    Math.round(expenseNet * 100);
  return cents / 100;
}

// ---- expense math ---------------------------------------------------------

/** Parse a stored amount (string|number|null) into integer cents, or 0. */
export function amountToCents(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const n =
    typeof value === "number"
      ? value
      : Number.parseFloat(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Format integer cents as USD, e.g. 123450 → "$1,234.50". */
export function formatCents(cents: number): string {
  return formatMoney(cents / 100);
}

// Per-team roll-up of logged expenses, in integer cents. `paid` is deducted
// from the balance and `refund` is credited back, so `net` (paid − refund) is
// the amount the expenses actually remove from the team budget; `notPaid` is
// tracked only and never enters `net`.
export type ExpenseTotals = {
  paidCents: number;
  refundCents: number;
  notPaidCents: number;
  /** paid − refund, the net dollars (in cents) removed from the budget. */
  netCents: number;
};

export function summarizeExpenses(
  expenses: { amount: string | number | null; status: ExpenseStatus }[],
): ExpenseTotals {
  let paidCents = 0;
  let refundCents = 0;
  let notPaidCents = 0;
  for (const e of expenses) {
    const cents = amountToCents(e.amount);
    if (e.status === "paid") paidCents += cents;
    else if (e.status === "refund") refundCents += cents;
    else notPaidCents += cents;
  }
  return {
    paidCents,
    refundCents,
    notPaidCents,
    netCents: paidCents - refundCents,
  };
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
