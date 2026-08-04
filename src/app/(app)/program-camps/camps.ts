// ---------------------------------------------------------------------------
// Program/Camps — shared constants, types, and formatters
//
// Plain module (no "use server" / "use client") so it can be imported by both
// the server page/actions and the client grid.
//
// Four concepts power this tab:
//   • a *camp* — a program/clinic/camp the user creates (e.g. "Winter Hitting
//     Clinic"), optionally with a location and a date;
//   • a *camp player* — a registration on a camp's roster, with the player's
//     name plus the parent's name, the parent's contact info, and a location;
//   • a *camp payment* — a payment logged against a camp player. Payments
//     accumulate into per-player and grand totals, mirroring the Payment
//     Tracker's Total column;
//   • a *camp expense* — what running the camp costs (umpire fees for a
//     showcase, field rental, gear). Expenses come off what the camp collected,
//     so the tab can report the camp's net.
//
// Payment-type constants are reused from the Payment Tracker so Check/Cash stay
// in sync across both tabs, and the expense statuses and cent math are reused
// from the Budgets tab so an expense means the same thing wherever it's logged.
// ---------------------------------------------------------------------------

import {
  PAYMENT_TYPES,
  isPaymentType,
  paymentTypeLabel,
  type PaymentType,
} from "../payment-tracker/payments";
import {
  DEFAULT_EXPENSE_STATUS,
  EXPENSE_STATUSES,
  amountToCents,
  formatCents,
  isExpenseStatus,
  summarizeExpenses,
  type ExpenseStatus,
} from "../budgets/budget";

export { PAYMENT_TYPES, isPaymentType, paymentTypeLabel };
export type { PaymentType };

export {
  DEFAULT_EXPENSE_STATUS,
  EXPENSE_STATUSES,
  amountToCents,
  formatCents,
  isExpenseStatus,
  summarizeExpenses,
};
export type { ExpenseStatus };

// A camp (program/clinic/event) as shown in the selector cards and offered in
// the payment player dropdown. `location` and `event_date` are optional.
export type CampOption = {
  id: number;
  name: string;
  location: string | null;
  event_date: string | null; // YYYY-MM-DD
};

// A camp player (roster row) with the details the Program/Camps tab collects.
export type CampPlayerRow = {
  id: number;
  camp_id: number;
  player_name: string;
  parent_name: string | null;
  parent_contact: string | null;
  location: string | null;
};

// A saved camp payment joined with its player and camp. `amount` arrives from
// Postgres NUMERIC as a string (e.g. "150.00").
export type CampPaymentRow = {
  id: number;
  paid_on: string; // YYYY-MM-DD
  payment_type: PaymentType;
  check_number: string | null;
  amount: string;
  camp_player_id: number;
  camp_id: number;
  player_name: string;
};

// An expense logged against a camp — what the camp cost to put on (umpire fees
// for a showcase, field rental, gear). The status decides how it lands on the
// camp's bottom line, matching the Budgets tab:
//   • paid     → deducted from what the camp collected
//   • refund   → credited back
//   • not_paid → tracked only; nothing comes off until it's marked paid
// `amount` arrives from Postgres NUMERIC as a string (e.g. "250.00").
export type CampExpenseRow = {
  id: number;
  camp_id: number;
  expense_date: string | null;
  vendor: string | null;
  amount: string | null;
  status: ExpenseStatus;
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
