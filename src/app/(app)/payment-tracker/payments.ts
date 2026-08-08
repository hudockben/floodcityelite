// ---------------------------------------------------------------------------
// Payment Tracker — shared constants, types, and formatters
//
// Plain module (no "use server" / "use client") so it can be imported by both
// the server page/actions and the client grid. Divisions are reused from the
// Teams tab so the Payment Tracker's Division dropdown stays in sync.
// ---------------------------------------------------------------------------

import {
  divisionLabel,
  isDivisionSlug,
  type DivisionSlug,
} from "../teams/divisions";

export type PaymentType = "check" | "cash";

// The Payment Type dropdown, in display order. Values are what we store in the
// DB; labels are what the user sees.
export const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
];

export function isPaymentType(value: string): value is PaymentType {
  return value === "check" || value === "cash";
}

export function paymentTypeLabel(value: string): string {
  return PAYMENT_TYPES.find((t) => t.value === value)?.label ?? value;
}

// Dropdown option shapes for the cascading Division → Team → Player selects.
export type TeamOption = { id: number; name: string; division: DivisionSlug };
export type PlayerOption = { id: number; team_id: number; player_name: string };

// A saved payment joined with its player, team, and division. `amount` arrives
// from Postgres NUMERIC as a string (e.g. "150.00").
export type PaymentRow = {
  id: number;
  paid_on: string; // YYYY-MM-DD
  payment_type: PaymentType;
  check_number: string | null;
  amount: string;
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
export function formatDate(iso: string): string {
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

// ---------------------------------------------------------------------------
// Filters
//
// The filter bar above the ledger, the spreadsheet download, and the printed
// report all narrow the same list. They share the definitions below so they
// can't drift: the bar holds a `PaymentFilters`, turns it into query params for
// the two download links, and the export route reads it straight back out.
// ---------------------------------------------------------------------------

/** The filter bar as one value. Every field is "" when it isn't narrowing. */
export type PaymentFilters = {
  /** The search box — matches anything on the row (see paymentSearchText). */
  query: string;
  /** A division slug. */
  division: string;
  /** A PaymentType. */
  paymentType: string;
  /** Matched as a substring of the check number, so a partial number works. */
  checkNumber: string;
  /** Inclusive YYYY-MM-DD bounds on the payment date; "" is open-ended. */
  from: string;
  to: string;
};

export const NO_PAYMENT_FILTERS: PaymentFilters = {
  query: "",
  division: "",
  paymentType: "",
  checkNumber: "",
  from: "",
  to: "",
};

/** A "YYYY-MM-DD" date, or "" for anything else (e.g. a hand-edited param). */
export function isoDateOrBlank(value: string | null | undefined): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/**
 * Everything on a payment, lowercased, so one box searches the player, the
 * team, the division, the check number, the amount, or the date — whatever
 * comes to mind first. Both the raw and formatted amount/date are included so
 * "1950", "1,950", "2026-08-03" and "Aug 3" all find the same row.
 */
export function paymentSearchText(row: PaymentRow): string {
  return [
    row.player_name,
    row.team_name,
    divisionLabel(row.division),
    paymentTypeLabel(row.payment_type),
    row.check_number ?? "",
    row.amount,
    formatMoney(row.amount),
    row.paid_on,
    formatDate(row.paid_on),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * The whole filter bar as one predicate.
 *
 * Shared by the ledger, the CSV/Excel export route and the printed report so a
 * download holds exactly the rows that were on screen — there's only one rule.
 * `searchText` lets the ledger pass its memoized haystack instead of rebuilding
 * it per keystroke; the routes just let it be computed.
 */
export function matchesPaymentFilters(
  row: PaymentRow,
  filters: PaymentFilters,
  searchText?: string,
): boolean {
  if (filters.division !== "" && row.division !== filters.division) return false;
  if (filters.paymentType !== "" && row.payment_type !== filters.paymentType) {
    return false;
  }

  const check = filters.checkNumber.trim().toLowerCase();
  if (check !== "" && !(row.check_number ?? "").toLowerCase().includes(check)) {
    return false;
  }

  // paid_on is a DATE read as text, so "YYYY-MM-DD" compares correctly as a
  // string — no Date object, and so no time-zone shift at the range edges.
  const day = row.paid_on.slice(0, 10);
  if (filters.from !== "" && day < filters.from) return false;
  if (filters.to !== "" && day > filters.to) return false;

  const q = filters.query.trim().toLowerCase();
  if (q === "") return true;
  return (searchText ?? paymentSearchText(row)).includes(q);
}

/**
 * Drop a filter no payment in the ledger can satisfy any more.
 *
 * The Division and Type dropdowns only offer values the ledger actually uses,
 * and the Check # box only appears when some payment carries one. Without this,
 * removing the last cash payment would leave "Cash" applied behind a dropdown
 * that no longer shows it — an empty table with nothing on screen saying why.
 *
 * Returns the same object when nothing is stale, so it can be memoized on.
 */
export function normalizePaymentFilters(
  filters: PaymentFilters,
  payments: PaymentRow[],
): PaymentFilters {
  const keepDivision =
    filters.division === "" ||
    payments.some((p) => p.division === filters.division);
  const keepType =
    filters.paymentType === "" ||
    payments.some((p) => p.payment_type === filters.paymentType);
  const keepCheck =
    filters.checkNumber.trim() === "" ||
    payments.some((p) => (p.check_number ?? "") !== "");

  if (keepDivision && keepType && keepCheck) return filters;
  return {
    ...filters,
    division: keepDivision ? filters.division : "",
    paymentType: keepType ? filters.paymentType : "",
    checkNumber: keepCheck ? filters.checkNumber : "",
  };
}

/** Whether anything is narrowing the list — drives the "Clear filters" reset. */
export function isFiltering(filters: PaymentFilters): boolean {
  return (
    filters.query.trim() !== "" ||
    filters.division !== "" ||
    filters.paymentType !== "" ||
    filters.checkNumber.trim() !== "" ||
    filters.from !== "" ||
    filters.to !== ""
  );
}

/** The filter bar as query params, for the export and print links. */
export function paymentFilterParams(filters: PaymentFilters): URLSearchParams {
  const params = new URLSearchParams();
  const query = filters.query.trim();
  const check = filters.checkNumber.trim();
  if (query !== "") params.set("q", query);
  if (filters.division !== "") params.set("division", filters.division);
  if (filters.paymentType !== "") params.set("type", filters.paymentType);
  if (check !== "") params.set("check", check);
  if (filters.from !== "") params.set("from", filters.from);
  if (filters.to !== "") params.set("to", filters.to);
  return params;
}

/**
 * The other half of paymentFilterParams: read the bar back off a request.
 * Anything unrecognized falls back to "not filtering on that", so a hand-edited
 * URL widens the download rather than silently emptying it.
 */
export function readPaymentFilters(params: URLSearchParams): PaymentFilters {
  const division = params.get("division") ?? "";
  const type = params.get("type") ?? "";
  return {
    query: params.get("q") ?? "",
    division: isDivisionSlug(division) ? division : "",
    paymentType: isPaymentType(type) ? type : "",
    checkNumber: params.get("check") ?? "",
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
 * so a PDF handed to someone else says which slice of the ledger it holds.
 */
export function describePaymentFilters(filters: PaymentFilters): string {
  const parts: string[] = [];
  if (filters.division !== "") parts.push(divisionLabel(filters.division));
  if (filters.paymentType !== "") {
    parts.push(`${paymentTypeLabel(filters.paymentType)} only`);
  }
  const range = describeDateRange(filters.from, filters.to);
  if (range !== "") parts.push(range);
  const check = filters.checkNumber.trim();
  if (check !== "") parts.push(`Check # ${check}`);
  const query = filters.query.trim();
  if (query !== "") parts.push(`Matching “${query}”`);
  return parts.join(" · ");
}

/** Sum a list of payments, in cents, so the total doesn't drift on floats. */
export function sumPaymentCents(rows: PaymentRow[]): number {
  return rows.reduce((cents, row) => cents + amountToCents(row.amount), 0);
}

/** A payment with the ledger's Total column beside it, in cents. */
export type LedgerRow = { payment: PaymentRow; runningTotalCents: number };

/**
 * The ledger as every surface shows it: newest payment first, each row carrying
 * the total received *through* that payment.
 *
 * The two directions are deliberate, and independent of each other. A running
 * total can only ever accumulate oldest → newest — the total as of a payment
 * can't include money that arrived after it — so it's summed in the order the
 * rows come out of the database. The rows are only turned around afterwards,
 * because the payment you just logged, or came back to check, is the newest
 * one: it belongs at the top, where it carries the grand total, with the ledger
 * running back in time beneath it. The last row is the oldest payment, showing
 * nothing but its own amount.
 *
 * Takes the ledger in the order listPayments returns it (oldest first). The
 * tab, the CSV/Excel download and the printed report all come through here, so
 * none of the three can put the same rows in a different order or total them a
 * different way.
 */
export function ledgerRows(payments: PaymentRow[]): LedgerRow[] {
  let cents = 0;
  const rows = payments.map((payment) => {
    cents += amountToCents(payment.amount);
    return { payment, runningTotalCents: cents };
  });
  return rows.reverse();
}

/** "975.00" -> 97500. Rounds so a stray fraction can't leak into the total. */
export function amountToCents(amount: string | number): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
