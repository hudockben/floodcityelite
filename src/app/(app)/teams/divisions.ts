// ---------------------------------------------------------------------------
// Teams tab — shared constants
//
// Plain module (no "use server" / "use client") so it can be imported by both
// the server page/actions and the client forms. Keeping the division, sport,
// and roster-column definitions here keeps the form inputs and the roster
// table headers in sync, and keeps the DB values in one place.
// ---------------------------------------------------------------------------

export type Sport = "baseball" | "softball";

/**
 * A division's stable identifier — what's stored in `teams.division` /
 * `seasons.division` and put in the ?division= query param.
 *
 * This used to be a union of the three divisions the program shipped with.
 * Divisions are user-created now (the Teams tab's "Add a division"), so the
 * set isn't knowable at compile time and the slug is just a string. The shape
 * is still constrained — see `slugifyDivision` / `isDivisionSlugFormat`.
 */
export type DivisionSlug = string;

export type Division = {
  slug: DivisionSlug;
  label: string;
  /** Sport pre-selected when creating a team in this division. */
  defaultSport: Sport;
};

/**
 * The divisions every company starts with, in display order. These are seeded
 * into the `divisions` table on first use (see listDivisions) rather than being
 * the whole story — a company can add its own and remove any of these it
 * doesn't run.
 *
 * They stay here as well so `divisionLabel` can name them without a database
 * round trip, which keeps labels right in the few client components that render
 * a slug without being handed the company's list.
 */
export const BUILTIN_DIVISIONS: Division[] = [
  {
    slug: "spring-summer-baseball",
    label: "Spring/Summer Baseball",
    defaultSport: "baseball",
  },
  { slug: "softball", label: "Softball", defaultSport: "softball" },
  { slug: "fall-baseball", label: "Fall Baseball", defaultSport: "baseball" },
];

/**
 * Max length of a team name. Mirrors the teams.name VARCHAR(120) column so the
 * form's maxLength and the server-side check stay in step with the database.
 */
export const TEAM_NAME_MAX = 120;

/** Mirrors divisions.label VARCHAR(60). */
export const DIVISION_LABEL_MAX = 60;

/** Mirrors divisions.slug / teams.division / seasons.division VARCHAR(32). */
export const DIVISION_SLUG_MAX = 32;

export const SPORTS: { value: Sport; label: string }[] = [
  { value: "baseball", label: "Baseball" },
  { value: "softball", label: "Softball" },
];

/**
 * Turn a typed division name into a slug: lowercase, non-alphanumerics folded
 * to single dashes, trimmed to the column width. "18U Fall Showcase" →
 * "18u-fall-showcase". Returns "" when nothing usable survives, which the
 * caller treats as an invalid name.
 */
export function slugifyDivision(label: string): DivisionSlug {
  return label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, DIVISION_SLUG_MAX)
    .replace(/-+$/, "");
}

/**
 * Whether a value has the *shape* of a division slug. This is a format check,
 * not a membership check — divisions are per-company rows now, so proving a
 * slug exists means asking the database (see listDivisions / divisionExists).
 *
 * Use it to sanitize a value bound for an optional display column that was
 * chosen from a select we rendered; use a real lookup before writing a row that
 * hangs off the division.
 */
export function isDivisionSlugFormat(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= DIVISION_SLUG_MAX;
}

export function isSport(value: string): value is Sport {
  return value === "baseball" || value === "softball";
}

export function sportLabel(value: string): string {
  return SPORTS.find((s) => s.value === value)?.label ?? value;
}

/**
 * Resolve a slug (from the URL) to one of `divisions`, falling back to the
 * first. Callers pass the company's divisions, loaded by listDivisions.
 *
 * Returns null only when the company has no divisions at all, which
 * listDivisions prevents by seeding the built-ins.
 */
export function resolveDivision(
  slug: string | undefined | null,
  divisions: Division[],
): Division | null {
  return divisions.find((d) => d.slug === slug) ?? divisions[0] ?? null;
}

/**
 * Name a division for display.
 *
 * Pass the company's divisions whenever they're to hand — that's the only
 * source that knows a user-created division's exact name. Without them this
 * falls back to the built-in names and then to de-slugifying, so a slug never
 * leaks to the screen raw.
 */
export function divisionLabel(value: string, divisions?: Division[]): string {
  const found =
    divisions?.find((d) => d.slug === value) ??
    BUILTIN_DIVISIONS.find((d) => d.slug === value);
  if (found) return found.label;
  return deslugifyDivision(value);
}

/**
 * Best-effort name for a slug with no division row behind it — a division
 * removed after the rows referencing it were written, say. "18u-fall-showcase"
 * → "18U Fall Showcase": each word capitalized, with age brackets ("18u", "10U")
 * uppercased the way everyone writes them.
 */
function deslugifyDivision(slug: string): string {
  if (slug === "") return "";
  return slug
    .split("-")
    .map((word) =>
      /^\d+u$/i.test(word)
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
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
  { key: "jersey_number", label: "Jersey Number", type: "text", placeholder: "12" },
  { key: "hat_size", label: "Hat Size", type: "text", placeholder: "e.g. Small, Medium, Large" },
  { key: "high_school", label: "High School", type: "text" },
  { key: "parent_phone", label: "Parent Phone Number", type: "tel" },
  { key: "parent_email", label: "Parent Email", type: "email" },
  { key: "parent_name", label: "Parent Name", type: "text" },
  { key: "closest_facility", label: "Closest Facility", type: "text" },
];

// Roster table headers, in order: a "Team" column followed by every player field.
export const ROSTER_HEADERS = ["Team", ...PLAYER_FIELDS.map((f) => f.label)];

/**
 * Whether a player is new to the program or coming back, taken from the
 * acceptance form's "Did you play in 2026?" answer (`Yes — returning player` /
 * `No — new player`, stored on the roster submission).
 *
 * `null` means we don't know: the player was added by hand on the Teams tab or
 * came in through a bulk roster upload, so no parent ever answered the
 * question. That reads as an em dash rather than a guess.
 */
export type RosterStatus = "returning" | "new" | null;

/**
 * Resolve a player's roster status.
 *
 * A coach's own setting (`override`, the roster's New/Returning field) wins
 * when present; otherwise it's whatever the parent answered on the acceptance
 * form. Null from both means nobody has said — an em dash, not a guess.
 *
 * The override lives on the player rather than being written back onto the
 * submission: that row is the record of what the parent actually said, and the
 * jersey automation reads it to decide who keeps a returning number.
 */
export function rosterStatus(
  playedLastSeason: boolean | null,
  override: boolean | null = null,
): RosterStatus {
  const value = override ?? playedLastSeason;
  if (value == null) return null;
  return value ? "returning" : "new";
}

/** The New/Returning select's options, in display order. */
export const ROSTER_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "From the acceptance form" },
  { value: "returning", label: "Returning" },
  { value: "new", label: "New" },
];

/** Form value ("returning"/"new"/blank) → the stored override. */
export function parseRosterStatus(value: string): boolean | null {
  if (value === "returning") return true;
  if (value === "new") return false;
  return null;
}

/** The stored override → the select's value. */
export function rosterStatusValue(override: boolean | null): string {
  if (override == null) return "";
  return override ? "returning" : "new";
}

/** Header for the New/Returning column. Shared by the roster and its printout. */
export const ROSTER_STATUS_HEADER = "New / Returning";

// Shape returned by the roster query (snake_case columns from Postgres) plus
// the joined team name. `is_paying` is a status flag (not one of PLAYER_FIELDS)
// rendered as its own "Paying" column with an inline toggle, and
// `played_last_season` is the acceptance form's returning-player answer,
// rendered as the "New / Returning" column.
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
  jersey_number: string | null;
  hat_size: string | null;
  high_school: string | null;
  parent_phone: string | null;
  parent_email: string | null;
  parent_name: string | null;
  closest_facility: string | null;
  is_paying: boolean;
  /** The acceptance form's answer; null when the player never came through it. */
  played_last_season: boolean | null;
  /** The coach's own New/Returning setting; null defers to the form answer. */
  is_returning: boolean | null;
};

export type TeamRow = {
  id: number;
  name: string;
  division: DivisionSlug;
  sport: Sport;
  player_count: number;
};
