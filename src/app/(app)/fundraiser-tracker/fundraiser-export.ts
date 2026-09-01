// ---------------------------------------------------------------------------
// Fundraiser Tracker — the columns a download carries
//
// Kept apart from fundraisers.ts so the client grid never pulls this in: the
// `ExportColumn` behind it is written by exceljs, which can't be bundled for
// the browser. (The import here is type-only, so it's erased at compile time.)
//
// The columns mirror the on-screen log, Total column included, so a downloaded
// file reads exactly like the table it came from.
// ---------------------------------------------------------------------------

import type { ExportColumn } from "@/lib/sheet-export";
import { divisionLabel } from "../teams/divisions";
import {
  TEAM_LEVEL_LABEL,
  amountToCents,
  formatDate,
  ledgerRows,
  type FundraiserEntryRow,
} from "./fundraisers";

/** An entry plus the running total the log shows beside it. */
export type FundraiserExportRow = FundraiserEntryRow & { running_total: string };

/**
 * The rows a download carries, in the log's own order — oldest first, each with
 * the total raised through it, so the *last* Total cell is the figure for the
 * whole file. Ordering and accumulation both come from `ledgerRows`, so a
 * spreadsheet can't come out reading differently from the tab it was downloaded
 * off.
 *
 * The total is written as a plain number ("3547.00") rather than "$3,547.00" so
 * Excel can total the column itself.
 */
export function withRunningTotals(
  entries: FundraiserEntryRow[],
): FundraiserExportRow[] {
  return ledgerRows(entries).map(({ entry, runningTotalCents }) => ({
    ...entry,
    running_total: (runningTotalCents / 100).toFixed(2),
  }));
}

export const FUNDRAISER_EXPORT_COLUMNS: ExportColumn<FundraiserExportRow>[] = [
  { header: "Date", width: 14, value: (e) => formatDate(e.raised_on) },
  { header: "Division", width: 22, value: (e) => divisionLabel(e.division) },
  { header: "Team Name", width: 32, value: (e) => e.team_name },
  // A whole-team entry has no player; it says so rather than leaving a blank
  // cell somebody has to guess at.
  {
    header: "Player Name",
    width: 24,
    value: (e) => e.player_name ?? TEAM_LEVEL_LABEL,
  },
  { header: "Fundraiser", width: 26, value: (e) => e.fundraiser_name },
  // The two money columns go out unformatted and land as real numbers, so the
  // Amount column can be summed and sorted in the spreadsheet.
  {
    header: "Amount",
    width: 14,
    numeric: true,
    value: (e) => (amountToCents(e.amount) / 100).toFixed(2),
  },
  { header: "Total", width: 14, numeric: true, value: (e) => e.running_total },
];
