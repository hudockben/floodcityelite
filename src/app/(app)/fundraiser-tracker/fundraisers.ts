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

// A saved fundraiser entry joined with its fundraiser, player, team, and
// division. `amount` arrives from Postgres NUMERIC as a string (e.g. "150.00").
export type FundraiserEntryRow = {
  id: number;
  raised_on: string; // YYYY-MM-DD
  amount: string;
  fundraiser_id: number;
  fundraiser_name: string;
  player_id: number;
  player_name: string;
  team_id: number;
  team_name: string;
  division: DivisionSlug;
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
