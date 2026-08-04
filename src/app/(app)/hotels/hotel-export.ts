// ---------------------------------------------------------------------------
// Hotels — the columns a download carries
//
// Kept apart from hotel-import.ts on purpose. That module reads uploaded files
// and pulls in the CSV/xlsx parser, which reaches for node:stream and so can't
// be bundled for the browser; this one is plain data over the field
// definitions, so the upload form can read the template headers from it.
//
// `ExportColumn` is a type-only import, erased at compile time — the exceljs
// writer behind it never reaches a client bundle either.
// ---------------------------------------------------------------------------

import type { ExportColumn } from "@/lib/sheet-export";
import { divisionLabel, type Division } from "../teams/divisions";
import {
  formatShortDate,
  HOTEL_FIELDS,
  hotelValue,
  type HotelRow,
} from "./hotels";

/**
 * The downloaded columns: every field the table shows, plus the division and
 * the tournament the stay is for. Built from HOTEL_FIELDS so a field added to
 * the tab shows up in the export without a second edit here.
 *
 * The tournament is written as its name — the same text an upload matches on —
 * so a downloaded file can be edited and uploaded straight back.
 */
// Built per request rather than declared once: the Division column names the
// company's own divisions, which are rows now, not a constant.
export function hotelExportColumns(
  divisions: Division[],
): ExportColumn<HotelRow>[] {
  return [
  ...HOTEL_FIELDS.map((f) => ({
    header: f.label,
    width: f.type === "notes" ? 40 : f.max > 160 ? 32 : 20,
    value: (h: HotelRow) => hotelValue(h, f.key) ?? "",
  })),
  {
    header: "Division",
    width: 22,
    value: (h) => (h.division ? divisionLabel(h.division, divisions) : ""),
  },
  { header: "Tournament", width: 26, value: (h) => h.event_name ?? "" },
  {
    header: "Tournament Date",
    width: 16,
    value: (h) => formatShortDate(h.event_date),
  },
  ];
}

/**
 * The header row of the downloadable template. The tournament *date* is left
 * off: it's read from the Schedules tab, not from the file, so offering a
 * column nothing reads would only mislead.
 */
// Only the header names are wanted, and those don't vary by division, so the
// column list is built with an empty one.
export const HOTEL_TEMPLATE_HEADERS = hotelExportColumns([])
  .filter((c) => c.header !== "Tournament Date")
  .map((c) => c.header);
