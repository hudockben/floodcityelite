// ---------------------------------------------------------------------------
// Contact Info — bulk import of college coach contacts
//
// What a spreadsheet's columns mean for this tab: which header spellings map to
// which COACH_FIELDS key, and how a row becomes a contact. Reading the file
// itself is @/lib/sheet-import; the download's columns are in coach-export.ts.
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
import { isSport, sportLabel, type Sport } from "../teams/divisions";
import { COACH_FIELDS, coachValue, type CoachRow } from "./coaches";

/** Every COACH_FIELDS key — the columns an import can fill. */
export type CoachFieldKey =
  | "school_name"
  | "coach_name"
  | "coach_title"
  | "division_level"
  | "conference"
  | "cell_phone"
  | "email"
  | "website"
  | "city"
  | "state"
  | "notes";

/**
 * Accepted header spellings per field, in priority order. Compared after
 * normalization (lowercase, alphanumerics only), so "Coach Name", "coach_name"
 * and "COACHNAME" are all the same header. When a file has several columns for
 * one field, the first non-empty cell in this order wins for a given row.
 *
 * Key order matters: a header is claimed by the first field here that lists it,
 * which is why `coach_name` comes before the looser aliases on other fields.
 */
export const COACH_ALIASES: Record<CoachFieldKey, string[]> = {
  school_name: [
    "schoolname",
    "school",
    "college",
    "collegename",
    "university",
    "universityname",
    "institution",
    "program",
  ],
  coach_name: [
    "coachname",
    "coach",
    "headcoach",
    "contactname",
    "contact",
    "name",
    "recruiter",
  ],
  // "titlerole" is what the tab's own "Title / Role" heading normalizes to, so
  // a downloaded export can be edited and uploaded straight back.
  coach_title: [
    "coachtitle",
    "titlerole",
    "roletitle",
    "title",
    "role",
    "jobtitle",
    "position",
    "coachrole",
  ],
  division_level: [
    "divisionlevel",
    "level",
    "division",
    "ncaadivision",
    "classification",
    "div",
  ],
  conference: ["conference", "conf", "league"],
  cell_phone: [
    "cellphone",
    "cell",
    "mobile",
    "coachphone",
    "phone",
    "phonenumber",
    "telephone",
    "tel",
    "contactphone",
  ],
  email: ["email", "emailaddress", "coachemail", "contactemail", "mail", "e"],
  website: [
    "website",
    "url",
    "site",
    "web",
    "link",
    "athletics",
    "athleticssite",
    "athleticswebsite",
  ],
  city: ["city", "town"],
  state: ["state", "st", "province"],
  notes: ["notes", "note", "comments", "comment", "remarks", "memo"],
};

/**
 * The column naming which sport's list a row belongs to. Not a contact field —
 * it routes the row, the way the roster import's "team" column does. Absent, or
 * unreadable, and the row lands on the sport the tab is open on.
 */
const SPORT_ALIASES = ["sport", "sportlist", "list", "baseballsoftball"];

const RECOGNIZED = recognizedKeys(COACH_ALIASES, SPORT_ALIASES);

/** Column width limits, straight off the field definitions. */
const MAX_LEN: Record<string, number> = Object.fromEntries(
  COACH_FIELDS.map((f) => [f.key, f.max]),
);

/** A contact parsed from one row, shaped like the college_coaches columns. */
export type ParsedCoach = {
  sport: Sport;
  school_name: string;
  coach_name: string | null;
  coach_title: string | null;
  division_level: string | null;
  conference: string | null;
  cell_phone: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
};

export type CoachMapResult = {
  coaches: ParsedCoach[];
  /** Data rows found (blank rows don't count). */
  totalDataRows: number;
  /** Rows skipped because the school column was blank. */
  noSchoolRows: number;
  /** Whether a school column was found at all — without one nothing can import. */
  hasSchoolColumn: boolean;
  unmatchedHeaders: string[];
  warnings: string[];
};

/**
 * Read a "sport" cell. Accepts the slugs and their labels; anything else (or a
 * blank) falls back to the sport whose list is being uploaded to.
 */
function readSport(raw: string, fallback: Sport): Sport {
  const s = raw.trim().toLowerCase();
  if (s === "") return fallback;
  if (isSport(s)) return s;
  // "Baseball"/"Softball" as typed, and a few obvious variants.
  if (s.startsWith("base")) return "baseball";
  if (s.startsWith("soft")) return "softball";
  return fallback;
}

/**
 * Turn parsed rows into contacts. `defaultSport` is the list the upload was
 * started from — every row without a usable sport column lands there.
 */
export function mapCoachRows(
  rows: string[][],
  defaultSport: Sport,
): CoachMapResult {
  const warnings: string[] = [];
  const addWarn = (msg: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(msg);
  };

  const empty: CoachMapResult = {
    coaches: [],
    totalDataRows: 0,
    noSchoolRows: 0,
    hasSchoolColumn: false,
    unmatchedHeaders: [],
    warnings: [],
  };
  if (rows.length === 0) return empty;

  const header = rows[0].map((h) => String(h ?? ""));
  const sportIdx = findColumn(header, SPORT_ALIASES);
  const plan = planColumns<CoachFieldKey>(
    header,
    COACH_ALIASES,
    sportIdx == null ? [] : [sportIdx],
  );
  if (!plan.cols.school_name) return { ...empty, unmatchedHeaders: [] };

  const coaches: ParsedCoach[] = [];
  let totalDataRows = 0;
  let noSchoolRows = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (isRowEmpty(row)) continue;
    totalDataRows++;
    const rowNum = r + 1; // 1-based spreadsheet row (header is row 1)

    const { cell, first } = rowReader(row);

    const textField = (field: CoachFieldKey): string | null => {
      let v = collapseWs(first(plan.cols[field]));
      if (!v) return null;
      const max = MAX_LEN[field];
      if (max && v.length > max) {
        v = v.slice(0, max);
        addWarn(`Row ${rowNum}: ${field.replace(/_/g, " ")} was shortened to fit.`);
      }
      return v;
    };

    const school = textField("school_name");
    if (!school) {
      noSchoolRows++;
      continue;
    }

    coaches.push({
      sport: readSport(cell(sportIdx), defaultSport),
      school_name: school,
      coach_name: textField("coach_name"),
      coach_title: textField("coach_title"),
      division_level: textField("division_level"),
      conference: textField("conference"),
      cell_phone: textField("cell_phone"),
      email: textField("email"),
      website: textField("website"),
      city: textField("city"),
      state: textField("state"),
      // Notes can legitimately run to several lines; keep the line breaks and
      // only collapse the runs of spaces the other fields do.
      notes: (() => {
        let v = first(plan.cols.notes).trim();
        if (!v) return null;
        const max = MAX_LEN.notes;
        if (max && v.length > max) {
          v = v.slice(0, max);
          addWarn(`Row ${rowNum}: notes were shortened to fit.`);
        }
        return v;
      })(),
    });
  }

  return {
    coaches,
    totalDataRows,
    noSchoolRows,
    hasSchoolColumn: true,
    unmatchedHeaders: unusedHeaders(header, plan.matched, RECOGNIZED),
    warnings,
  };
}

/**
 * Dedupe key for a contact: sport, school, and coach. A school can hold several
 * coaches (a head coach and a recruiting coordinator), so the coach's name is
 * part of the key — otherwise the second one would import as a duplicate. Two
 * rows for the same school with no coach named do collapse together, which is
 * the right call for a re-uploaded file.
 */
export function coachKey(
  sport: string,
  school: string,
  coach: string | null,
): string {
  return `${sport} ${matchKey(school)} ${matchKey(coach ?? "")}`;
}

/** How a contact is named in the import summary. */
export function coachDisplayName(c: ParsedCoach): string {
  return c.coach_name ? `${c.school_name} — ${c.coach_name}` : c.school_name;
}
