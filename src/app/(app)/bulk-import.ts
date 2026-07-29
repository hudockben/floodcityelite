// ---------------------------------------------------------------------------
// Bulk import — the result a tab's upload action hands back
//
// Plain module (no "use server" / "use client") so the server actions and the
// client summary component share one shape. Every tab that imports a
// spreadsheet reports the same things: what went in, what was skipped and why,
// which columns were ignored, and any per-row warnings.
//
// The Teams tab has its own richer result (it also routes rows to teams), so it
// keeps its own type; this is the shape for the flat, single-list tabs.
// ---------------------------------------------------------------------------

/** A value from the file that couldn't be matched to something we have. */
export type UnmatchedValue = { name: string; rows: number };

export type BulkImportResult = {
  fileName: string;
  /** Rows written. */
  added: number;
  /** Rows skipped because the record is already on the list (or repeats in the file). */
  duplicates: number;
  /** Rows skipped because the one required column was blank. */
  missingRequired: number;
  /** Data rows found in the file (blank rows don't count). */
  totalRows: number;
  /** Names of what was added / skipped, capped — the true counts are above. */
  addedNames: string[];
  duplicateNames: string[];
  /** Headers we don't track, echoed back so a mis-spelled one is noticeable. */
  ignoredColumns: string[];
  /** Per-row notes: a value shortened to fit, a rate that wouldn't parse. */
  warnings: string[];
  /**
   * Optional group of values from an optional lookup column that matched
   * nothing — e.g. a tournament name that isn't on the Schedules tab. The rows
   * still import; they just come in without that link.
   */
  unmatched?: { label: string; note: string; items: UnmatchedValue[] };
};

export type BulkImportState = {
  ok?: boolean;
  error?: string;
  result?: BulkImportResult;
};

/** Upload size cap, matching the Teams tab's roster import. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

/** New records accepted per upload. */
export const MAX_IMPORT_ROWS = 500;

/** How many warnings an import collects before it stops recording them. */
export const MAX_WARNINGS = 25;

/** How many names the result lists before it just reports the count. */
export const MAX_ADDED_NAMES = 100;
export const MAX_DUPLICATE_NAMES = 50;
