// ---------------------------------------------------------------------------
// Spreadsheet import — reading an uploaded CSV / Excel file
//
// The file-reading half of a bulk upload, shared by every tab that offers one
// (Teams rosters, Contact Info coaches, Hotels stays). It turns an uploaded
// file into rows of strings and matches whatever headers it carries onto a
// tab's own fields; deciding what those fields mean stays with the tab.
//
// Server-only in practice: `exceljs` is pulled in with a dynamic import so it
// never reaches a client bundle and is loaded only when an .xlsx actually
// arrives. There is deliberately no "use server" here — these are plain
// helpers called by the tabs' server actions.
// ---------------------------------------------------------------------------

/** A user-facing problem with the uploaded file (surfaced verbatim in the UI). */
export class SheetImportError extends Error {}

// Safety bounds for parsing an uploaded workbook. The size cap on the action is
// on the *compressed* upload; a crafted .xlsx can decompress far larger or
// declare up to 16384 columns, so we also bound what we materialize here. These
// are well above any real club file (a few hundred rows and ~20 columns).
const MAX_PARSE_ROWS = 5000;
const MAX_PARSE_COLS = 100;

// --- header matching -------------------------------------------------------

/**
 * Normalize a header cell to a comparison key: lowercase, alphanumerics only.
 * So "Coach_Email", "coach email" and "COACHEMAIL" all collapse together.
 */
export function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Trim and collapse runs of whitespace to single spaces. */
export function collapseWs(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/**
 * A match key for names that should compare equal despite spacing and case —
 * used both to dedupe imported rows and to match a row's text against an
 * existing record.
 */
export function matchKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export type ColumnPlan<F extends string> = {
  /**
   * Header indexes per field, in alias priority order. Several columns can map
   * to one field (a file with both "Cell" and "Phone"); the row mapper takes
   * the first non-empty one, so the earlier alias wins.
   */
  cols: Partial<Record<F, number[]>>;
  /** Every header index claimed by some field. */
  matched: Set<number>;
};

/**
 * Match a header row against a field → accepted-spellings map.
 *
 * `claimed` marks indexes already spoken for by a column the caller handles
 * itself (a routing column like "team" or "tournament"), so no field steals
 * them. A header index is claimed by at most one field: the first field, in
 * `aliases` key order, that lists a spelling matching it.
 */
export function planColumns<F extends string>(
  header: string[],
  aliases: Record<F, string[]>,
  claimed: Iterable<number> = [],
): ColumnPlan<F> {
  const keys = header.map(normKey);
  const matched = new Set<number>(claimed);
  const cols: Partial<Record<F, number[]>> = {};

  for (const field of Object.keys(aliases) as F[]) {
    const found: number[] = [];
    for (const alias of aliases[field]) {
      const i = keys.indexOf(alias);
      if (i !== -1 && !matched.has(i) && !found.includes(i)) found.push(i);
    }
    if (found.length > 0) {
      cols[field] = found;
      found.forEach((i) => matched.add(i));
    }
  }

  return { cols, matched };
}

/** The first index whose header matches any of `aliases`, or undefined. */
export function findColumn(header: string[], aliases: string[]): number | undefined {
  const keys = header.map(normKey);
  for (const alias of aliases) {
    const i = keys.indexOf(alias);
    if (i !== -1) return i;
  }
  return undefined;
}

/**
 * Headers the import didn't use, for the "ignored these columns" note. A
 * recognized spelling that lost out only because an earlier column already
 * claimed its field (two "Email" columns) isn't reported — it's tracked, just
 * not twice.
 */
export function unusedHeaders(
  header: string[],
  matched: Set<number>,
  recognized: Set<string>,
): string[] {
  const out: string[] = [];
  header.forEach((h, i) => {
    const trimmed = h.trim();
    if (trimmed === "" || matched.has(i)) return;
    if (recognized.has(normKey(h))) return;
    if (!out.includes(trimmed)) out.push(trimmed);
  });
  return out;
}

/** Every spelling in an alias map, flattened — for `unusedHeaders`. */
export function recognizedKeys(...aliasGroups: (string[] | Record<string, string[]>)[]): Set<string> {
  const out = new Set<string>();
  for (const group of aliasGroups) {
    const lists = Array.isArray(group) ? [group] : Object.values(group);
    for (const list of lists) for (const alias of list) out.add(alias);
  }
  return out;
}

// --- row helpers -----------------------------------------------------------

/** Whether every cell in the row is blank (a spacer row in a hand-made sheet). */
export function isRowEmpty(row: string[]): boolean {
  return row.every((c) => String(c ?? "").trim() === "");
}

/**
 * Reader over one row: `cell(i)` is a trimmed cell, `first(idxs)` is the first
 * non-empty of several columns mapped to the same field.
 */
export function rowReader(row: string[]) {
  const cell = (i?: number): string =>
    i == null || i < 0 ? "" : String(row[i] ?? "").trim();
  const first = (idxs?: number[]): string => {
    if (!idxs) return "";
    for (const i of idxs) {
      const v = cell(i);
      if (v) return v;
    }
    return "";
  };
  return { cell, first };
}

// --- file parsing ----------------------------------------------------------

/**
 * A small, dependency-free CSV reader. Handles quoted fields, escaped quotes
 * (""), embedded commas/newlines, and CRLF/CR/LF line endings.
 */
export function parseCsv(input: string, delimiter = ","): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      // A quote only opens a quoted field at the very start of a field. A quote
      // in the middle of an unquoted field (e.g. a height like 5'11") is kept as
      // a literal character rather than swallowing the rest of the row.
      inQuotes = true;
    } else if (c === delimiter) {
      pushField();
    } else if (c === "\n") {
      pushRow();
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else {
      field += c;
    }
  }
  // Flush a trailing field/row that wasn't terminated by a newline.
  if (field !== "" || row.length > 0) pushRow();

  return rows;
}

/**
 * Convert an exceljs cell value (which may be a string, number, boolean, Date,
 * hyperlink, rich text, or formula result) into a plain string.
 */
function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${value.getUTCFullYear()}-${p(value.getUTCMonth() + 1)}-${p(value.getUTCDate())}`;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.text === "string") return v.text;
    if (Array.isArray(v.richText)) {
      return v.richText.map((t) => (t as { text?: string })?.text ?? "").join("");
    }
    if ("result" in v) return cellToString(v.result);
    if ("error" in v) return "";
    if (typeof v.hyperlink === "string") return v.hyperlink;
  }
  return String(value);
}

/**
 * Parse an .xlsx workbook (first worksheet) into rows of strings.
 *
 * Uses exceljs's streaming reader and stops after MAX_PARSE_ROWS, so a crafted
 * "zip bomb" file can't be fully decompressed into memory — we abort reading the
 * stream once the row cap is hit. Styles are ignored, which means date cells
 * arrive as raw Excel serial numbers; a caller that wants dates converts them
 * itself rather than depending on exceljs's date/timezone interpretation.
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;

  // node:stream is a CommonJS built-in reached through a dynamic import, and
  // which shape comes back depends on the bundler: sometimes the namespace
  // carries `Readable` directly, sometimes the whole module sits on `default`.
  // Taking whichever one actually has the constructor keeps .xlsx uploads
  // working either way — reading `Readable` off the wrong one yields undefined
  // and fails every workbook with "Readable is not a constructor", which the
  // caller can only report as an unreadable file.
  const streamModule = await import("node:stream");
  const streamNs = (
    typeof streamModule.Readable === "function"
      ? streamModule
      : (streamModule as unknown as { default?: typeof streamModule }).default
  ) as typeof streamModule | undefined;
  const Readable = streamNs?.Readable;
  if (typeof Readable !== "function") {
    throw new SheetImportError(
      "Excel files can't be read on this server right now. Please save the file as CSV and upload that instead.",
    );
  }

  const stream = new Readable();
  stream.push(Buffer.from(buffer));
  stream.push(null);

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(stream, {
    worksheets: "emit",
    sharedStrings: "cache",
    hyperlinks: "ignore",
    styles: "ignore",
    entries: "ignore",
  });

  const rows: string[][] = [];
  try {
    for await (const worksheet of reader) {
      for await (const row of worksheet) {
        const values = row.values as unknown[]; // 1-indexed; values[0] is empty
        const maxCol = Math.min(values.length - 1, MAX_PARSE_COLS);
        const arr: string[] = [];
        for (let c = 1; c <= maxCol; c++) arr.push(cellToString(values[c]));
        rows.push(arr);
        if (rows.length > MAX_PARSE_ROWS) {
          throw new SheetImportError(
            `That spreadsheet has more than ${MAX_PARSE_ROWS} rows. Please split it into smaller files and import each separately.`,
          );
        }
      }
      break; // only the first worksheet
    }
  } finally {
    stream.destroy();
  }

  return rows;
}

/**
 * Dispatch on file type: CSV/TSV/TXT are read as text; .xlsx via exceljs.
 * Unknown extensions are sniffed (a ZIP magic number => .xlsx).
 */
export async function parseSheetFile(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  const asText = () => new TextDecoder("utf-8").decode(buffer);

  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(asText());
  if (lower.endsWith(".tsv")) return parseCsv(asText(), "\t");
  if (lower.endsWith(".xlsx")) return parseXlsx(buffer);
  if (lower.endsWith(".xls")) {
    throw new SheetImportError(
      "Legacy .xls files aren't supported. Please re-save the file as .xlsx or .csv and upload again.",
    );
  }

  // Unknown extension: sniff. .xlsx (a zip) starts with "PK" (0x50 0x4B).
  const head = new Uint8Array(buffer.slice(0, 2));
  if (head[0] === 0x50 && head[1] === 0x4b) return parseXlsx(buffer);
  return parseCsv(asText());
}
