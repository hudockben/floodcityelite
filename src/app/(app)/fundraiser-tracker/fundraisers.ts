// ---------------------------------------------------------------------------
// Fundraiser Tracker — shared constants, types, and formatters
//
// Plain module (no "use server" / "use client") so it can be imported by both
// the server page/actions and the client grid. Divisions are reused from the
// Teams tab so the Division dropdown stays in sync with the rest of the app.
//
// Two concepts power this tab:
//   • a *fundraiser* — a campaign/event the user creates (e.g. "Spring Car
//     Wash"), optionally with a goal and a date; and
//   • a fundraiser *entry* — how much a specific player raised for a specific
//     fundraiser. Entries accumulate into per-fundraiser and grand totals,
//     mirroring the Payment Tracker's Total column.
// ---------------------------------------------------------------------------

import type { DivisionSlug } from "../teams/divisions";

// Dropdown option shapes for the cascading Division → Team → Player selects.
export type TeamOption = { id: number; name: string; division: DivisionSlug };
export type PlayerOption = { id: number; team_id: number; player_name: string };

// A fundraiser (campaign/event) as offered in the dropdown and shown as a card.
// `goal` arrives from Postgres NUMERIC as a string (e.g. "2000.00"); both
// `goal` and `event_date` are optional.
export type FundraiserOption = {
  id: number;
  name: string;
  goal: string | null;
  event_date: string | null; // YYYY-MM-DD
};

// A saved fundraiser entry joined with its fundraiser, team, division, and —
// for player-based fundraisers — its player. A team-based entry has
// player_id/player_name NULL. `amount` arrives from Postgres NUMERIC as a
// string (e.g. "150.00").
export type FundraiserEntryRow = {
  id: number;
  raised_on: string; // YYYY-MM-DD
  amount: string;
  fundraiser_id: number;
  fundraiser_name: string;
  team_id: number;
  team_name: string;
  division: DivisionSlug;
  player_id: number | null;
  player_name: string | null;
};

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format a "YYYY-MM-DD" date without going through a Date object, which would
// otherwise shift the day across time zones.
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const monthIndex = Number(m) - 1;
  if (!y || !MONTHS[monthIndex] || !d) return iso;
  return `${MONTHS[monthIndex]} ${Number(d)}, ${y}`;
}

// Format a numeric amount (string or number) as US currency.
export function formatMoney(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

// --- totals ----------------------------------------------------------------

/** "150.00" -> 15000. Rounds so a stray fraction can't leak into the total. */
export function amountToCents(amount: string | number): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** What a set of entries adds up to, in cents. */
export function sumEntryCents(entries: FundraiserEntryRow[]): number {
  return entries.reduce((cents, e) => cents + amountToCents(e.amount), 0);
}

/** An entry with the tab's Total column beside it, in cents. */
export type LedgerRow = { entry: FundraiserEntryRow; runningTotalCents: number };

/**
 * The log as every surface shows it: oldest entry first, each row carrying the
 * total raised *through* that entry, so the last row's Total is the grand
 * total for the whole file.
 *
 * Takes the entries in the order listFundraiserEntries returns them (oldest
 * first) — the only order a running total can accumulate in, since the total as
 * of an entry can't include money logged after it. The tab, the CSV/Excel
 * download and the printed report all come through here, so none of the three
 * can put the same rows in a different order or total them a different way.
 *
 * Summed in cents rather than dollars: a long log of floats drifts, and a
 * report whose Total column is a penny off the amounts above it is a report
 * somebody has to go and reconcile by hand.
 */
export function ledgerRows(entries: FundraiserEntryRow[]): LedgerRow[] {
  let cents = 0;
  return entries.map((entry) => {
    cents += amountToCents(entry.amount);
    return { entry, runningTotalCents: cents };
  });
}

/**
 * Each fundraiser's total raised, in cents, keyed by fundraiser id. Drives the
 * progress on the fundraiser cards and the summary strip on the report.
 */
export function raisedByFundraiser(
  entries: FundraiserEntryRow[],
): Map<number, number> {
  const totals = new Map<number, number>();
  for (const e of entries) {
    totals.set(
      e.fundraiser_id,
      (totals.get(e.fundraiser_id) ?? 0) + amountToCents(e.amount),
    );
  }
  return totals;
}

/** The label a whole-team entry carries where a player name would go. */
export const TEAM_LEVEL_LABEL = "Whole team";
