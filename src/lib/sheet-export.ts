// ---------------------------------------------------------------------------
// Spreadsheet export — handing a table back as CSV or Excel
//
// The download half of the tabs that offer one (Roster Submissions responses,
// Contact Info coaches, Hotels stays). A tab declares its columns once and gets
// both formats plus the response headers from here, so the two files always
// carry the same columns in the same order.
//
// `exceljs` is loaded with a dynamic import, the way the bulk uploads do, so it
// stays out of the bundle until a download is actually asked for.
// ---------------------------------------------------------------------------

/** One column of an export: its heading, its Excel width, and how to read it. */
export type ExportColumn<T> = {
  header: string;
  /** Column width in characters, for the Excel sheet. */
  width: number;
  value: (row: T) => string;
  /**
   * Write this column as numbers in the Excel sheet rather than text, so a
   * column of money can be summed in the spreadsheet instead of sitting there
   * as a list of strings SUM skips over.
   *
   * `value` still returns plain digits ("975.00", no currency symbol or
   * thousands separator) — that's what the CSV carries and what's parsed here.
   * Anything that isn't a finite number, an empty cell included, is left as the
   * text it came in as.
   */
  numeric?: boolean;
};

/** One cell's value for the Excel sheet: a number where a column asks for one. */
function cellValue<T>(column: ExportColumn<T>, row: T): string | number {
  const text = column.value(row);
  if (!column.numeric || text.trim() === "") return text;
  const n = Number(text);
  return Number.isFinite(n) ? n : text;
}

/** The two formats the download links offer. */
export type ExportFormat = "csv" | "xlsx";

export function resolveFormat(raw: string | null): ExportFormat {
  return raw === "xlsx" ? "xlsx" : "csv";
}

// --- CSV -------------------------------------------------------------------

/**
 * Quote a CSV field when it needs it.
 *
 * A leading =, +, - or @ is prefixed with a single quote first: spreadsheets
 * treat those as the start of a formula, and this data is typed by people
 * (a note, a coach's title) rather than authored by us. The quote is Excel's
 * own "this is text" marker and is not shown in the cell.
 */
export function csvField(value: string): string {
  const v = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv<T>(columns: ExportColumn<T>[], rows: T[]): string {
  const lines = [columns.map((c) => csvField(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}

// --- Excel -----------------------------------------------------------------

export async function toXlsx<T>(
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[],
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;

  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.header,
    width: c.width,
    // Two decimals and thousands separators on the numeric columns, so an
    // amount reads as money rather than as a bare 975.
    style: c.numeric ? { numFmt: "#,##0.00" } : {},
  }));

  for (const row of rows) {
    // Written as plain strings unless a column asked for numbers: nothing here
    // is ever a formula, whatever someone typed into a notes box.
    sheet.addRow(columns.map((c) => cellValue(c, row)));
  }

  const header = sheet.getRow(1);
  header.font = { bold: true };
  // The headings are text even above a numeric column; the column style would
  // otherwise try to format them.
  header.numFmt = "General";
  // Freeze the header and turn on filter arrows — the two things anyone does
  // first with an export this wide.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };

  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

// --- response --------------------------------------------------------------

/** Deterministic YYYY-MM-DD (UTC), for the filename. */
export function todayStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Build the download response for either format.
 *
 * `baseName` gets today's date and the extension appended, and is stripped of
 * anything that doesn't belong in a filename so a value derived from user data
 * can't break out of the Content-Disposition header.
 *
 * Every signed-in user hits the same URL for their own company's rows, and
 * these files are personal data. Without no-store a shared cache keyed on the
 * URL could hand one company's export to the next person who asks — Next's Vary
 * header covers its router headers, not the session cookie — and the browser
 * could re-serve a stale file after the list changes.
 */
export async function sheetResponse<T>({
  format,
  baseName,
  sheetName,
  columns,
  rows,
}: {
  format: ExportFormat;
  baseName: string;
  sheetName: string;
  columns: ExportColumn<T>[];
  rows: T[];
}): Promise<Response> {
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const filename = `${safeBase || "export"}-${todayStamp()}.${format}`;
  const headers = {
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store, private",
  };

  if (format === "xlsx") {
    return new Response(await toXlsx(sheetName, columns, rows), {
      headers: {
        ...headers,
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  }

  // A UTF-8 BOM so Excel reads accented names correctly instead of mojibake.
  return new Response(`﻿${toCsv(columns, rows)}`, {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
  });
}
