// ---------------------------------------------------------------------------
// Contact Info — the columns a download carries
//
// Kept apart from coach-import.ts on purpose. That module reads uploaded files
// and pulls in the CSV/xlsx parser, which reaches for node:stream and so can't
// be bundled for the browser; this one is plain data over the field
// definitions, so the upload form can read the template headers from it.
//
// `ExportColumn` is a type-only import, erased at compile time — the exceljs
// writer behind it never reaches a client bundle either.
// ---------------------------------------------------------------------------

import type { ExportColumn } from "@/lib/sheet-export";
import { sportLabel } from "../teams/divisions";
import { COACH_FIELDS, coachValue, type CoachRow } from "./coaches";

/**
 * The downloaded columns: the sport, then every field the table shows, in the
 * same order. Built from COACH_FIELDS so a field added to the tab shows up in
 * the export without a second edit here.
 */
export const COACH_EXPORT_COLUMNS: ExportColumn<CoachRow>[] = [
  { header: "Sport", width: 12, value: (c) => sportLabel(c.sport) },
  ...COACH_FIELDS.map((f) => ({
    header: f.label,
    width: f.type === "notes" ? 40 : f.max > 160 ? 32 : 22,
    value: (c: CoachRow) => coachValue(c, f.key) ?? "",
  })),
];

/**
 * The header row of the downloadable template — the export's columns, which are
 * exactly the ones an upload recognizes, so a downloaded file can be edited and
 * uploaded straight back.
 */
export const COACH_TEMPLATE_HEADERS = COACH_EXPORT_COLUMNS.map((c) => c.header);
