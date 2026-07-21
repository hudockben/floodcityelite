// ---------------------------------------------------------------------------
// Payment Tracker — shared constants, types, and formatters
//
// Plain module (no "use server" / "use client") so it can be imported by both
// the server page/actions and the client grid. Divisions are reused from the
// Teams tab so the Payment Tracker's Division dropdown stays in sync.
// ---------------------------------------------------------------------------

import type { DivisionSlug } from "../teams/divisions";

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
