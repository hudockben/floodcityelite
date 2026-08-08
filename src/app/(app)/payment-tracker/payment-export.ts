// ---------------------------------------------------------------------------
// Payment Tracker — the columns a download carries
//
// Kept apart from payments.ts so the client ledger never pulls this in: the
// `ExportColumn` behind it is written by exceljs, which can't be bundled for
// the browser. (The import here is type-only, so it's erased at compile time.)
//
// The columns mirror the on-screen ledger, Total column included, so a
// downloaded file reads exactly like the table it came from.
// ---------------------------------------------------------------------------

import type { ExportColumn } from "@/lib/sheet-export";
import { divisionLabel } from "../teams/divisions";
import {
  amountToCents,
  formatDate,
  ledgerRows,
  paymentTypeLabel,
  type PaymentRow,
} from "./payments";

/** A payment plus the running total the ledger shows beside it. */
export type PaymentExportRow = PaymentRow & { running_total: string };

/**
 * The rows a download carries, in the ledger's own order — newest first, each
 * with the total received through it, so the *first* Total cell is the figure
 * for the whole file. Ordering and accumulation both come from `ledgerRows`, so
 * a spreadsheet can't come out reading differently from the tab it was
 * downloaded off.
 *
 * The total is written as a plain number ("4925.00") rather than "$4,925.00" so
 * Excel can total the column itself.
 */
export function withRunningTotals(rows: PaymentRow[]): PaymentExportRow[] {
  return ledgerRows(rows).map(({ payment, runningTotalCents }) => ({
    ...payment,
    running_total: (runningTotalCents / 100).toFixed(2),
  }));
}

export const PAYMENT_EXPORT_COLUMNS: ExportColumn<PaymentExportRow>[] = [
  { header: "Date", width: 14, value: (p) => formatDate(p.paid_on) },
  { header: "Division", width: 22, value: (p) => divisionLabel(p.division) },
  { header: "Team Name", width: 32, value: (p) => p.team_name },
  { header: "Player Name", width: 24, value: (p) => p.player_name },
  {
    header: "Payment Type",
    width: 14,
    value: (p) => paymentTypeLabel(p.payment_type),
  },
  // A check number is an identifier, not a quantity — left as text so a leading
  // zero survives and nobody's check 0042 becomes 42.
  { header: "Check #", width: 12, value: (p) => p.check_number ?? "" },
  // The two money columns go out unformatted and land as real numbers, so the
  // Amount column can be summed and sorted in the spreadsheet.
  {
    header: "Amount",
    width: 14,
    numeric: true,
    value: (p) => (amountToCents(p.amount) / 100).toFixed(2),
  },
  { header: "Total", width: 14, numeric: true, value: (p) => p.running_total },
];
