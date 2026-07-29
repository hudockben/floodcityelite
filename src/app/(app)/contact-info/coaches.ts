// ---------------------------------------------------------------------------
// Contact Info — college coach contacts
//
// Plain module (no "use server" / "use client") so the server page/actions and
// the client form/table all share one definition of the fields. Like the Teams
// tab's PLAYER_FIELDS, each field's `key` is BOTH the form input name and the
// DB column, so the add form, the inline editor, the server insert/update, and
// the table headers stay in step.
//
// The tab is split by sport — baseball and softball keep separate college
// contact lists — reusing the Teams tab's two sports so "Softball" means the
// same thing everywhere in the app.
// ---------------------------------------------------------------------------

import { isSport, type Sport } from "../teams/divisions";

export type { Sport };

/** The sport shown when the URL carries no (or an unknown) ?sport=. */
export const DEFAULT_SPORT: Sport = "baseball";

/** Resolve a ?sport= slug to a sport, falling back to the default. */
export function resolveSport(value: string | undefined | null): Sport {
  return value && isSport(value) ? value : DEFAULT_SPORT;
}

// Common college levels, offered as a datalist. Free text is still allowed so
// anything unusual ("JUCO", "Prep", a state system) can just be typed in.
export const DIVISION_LEVELS = [
  "NCAA D1",
  "NCAA D2",
  "NCAA D3",
  "NAIA",
  "NJCAA D1",
  "NJCAA D2",
  "NJCAA D3",
  "CCCAA",
  "USCAA",
  "Club",
];

// How a field renders. "level" is a text input backed by the DIVISION_LEVELS
// datalist; "link" is a plain text input (not type="url", which would reject
// "gopsusports.com" typed without a scheme); "notes" is a full-width textarea.
export type CoachFieldType =
  | "text"
  | "tel"
  | "email"
  | "link"
  | "level"
  | "notes";

export type CoachField = {
  key: string;
  label: string;
  type: CoachFieldType;
  placeholder?: string;
  required?: boolean;
  /**
   * Mirrors the column's width in the database so the input's maxLength, the
   * server-side slice, and the DDL agree.
   */
  max: number;
};

// The contact record, in table-column order. Only the school is required —
// everything else gets filled in as a coach is worked.
export const COACH_FIELDS: CoachField[] = [
  {
    key: "school_name",
    label: "School Name",
    type: "text",
    required: true,
    max: 160,
    placeholder: "e.g. Penn State University",
  },
  {
    key: "coach_name",
    label: "Coach Name",
    type: "text",
    max: 160,
    placeholder: "e.g. Coach Miller",
  },
  {
    key: "coach_title",
    label: "Title / Role",
    type: "text",
    max: 120,
    placeholder: "e.g. Recruiting Coordinator",
  },
  {
    key: "division_level",
    label: "Division Level",
    type: "level",
    max: 40,
    placeholder: "e.g. NCAA D1",
  },
  {
    key: "conference",
    label: "Conference",
    type: "text",
    max: 120,
    placeholder: "e.g. Big Ten",
  },
  {
    key: "cell_phone",
    label: "Cell Phone",
    type: "tel",
    max: 40,
    placeholder: "e.g. (814) 555-0134",
  },
  {
    key: "email",
    label: "Email",
    type: "email",
    max: 160,
    placeholder: "coach@school.edu",
  },
  {
    key: "website",
    label: "Website",
    type: "link",
    max: 300,
    // Sport-neutral: the same form serves the baseball and softball lists.
    placeholder: "school.edu/athletics",
  },
  {
    key: "city",
    label: "City",
    type: "text",
    max: 120,
    placeholder: "State College",
  },
  { key: "state", label: "State", type: "text", max: 40, placeholder: "PA" },
  {
    key: "notes",
    label: "Notes",
    type: "notes",
    max: 2000,
    placeholder: "Camp dates, who made the intro, when you last talked…",
  },
];

// Table headers, in order: every contact field, then the actions column.
export const COACH_HEADERS = COACH_FIELDS.map((f) => f.label);

// Shape returned by the contacts query (snake_case columns from Postgres).
export type CoachRow = {
  id: number;
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

/** One field's value off a row — null for both NULL and an empty string. */
export function coachValue(row: CoachRow, key: string): string | null {
  const value = row[key as keyof CoachRow];
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** Everything on a contact, lowercased, for the search box to match against. */
export function coachSearchText(row: CoachRow): string {
  return COACH_FIELDS.map((f) => coachValue(row, f.key) ?? "")
    .join(" ")
    .toLowerCase();
}

/** A dialable href for a typed phone number (digits, +, and extensions out). */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

/**
 * A safe href for a typed website. A bare domain gets https://; anything with
 * a non-http(s) scheme (a `javascript:` URL pasted into the field) returns null
 * so the value renders as plain text instead of becoming a link.
 */
export function websiteHref(website: string): string | null {
  const value = website.trim();
  if (value === "") return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return `https://${value}`;
}

/** The website as shown in the table — no scheme, no trailing slash. */
export function websiteLabel(website: string): string {
  return website
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}
