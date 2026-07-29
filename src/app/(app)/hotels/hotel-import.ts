// ---------------------------------------------------------------------------
// Hotels — bulk import of the travel list
//
// What a spreadsheet's columns mean for this tab: which header spellings map to
// which HOTEL_FIELDS key, plus two lookup columns that aren't typed values —
// the **division** (matched to a Teams division) and the **tournament** the
// stay is for (matched by name to a Schedules-tab event). Reading the file is
// @/lib/sheet-import; the download's columns are in hotel-export.ts.
//
// Plain module (no "use server" / "use client") — imported by the upload action,
// server-side only (the parser it pulls in is not browser-safe).
// ---------------------------------------------------------------------------

import {
  collapseWs,
  findColumn,
  isRowEmpty,
  matchKey,
  planColumns,
  recognizedKeys,
  rowReader,
  unusedHeaders,
} from "@/lib/sheet-import";
import { MAX_WARNINGS } from "../bulk-import";
import {
  DIVISIONS,
  divisionLabel,
  isDivisionSlug,
  type DivisionSlug,
} from "../teams/divisions";
import {
  formatShortDate,
  HOTEL_FIELDS,
  hotelValue,
  type HotelRow,
} from "./hotels";

/** Every HOTEL_FIELDS key — the columns an import can fill. */
export type HotelFieldKey =
  | "name"
  | "address"
  | "city"
  | "state"
  | "avg_cost_per_night"
  | "phone"
  | "website"
  | "notes";

/**
 * Accepted header spellings per field, in priority order. Compared after
 * normalization (lowercase, alphanumerics only), so "Avg Cost / Night",
 * "avg_cost_per_night" and "AVGCOSTNIGHT" all collapse together. When a file
 * has several columns for one field, the first non-empty cell in this order
 * wins for a given row.
 *
 * Key order matters: a header is claimed by the first field here that lists it.
 * `name` runs first so a bare "name" column is the hotel, not something else.
 */
export const HOTEL_ALIASES: Record<HotelFieldKey, string[]> = {
  name: ["hotelname", "hotel", "name", "property", "propertyname", "lodging"],
  address: ["address", "streetaddress", "street", "addressline1", "address1", "addr"],
  city: ["city", "town"],
  state: ["state", "st", "province"],
  // "avgcostnight" is what the tab's own "Avg Cost / Night" heading normalizes
  // to, so a downloaded export can be edited and uploaded straight back.
  avg_cost_per_night: [
    "avgcostpernight",
    "avgcostnight",
    "averagecostpernight",
    "costpernight",
    "ratepernight",
    "nightlyrate",
    "avgrate",
    "avgcost",
    "averagecost",
    "nightly",
    "rate",
    "cost",
    "price",
  ],
  phone: ["hotelphone", "phone", "phonenumber", "telephone", "tel", "contactphone"],
  website: ["website", "url", "site", "web", "link", "bookinglink", "bookingurl"],
  notes: ["notes", "note", "comments", "comment", "remarks", "memo"],
};

/**
 * The two routing columns. Neither is a typed value: `division` is matched to a
 * Teams division and `tournament` to a Schedules-tab event by name, the way the
 * roster import's "team" column works. Both optional — a hotel the program
 * likes can be imported before it's tied to a weekend.
 */
const DIVISION_ALIASES = ["division", "teamdivision", "div", "program"];
const TOURNAMENT_ALIASES = [
  "tournament",
  "tournamentname",
  "event",
  "eventname",
  "weekend",
];

/**
 * Columns the export writes that an import deliberately doesn't read. The
 * tournament's date comes from the Schedules tab, not from the file, so it's
 * known-and-ignored rather than unrecognized — otherwise a file downloaded with
 * the Excel button and uploaded straight back would report its own column as
 * one "we don't track".
 */
const EXPORT_ONLY_ALIASES = ["tournamentdate", "eventdate"];

const RECOGNIZED = recognizedKeys(
  HOTEL_ALIASES,
  DIVISION_ALIASES,
  TOURNAMENT_ALIASES,
  EXPORT_ONLY_ALIASES,
);

/** Column width limits, straight off the field definitions. */
const MAX_LEN: Record<string, number> = Object.fromEntries(
  HOTEL_FIELDS.map((f) => [f.key, f.max]),
);

/** A hotel parsed from one row, shaped like the `hotels` columns. */
export type ParsedHotel = {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  /** Fixed-2 string for NUMERIC(10,2), or null. */
  avg_cost_per_night: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  division: DivisionSlug | null;
  /** The tournament name as written in the file, before it's looked up. */
  tournamentName: string | null;
};

export type HotelMapResult = {
  hotels: ParsedHotel[];
  totalDataRows: number;
  /** Rows skipped because the hotel-name column was blank. */
  noNameRows: number;
  /** Whether a hotel-name column was found at all. */
  hasNameColumn: boolean;
  unmatchedHeaders: string[];
  warnings: string[];
};

/**
 * A nightly rate cell → a fixed-2 string for NUMERIC(10,2), or null. Mirrors
 * the add/edit form's money() helper, including its ceiling, so an imported
 * rate and a typed one are stored identically.
 */
export function parseRate(raw: string): string | null {
  const s = raw.trim().replace(/[$,]/g, "");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999.99) return null;
  return n.toFixed(2);
}

/**
 * A division cell → a division slug, or null. Accepts the slug itself and the
 * label as the app shows it ("Spring/Summer Baseball"), plus anything that
 * normalizes to either.
 */
export function parseDivision(raw: string): DivisionSlug | null {
  const s = raw.trim();
  if (s === "") return null;
  if (isDivisionSlug(s)) return s;
  const key = matchKey(s).replace(/[^a-z0-9]/g, "");
  for (const d of DIVISIONS) {
    if (matchKey(d.slug).replace(/[^a-z0-9]/g, "") === key) return d.slug;
    if (matchKey(d.label).replace(/[^a-z0-9]/g, "") === key) return d.slug;
  }
  return null;
}

export function mapHotelRows(rows: string[][]): HotelMapResult {
  const warnings: string[] = [];
  const addWarn = (msg: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(msg);
  };

  const empty: HotelMapResult = {
    hotels: [],
    totalDataRows: 0,
    noNameRows: 0,
    hasNameColumn: false,
    unmatchedHeaders: [],
    warnings: [],
  };
  if (rows.length === 0) return empty;

  const header = rows[0].map((h) => String(h ?? ""));
  const divisionIdx = findColumn(header, DIVISION_ALIASES);
  const tournamentIdx = findColumn(header, TOURNAMENT_ALIASES);
  const claimed = [divisionIdx, tournamentIdx].filter(
    (i): i is number => i != null,
  );
  const plan = planColumns<HotelFieldKey>(header, HOTEL_ALIASES, claimed);
  if (!plan.cols.name) return empty;

  const hotels: ParsedHotel[] = [];
  let totalDataRows = 0;
  let noNameRows = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (isRowEmpty(row)) continue;
    totalDataRows++;
    const rowNum = r + 1; // 1-based spreadsheet row (header is row 1)

    const { cell, first } = rowReader(row);

    const textField = (field: HotelFieldKey): string | null => {
      let v = collapseWs(first(plan.cols[field]));
      if (!v) return null;
      const max = MAX_LEN[field];
      if (max && v.length > max) {
        v = v.slice(0, max);
        addWarn(`Row ${rowNum}: ${field.replace(/_/g, " ")} was shortened to fit.`);
      }
      return v;
    };

    const name = textField("name");
    if (!name) {
      noNameRows++;
      continue;
    }

    const rateRaw = first(plan.cols.avg_cost_per_night);
    const rate = parseRate(rateRaw);
    if (rateRaw && rate == null) {
      addWarn(`Row ${rowNum}: couldn't read the rate "${rateRaw}" — left blank.`);
    }

    const divisionRaw = cell(divisionIdx);
    const division = parseDivision(divisionRaw);
    if (divisionRaw && division == null) {
      addWarn(
        `Row ${rowNum}: "${divisionRaw}" isn't one of the divisions — left blank.`,
      );
    }

    let notes = first(plan.cols.notes).trim();
    if (notes && MAX_LEN.notes && notes.length > MAX_LEN.notes) {
      notes = notes.slice(0, MAX_LEN.notes);
      addWarn(`Row ${rowNum}: notes were shortened to fit.`);
    }

    hotels.push({
      name,
      address: textField("address"),
      city: textField("city"),
      state: textField("state"),
      avg_cost_per_night: rate,
      phone: textField("phone"),
      website: textField("website"),
      notes: notes || null,
      division,
      tournamentName: collapseWs(cell(tournamentIdx)) || null,
    });
  }

  return {
    hotels,
    totalDataRows,
    noNameRows,
    hasNameColumn: true,
    unmatchedHeaders: unusedHeaders(header, plan.matched, RECOGNIZED),
    warnings,
  };
}

/**
 * Dedupe key for a stay: the hotel and the city. The same chain in two towns is
 * two hotels; the same hotel listed twice in one file is one. City is part of
 * the key rather than the tournament, so re-uploading a file that has since
 * gained a tournament column updates nothing but doesn't duplicate either.
 */
export function hotelKey(name: string, city: string | null): string {
  return `${matchKey(name)} ${matchKey(city ?? "")}`;
}

/** How a hotel is named in the import summary. */
export function hotelDisplayName(h: ParsedHotel): string {
  return h.city ? `${h.name} — ${h.city}` : h.name;
}
