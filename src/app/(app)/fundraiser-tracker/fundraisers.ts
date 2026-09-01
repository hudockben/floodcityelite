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

import {
  divisionLabel,
  isDivisionSlug,
  type DivisionSlug,
} from "../teams/divisions";

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

// --- filters ---------------------------------------------------------------

/**
 * The filter bar over the log. Both are exact matches on a single value, so a
 * blank string means "not narrowing on that" rather than "match nothing".
 *
 * `fundraiser` is an id held as a string: it comes off a <select> value and a
 * query param, and comparing it as text keeps the round trip through the URL
 * from having to parse and re-print a number at every edge.
 */
export type FundraiserFilters = {
  /** A fundraisers.id, as text. */
  fundraiser: string;
  /** A division slug. */
  division: string;
  /** Inclusive YYYY-MM-DD bounds on the date raised; "" is open-ended. */
  from: string;
  to: string;
};

export const NO_FUNDRAISER_FILTERS: FundraiserFilters = {
  fundraiser: "",
  division: "",
  from: "",
  to: "",
};

/** A "YYYY-MM-DD" date, or "" for anything else (e.g. a hand-edited param). */
export function isoDateOrBlank(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/**
 * The whole filter bar as one predicate.
 *
 * Shared by the log, the CSV/Excel export route and the printed report so a
 * download holds exactly the rows that were on screen — there's only one rule.
 */
export function matchesFundraiserFilters(
  row: FundraiserEntryRow,
  filters: FundraiserFilters,
): boolean {
  if (
    filters.fundraiser !== "" &&
    String(row.fundraiser_id) !== filters.fundraiser
  ) {
    return false;
  }
  if (filters.division !== "" && row.division !== filters.division) return false;

  // raised_on is a DATE read as text, so "YYYY-MM-DD" compares correctly as a
  // string — no Date object, and so no time-zone shift at the range edges.
  const day = row.raised_on.slice(0, 10);
  if (filters.from !== "" && day < filters.from) return false;
  if (filters.to !== "" && day > filters.to) return false;

  return true;
}

/**
 * Drop a filter no entry in the log can satisfy any more.
 *
 * The two dropdowns only offer values the log actually uses. Without this,
 * removing the last Softball entry would leave "Softball" applied behind a
 * dropdown that no longer shows it — an empty table with nothing on screen
 * saying why. It's also what keeps a hand-edited URL widening the download
 * rather than silently emptying it, the way an unknown division slug does.
 *
 * The date range is left alone: it's a free range the user typed rather than a
 * value picked out of the log, so there's no such thing as a stale one. A range
 * matching nothing shows the empty row's "Clear filters", not a silent reset.
 *
 * Returns the same object when nothing is stale, so it can be memoized on.
 */
export function normalizeFundraiserFilters(
  filters: FundraiserFilters,
  entries: FundraiserEntryRow[],
): FundraiserFilters {
  const keepFundraiser =
    filters.fundraiser === "" ||
    entries.some((e) => String(e.fundraiser_id) === filters.fundraiser);
  const keepDivision =
    filters.division === "" ||
    entries.some((e) => e.division === filters.division);

  if (keepFundraiser && keepDivision) return filters;
  return {
    ...filters,
    fundraiser: keepFundraiser ? filters.fundraiser : "",
    division: keepDivision ? filters.division : "",
  };
}

/** Whether anything is narrowing the log — drives the "Clear filters" reset. */
export function isFiltering(filters: FundraiserFilters): boolean {
  return (
    filters.fundraiser !== "" ||
    filters.division !== "" ||
    filters.from !== "" ||
    filters.to !== ""
  );
}

/** The filter bar as query params, for the export and print links. */
export function fundraiserFilterParams(
  filters: FundraiserFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.fundraiser !== "") params.set("fundraiser", filters.fundraiser);
  if (filters.division !== "") params.set("division", filters.division);
  if (filters.from !== "") params.set("from", filters.from);
  if (filters.to !== "") params.set("to", filters.to);
  return params;
}

/**
 * The other half of fundraiserFilterParams: read the bar back off a request.
 * Anything unrecognized falls back to "not filtering on that", so a hand-edited
 * URL widens the download rather than silently emptying it. An id that parses
 * but names no fundraiser is caught by normalizeFundraiserFilters, which sees
 * the rows this can't.
 */
export function readFundraiserFilters(
  params: URLSearchParams,
): FundraiserFilters {
  const fundraiser = params.get("fundraiser") ?? "";
  const division = params.get("division") ?? "";
  return {
    fundraiser: /^[1-9]\d*$/.test(fundraiser) ? fundraiser : "",
    division: isDivisionSlug(division) ? division : "",
    from: isoDateOrBlank(params.get("from")),
    to: isoDateOrBlank(params.get("to")),
  };
}

/** "Jul 1, 2026 – Aug 3, 2026" / "On or after …" / "" for no range at all. */
export function describeDateRange(from: string, to: string): string {
  if (from !== "" && to !== "") return `${formatDate(from)} – ${formatDate(to)}`;
  if (from !== "") return `On or after ${formatDate(from)}`;
  if (to !== "") return `On or before ${formatDate(to)}`;
  return "";
}

/**
 * A human summary of what's being shown, for the printed report's scope line —
 * so a PDF handed to someone else says which slice of the log it holds. Takes
 * the fundraisers because the filter carries an id and a reader needs the name.
 */
export function describeFundraiserFilters(
  filters: FundraiserFilters,
  fundraisers: FundraiserOption[],
): string {
  const parts: string[] = [];
  if (filters.fundraiser !== "") {
    const named = fundraisers.find(
      (f) => String(f.id) === filters.fundraiser,
    )?.name;
    parts.push(named ?? `Fundraiser #${filters.fundraiser}`);
  }
  if (filters.division !== "") parts.push(divisionLabel(filters.division));
  const range = describeDateRange(filters.from, filters.to);
  if (range !== "") parts.push(range);
  return parts.join(" · ");
}
