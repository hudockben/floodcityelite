// ---------------------------------------------------------------------------
// Teams tab — shared constants
//
// Plain module (no "use server" / "use client") so it can be imported by both
// the server page/actions and the client forms. Keeping the division, sport,
// and roster-column definitions here keeps the form inputs and the roster
// table headers in sync, and keeps the DB values in one place.
// ---------------------------------------------------------------------------

export type Sport = "baseball" | "softball";

export type DivisionSlug =
  | "spring-summer-baseball"
  | "softball"
  | "fall-baseball";

export type Division = {
  slug: DivisionSlug;
  label: string;
  /** Sport pre-selected when creating a team in this division. */
  defaultSport: Sport;
};

// The division selector, in display order. Slugs are what we store in the DB
// and put in the ?division= query param.
export const DIVISIONS: Division[] = [
  {
    slug: "spring-summer-baseball",
    label: "Spring/Summer Baseball",
    defaultSport: "baseball",
  },
  { slug: "softball", label: "Softball", defaultSport: "softball" },
  { slug: "fall-baseball", label: "Fall Baseball", defaultSport: "baseball" },
];

export const DEFAULT_DIVISION: DivisionSlug = DIVISIONS[0].slug;

export const SPORTS: { value: Sport; label: string }[] = [
  { value: "baseball", label: "Baseball" },
  { value: "softball", label: "Softball" },
];

/** Resolve a slug (from the URL) to a division, or fall back to the default. */
export function resolveDivision(slug: string | undefined | null): Division {
  return DIVISIONS.find((d) => d.slug === slug) ?? DIVISIONS[0];
}

export function isDivisionSlug(value: string): value is DivisionSlug {
  return DIVISIONS.some((d) => d.slug === value);
}

export function isSport(value: string): value is Sport {
  return value === "baseball" || value === "softball";
}

export function sportLabel(value: string): string {
  return SPORTS.find((s) => s.value === value)?.label ?? value;
}

// Common baseball/softball positions offered as a datalist. Free text is still
// allowed so anything unusual can be typed in.
export const POSITIONS = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
  "DH",
  "UTIL",
];

// A player/roster field. `key` is BOTH the form input name and the DB column,
// so the add-player form, the server insert, and the roster table stay aligned.
export type PlayerFieldType = "text" | "number" | "date" | "email" | "tel" | "position";

export type PlayerField = {
  key: string;
  label: string;
  type: PlayerFieldType;
  placeholder?: string;
  required?: boolean;
};

export const PLAYER_FIELDS: PlayerField[] = [
  { key: "player_name", label: "Player Name", type: "text", required: true },
  { key: "grad_year", label: "Grad Year", type: "number", placeholder: "2027" },
  { key: "date_of_birth", label: "Date of Birth", type: "date" },
  { key: "height", label: "Height", type: "text", placeholder: `6'1"` },
  { key: "weight", label: "Weight", type: "number", placeholder: "180" },
  { key: "primary_position", label: "Primary Position", type: "position" },
  { key: "secondary_position", label: "Secondary Position", type: "position" },
  { key: "high_school", label: "High School", type: "text" },
  { key: "parent_phone", label: "Parent Phone Number", type: "tel" },
  { key: "parent_email", label: "Parent Email", type: "email" },
  { key: "parent_name", label: "Parent Name", type: "text" },
  { key: "closest_facility", label: "Closest Facility", type: "text" },
];

// Roster table headers, in order: a "Team" column followed by every player field.
export const ROSTER_HEADERS = ["Team", ...PLAYER_FIELDS.map((f) => f.label)];

// Shape returned by the roster query (snake_case columns from Postgres) plus
// the joined team name.
export type PlayerRow = {
  id: number;
  team_id: number;
  team_name: string;
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

export type TeamRow = {
  id: number;
  name: string;
  division: DivisionSlug;
  sport: Sport;
  player_count: number;
};
