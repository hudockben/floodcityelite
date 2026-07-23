// ---------------------------------------------------------------------------
// Teams tab — bulk roster import (CSV / Excel)
//
// Pure, server-side helpers that turn an uploaded spreadsheet into rows ready to
// insert into the `players` table. This module maps whatever columns a file has
// onto the roster fields the Teams tab already uses (see PLAYER_FIELDS in
// divisions.ts) — no new columns are introduced. A club's export can carry extra
// columns (season, gender, grade, address, a second parent, …); those are simply
// ignored.
//
// There is intentionally no "use server" / "use client" here: it's imported only
// by the bulk-upload server action. `exceljs` is loaded with a dynamic import so
// it never ends up in a client bundle and is only pulled in when an .xlsx file is
// actually uploaded.
// ---------------------------------------------------------------------------

/** A user-facing problem with the uploaded file (surfaced verbatim in the UI). */
export class RosterImportError extends Error {}

// A single roster row, shaped exactly like the columns the add-player form and
// the `players` table use. `date_of_birth` is a normalized YYYY-MM-DD string.
export type ParsedPlayer = {
  player_name: string;
  grad_year: number | null;
  date_of_birth: string | null;
  height: string | null;
  weight: number | null;
  primary_position: string | null;
  secondary_position: string | null;
  high_school: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  parent_name: string | null;
  closest_facility: string | null;
};

type SimpleField = Exclude<keyof ParsedPlayer, "player_name">;

// DB column limits (mirror db/schema.sql) so long values are trimmed to fit
// instead of failing the whole import.
const MAX_LEN: Record<string, number> = {
  player_name: 160,
  height: 24,
  primary_position: 48,
  secondary_position: 48,
  high_school: 160,
  parent_phone: 40,
  parent_email: 160,
  parent_name: 160,
  closest_facility: 160,
};

const MAX_WARNINGS = 25;

// Safety bounds for parsing an uploaded workbook. The 5 MB cap in the action is
// on the *compressed* upload; a crafted .xlsx can decompress far larger or
// declare up to 16384 columns, so we also bound what we materialize here. These
// are well above any real club roster (a team export is a few dozen rows and
// ~20 columns).
const MAX_PARSE_ROWS = 5000;
const MAX_PARSE_COLS = 100;

// --- header matching -------------------------------------------------------

// Normalize a header cell to a comparison key: lowercase, alphanumerics only.
// So "Parent1_Email", "parent1 email" and "PARENT1EMAIL" all collapse together.
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Accepted header spellings for a single combined name column, and for the
// first/last name pair that gets joined into player_name.
const NAME_DIRECT = [
  "playername",
  "name",
  "fullname",
  "playerfullname",
  "athletename",
  "player",
  "athlete",
];
const NAME_FIRST = [
  "playerfirst",
  "playerfirstname",
  "firstname",
  "first",
  "fname",
  "givenname",
];
const NAME_LAST = [
  "playerlast",
  "playerlastname",
  "lastname",
  "last",
  "lname",
  "surname",
  "familyname",
];

// For every other roster field, the header spellings we accept, in priority
// order. When several columns match (e.g. parent1_* and parent2_*), the first
// non-empty cell in this order wins for a given row — so parent 1 is preferred
// and parent 2 fills in only when parent 1 is blank.
const FIELD_ALIASES: Record<SimpleField, string[]> = {
  grad_year: ["gradyear", "graduationyear", "gradyr", "classof", "grad"],
  date_of_birth: ["birthdate", "dob", "dateofbirth", "birthday", "bday", "dateofbirthmmddyyyy"],
  height: ["height", "ht"],
  weight: ["weight", "wt", "lbs"],
  primary_position: [
    "primaryposition",
    "primarypos",
    "position",
    "position1",
    "pos",
    "pos1",
    "primary",
  ],
  secondary_position: [
    "secondaryposition",
    "secondarypos",
    "position2",
    "pos2",
    "secondary",
    "altposition",
    "altpos",
  ],
  high_school: ["highschool", "school", "hs"],
  parent_phone: [
    "parent1mobile",
    "parent1phone",
    "parent1cell",
    "parent1phonenumber",
    "parent1m",
    "parentmobile",
    "parentphone",
    "parentcell",
    "parentphonenumber",
    "phone",
    "mobile",
    "cell",
    "contactphone",
    "parent2mobile",
    "parent2phone",
    "parent2cell",
    "parent2phonenumber",
    "parent2m",
  ],
  parent_email: [
    "parent1email",
    "parent1e",
    "parentemail",
    "email",
    "emailaddress",
    "contactemail",
    "parent2email",
    "parent2e",
  ],
  parent_name: [
    "parent1name",
    "parent1n",
    "parentname",
    "parent1",
    "parent",
    "guardian",
    "guardianname",
    "guardian1name",
    "parent2name",
    "parent2n",
    "parent2",
    "guardian2name",
  ],
  closest_facility: [
    "closestfacility",
    "facility",
    "nearestfacility",
    "closestfac",
    "closesttrainingfacility",
  ],
};

// Every header spelling we know how to map. Used so a second column whose header
// duplicates a recognized field (e.g. two "Email" columns) isn't reported to the
// user as an "ignored column we don't track".
const RECOGNIZED_KEYS = new Set<string>([
  ...NAME_DIRECT,
  ...NAME_FIRST,
  ...NAME_LAST,
  ...Object.values(FIELD_ALIASES).flat(),
]);

export type NameMode = "direct" | "split" | "firstonly" | "lastonly" | "none";

type ColumnPlan = {
  nameMode: NameMode;
  nameDirectIdx?: number;
  firstIdx?: number;
  lastIdx?: number;
  fieldCols: Partial<Record<SimpleField, number[]>>;
  matched: Set<number>;
};

function planColumns(header: string[]): ColumnPlan {
  const keys = header.map(normKey);
  const firstIndexOf = (alias: string) => keys.indexOf(alias);

  const idxOf = (aliases: string[]): number | undefined => {
    for (const a of aliases) {
      const i = firstIndexOf(a);
      if (i !== -1) return i;
    }
    return undefined;
  };
  const idxsOf = (aliases: string[]): number[] => {
    const out: number[] = [];
    for (const a of aliases) {
      const i = firstIndexOf(a);
      if (i !== -1 && !out.includes(i)) out.push(i);
    }
    return out;
  };

  const matched = new Set<number>();
  const mark = (i?: number) => {
    if (i != null && i !== -1) matched.add(i);
  };

  const nameDirectIdx = idxOf(NAME_DIRECT);
  const firstIdx = idxOf(NAME_FIRST);
  const lastIdx = idxOf(NAME_LAST);

  let nameMode: NameMode;
  if (nameDirectIdx != null) {
    nameMode = "direct";
    mark(nameDirectIdx);
  } else if (firstIdx != null && lastIdx != null) {
    nameMode = "split";
    mark(firstIdx);
    mark(lastIdx);
  } else if (firstIdx != null) {
    nameMode = "firstonly";
    mark(firstIdx);
  } else if (lastIdx != null) {
    nameMode = "lastonly";
    mark(lastIdx);
  } else {
    nameMode = "none";
  }

  const fieldCols: Partial<Record<SimpleField, number[]>> = {};
  for (const field of Object.keys(FIELD_ALIASES) as SimpleField[]) {
    const cols = idxsOf(FIELD_ALIASES[field]).filter((i) => !matched.has(i));
    if (cols.length > 0) {
      fieldCols[field] = cols;
      cols.forEach((i) => matched.add(i));
    }
  }

  return { nameMode, nameDirectIdx, firstIdx, lastIdx, fieldCols, matched };
}

// --- value normalization ---------------------------------------------------

function collapseWs(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function buildDate(y: number, mo: number, d: number): string | null {
  if (y < 1900 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Reject impossible calendar dates (JS would roll Feb 30 over into March).
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  ) {
    return null;
  }
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(mo)}-${p(d)}`;
}

// Turn a messy date cell into YYYY-MM-DD, or null if it can't be read
// confidently (e.g. "26-Oct" with no year). Handles ISO, US M/D/Y (2- or
// 4-digit year) and Excel date serials.
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return buildDate(+m[1], +m[2], +m[3]);

  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (m[3].length <= 2) y = y <= 69 ? 2000 + y : 1900 + y;
    return buildDate(y, +m[1], +m[2]);
  }

  // Bare number → treat as an Excel serial only if it lands in a plausible
  // date range (roughly 1927–2064). Other stray numbers are ignored.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial >= 10000 && serial <= 60000) {
      const dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
      return buildDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
  }

  return null;
}

function parseIntField(raw: string, min: number, max: number): number | null {
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/-?\d+/); // first integer run ("180 lbs" -> 180)
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

// --- row -> player ---------------------------------------------------------

function isRowEmpty(row: string[]): boolean {
  return row.every((c) => String(c ?? "").trim() === "");
}

export type MapResult = {
  nameMode: NameMode;
  players: ParsedPlayer[];
  totalDataRows: number;
  noNameRows: number;
  unmatchedHeaders: string[];
  warnings: string[];
};

export function mapRows(rows: string[][]): MapResult {
  const warnings: string[] = [];
  const addWarn = (msg: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(msg);
  };

  if (rows.length === 0) {
    return {
      nameMode: "none",
      players: [],
      totalDataRows: 0,
      noNameRows: 0,
      unmatchedHeaders: [],
      warnings: [],
    };
  }

  const header = rows[0].map((h) => String(h ?? ""));
  const plan = planColumns(header);
  if (plan.nameMode === "none") {
    return {
      nameMode: "none",
      players: [],
      totalDataRows: 0,
      noNameRows: 0,
      unmatchedHeaders: [],
      warnings: [],
    };
  }

  const unmatchedHeaders: string[] = [];
  header.forEach((h, i) => {
    const trimmed = h.trim();
    if (trimmed === "" || plan.matched.has(i)) return;
    // A recognized header that lost out only because an earlier column already
    // claimed that field (a duplicate column) isn't an "untracked" column.
    if (RECOGNIZED_KEYS.has(normKey(h))) return;
    if (!unmatchedHeaders.includes(trimmed)) unmatchedHeaders.push(trimmed);
  });

  const players: ParsedPlayer[] = [];
  let totalDataRows = 0;
  let noNameRows = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (isRowEmpty(row)) continue;
    totalDataRows++;
    const rowNum = r + 1; // 1-based spreadsheet row (header is row 1)

    const cell = (i?: number): string =>
      i == null || i < 0 ? "" : String(row[i] ?? "").trim();
    const firstNonEmpty = (idxs?: number[]): string => {
      if (!idxs) return "";
      for (const i of idxs) {
        const v = cell(i);
        if (v) return v;
      }
      return "";
    };

    // player_name
    let name = "";
    switch (plan.nameMode) {
      case "direct":
        name = cell(plan.nameDirectIdx);
        break;
      case "split":
        name = `${cell(plan.firstIdx)} ${cell(plan.lastIdx)}`.trim();
        break;
      case "firstonly":
        name = cell(plan.firstIdx);
        break;
      case "lastonly":
        name = cell(plan.lastIdx);
        break;
    }
    name = collapseWs(name);
    if (!name) {
      noNameRows++;
      continue;
    }
    if (name.length > MAX_LEN.player_name) {
      name = name.slice(0, MAX_LEN.player_name);
      addWarn(`Row ${rowNum}: player name was shortened to fit.`);
    }

    const textField = (field: SimpleField): string | null => {
      let v = firstNonEmpty(plan.fieldCols[field]);
      if (!v) return null;
      const max = MAX_LEN[field];
      if (max && v.length > max) {
        v = v.slice(0, max);
        addWarn(`Row ${rowNum}: ${field.replace(/_/g, " ")} was shortened to fit.`);
      }
      return v;
    };

    const gradRaw = firstNonEmpty(plan.fieldCols.grad_year);
    const grad_year = parseIntField(gradRaw, 1900, 2100);
    if (gradRaw && grad_year == null) {
      addWarn(`Row ${rowNum}: couldn't read grad year "${gradRaw}" — left blank.`);
    }

    const weightRaw = firstNonEmpty(plan.fieldCols.weight);
    const weight = parseIntField(weightRaw, 0, 2000);
    if (weightRaw && weight == null) {
      addWarn(`Row ${rowNum}: couldn't read weight "${weightRaw}" — left blank.`);
    }

    const dobRaw = firstNonEmpty(plan.fieldCols.date_of_birth);
    const date_of_birth = normalizeDate(dobRaw);
    if (dobRaw && date_of_birth == null) {
      addWarn(`Row ${rowNum}: couldn't read birth date "${dobRaw}" — left blank.`);
    }

    players.push({
      player_name: name,
      grad_year,
      date_of_birth,
      height: textField("height"),
      weight,
      primary_position: textField("primary_position"),
      secondary_position: textField("secondary_position"),
      high_school: textField("high_school"),
      parent_phone: textField("parent_phone"),
      parent_email: textField("parent_email"),
      parent_name: textField("parent_name"),
      closest_facility: textField("closest_facility"),
    });
  }

  return { nameMode: plan.nameMode, players, totalDataRows, noNameRows, unmatchedHeaders, warnings };
}

// Dedupe key for a player name: case- and whitespace-insensitive.
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// --- file parsing ----------------------------------------------------------

// A small, dependency-free CSV reader. Handles quoted fields, escaped quotes
// (""), embedded commas/newlines, and CRLF/CR/LF line endings.
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

// Convert an exceljs cell value (which may be a string, number, boolean, Date,
// hyperlink, rich text, or formula result) into a plain string.
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

// Parse an .xlsx workbook (first worksheet) into rows of strings.
//
// Uses exceljs's streaming reader and stops after MAX_PARSE_ROWS, so a crafted
// "zip bomb" file can't be fully decompressed into memory — we abort reading the
// stream once the row cap is hit. Styles are ignored, which means date cells
// arrive as raw Excel serial numbers; normalizeDate() converts those, so we
// don't depend on exceljs's date/timezone interpretation.
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const { Readable } = await import("node:stream");

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
          throw new RosterImportError(
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

// Dispatch on file type: CSV/TSV/TXT are read as text; .xlsx via exceljs.
// Unknown extensions are sniffed (a ZIP magic number => .xlsx).
export async function parseRosterFile(
  fileName: string,
  buffer: ArrayBuffer,
): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  const asText = () => new TextDecoder("utf-8").decode(buffer);

  if (lower.endsWith(".csv") || lower.endsWith(".txt")) return parseCsv(asText());
  if (lower.endsWith(".tsv")) return parseCsv(asText(), "\t");
  if (lower.endsWith(".xlsx")) return parseXlsx(buffer);
  if (lower.endsWith(".xls")) {
    throw new RosterImportError(
      "Legacy .xls files aren't supported. Please re-save the file as .xlsx or .csv and upload again.",
    );
  }

  // Unknown extension: sniff. .xlsx (a zip) starts with "PK" (0x50 0x4B).
  const head = new Uint8Array(buffer.slice(0, 2));
  if (head[0] === 0x50 && head[1] === 0x4b) return parseXlsx(buffer);
  return parseCsv(asText());
}
