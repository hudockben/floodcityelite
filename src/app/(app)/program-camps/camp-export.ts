// ---------------------------------------------------------------------------
// Program/Camps — the columns a download carries
//
// Kept apart from camps.ts so the client grid never pulls this in: the
// `ExportColumn` behind it is written by exceljs, which can't be bundled for
// the browser. (The import here is type-only, so it's erased at compile time.)
//
// A camp shows three tables — its roster, its payments, and its expenses — and
// each downloads on its own, with the columns the tab shows in the same order.
// Money goes out as plain digits ("150.00", no $ or commas) on `numeric`
// columns so it lands in Excel as a number the spreadsheet can total.
// ---------------------------------------------------------------------------

import type { ExportColumn } from "@/lib/sheet-export";
import {
  amountToCents,
  expenseStatusLabel,
  formatDate,
  paymentTypeLabel,
  type CampExpenseRow,
  type CampPaymentRow,
  type CampPlayerRow,
} from "./camps";

/** The three tables a camp can be downloaded as. */
export const CAMP_SHEETS = ["roster", "payments", "expenses"] as const;
export type CampSheet = (typeof CAMP_SHEETS)[number];

export function isCampSheet(value: string | null): value is CampSheet {
  return CAMP_SHEETS.includes((value ?? "") as CampSheet);
}

/** A roster row plus the Paid column the tab shows beside it. */
export type CampRosterExportRow = CampPlayerRow & { paidCents: number };

/** A payment plus the running total the ledger shows beside it. */
export type CampPaymentExportRow = CampPaymentRow & { runningCents: number };

/** Cents as the plain digits a numeric column is parsed from. */
function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

export const CAMP_ROSTER_COLUMNS: ExportColumn<CampRosterExportRow>[] = [
  { header: "Player Name", width: 24, value: (p) => p.player_name },
  { header: "Parent Name", width: 24, value: (p) => p.parent_name ?? "" },
  { header: "Parent Contact", width: 26, value: (p) => p.parent_contact ?? "" },
  { header: "Location", width: 24, value: (p) => p.location ?? "" },
  {
    header: "Paid",
    width: 14,
    numeric: true,
    value: (p) => money(p.paidCents),
  },
];

export const CAMP_PAYMENT_COLUMNS: ExportColumn<CampPaymentExportRow>[] = [
  { header: "Date", width: 14, value: (p) => formatDate(p.paid_on) },
  { header: "Player Name", width: 24, value: (p) => p.player_name },
  {
    header: "Payment Type",
    width: 14,
    value: (p) => paymentTypeLabel(p.payment_type),
  },
  // A check number is an identifier, not a quantity — left as text so a leading
  // zero survives and nobody's check 0042 becomes 42.
  { header: "Check #", width: 12, value: (p) => p.check_number ?? "" },
  {
    header: "Amount",
    width: 14,
    numeric: true,
    value: (p) => money(amountToCents(p.amount)),
  },
  {
    header: "Total",
    width: 14,
    numeric: true,
    value: (p) => money(p.runningCents),
  },
];

export const CAMP_EXPENSE_COLUMNS: ExportColumn<CampExpenseRow>[] = [
  { header: "Date", width: 14, value: (e) => formatDate(e.expense_date) },
  { header: "Expense", width: 32, value: (e) => e.vendor ?? "" },
  {
    header: "Total Cost",
    width: 14,
    numeric: true,
    value: (e) => money(amountToCents(e.amount)),
  },
  { header: "Status", width: 14, value: (e) => expenseStatusLabel(e.status) },
];

/** What each sheet is called, in the workbook and in the filename. */
export const CAMP_SHEET_NAMES: Record<CampSheet, string> = {
  roster: "Roster",
  payments: "Payments",
  expenses: "Expenses",
};
