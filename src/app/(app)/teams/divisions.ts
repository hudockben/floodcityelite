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

/**
 * Max length of a team name. Mirrors the teams.name VARCHAR(120) column so the
 * form's maxLength and the server-side check stay in step with the database.
 */
export const TEAM_NAME_MAX = 120;

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

export function divisionLabel(value: string): string {
  return DIVISIONS.find((d) => d.slug === value)?.label ?? value;
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
  /**
   * The jersey numbers this player's acceptance form asked for, in preference
   * order — the returner's old number, or a new player's three ranked options.
   *
   * Three distinct states, and the difference is the whole point (see
   * jerseyGapNote): null = no acceptance form on file at all (added by hand or
   * bulk-uploaded), [] = a form on file that named no number (submitted before
   * the field was required), [..] = numbers were asked for.
   */
  jersey_requested: string[] | null;
  /** Whether a coach typed this number by hand (the automation won't touch it). */
  jersey_locked: boolean;
};

/** Who holds a number on a team, and whether a coach pinned it there. */
export type JerseyHolder = { name: string; locked: boolean };

/**
 * Explain an empty jersey cell.
 *
 * A blank number is never an accident, but the roster used to render all three
 * causes as the same em dash, so "did they not fill it out, or did something go
 * wrong?" wasn't answerable from the roster. This turns the dash into the
 * actual reason: nobody asked for a number, the form predates the question, or
 * — the usual one — every number they asked for was already spoken for, and by
 * whom.
 *
 * `heldBy` maps a number to the player holding it, built from the same team's
 * roster. A requested number that's free means the assignment simply hasn't
 * been re-run since it opened up, which "Assign numbers" fixes.
 */
export function jerseyGapNote(
  requested: string[] | null,
  heldBy: Map<string, JerseyHolder>,
): { short: string; detail: string } | null {
  // No acceptance form on file — the number was never asked for, so there's
  // nothing to explain beyond the empty cell itself.
  if (requested == null) return null;

  if (requested.length === 0) {
    return {
      short: "none asked for",
      detail:
        "The acceptance form on file didn't name a jersey number — it was submitted before that field was required. Type one here to assign it.",
    };
  }

  const free = requested.filter((n) => !heldBy.has(n));
  const asked = requested.map((n) => `#${n}`).join(", ");

  if (free.length > 0) {
    return {
      short: `#${free[0]} is free`,
      detail: `Asked for ${asked} — ${free.map((n) => `#${n}`).join(", ")} ${free.length === 1 ? "is" : "are"} free now. Use "Assign numbers" to pick ${free.length === 1 ? "it" : "one"} up, or type one here.`,
    };
  }

  const holders = requested.map((n) => {
    const holder = heldBy.get(n) as JerseyHolder;
    // A pinned number is the one case the coach can undo: the automation is
    // holding off on it deliberately, so say how to hand it back.
    return holder.locked
      ? `#${n} is pinned to ${holder.name}`
      : `#${n} is ${holder.name}'s`;
  });
  const anyPinned = requested.some((n) => heldBy.get(n)?.locked);

  return {
    short: `${asked} taken`,
    detail: `Asked for ${asked}, and ${requested.length === 1 ? "it's" : "they're"} taken: ${holders.join(", ")}.${
      anyPinned
        ? " A pinned number was typed in by hand — clearing it on that player hands it back, and this player gets it."
        : ""
    } Or type a free number here to assign one.`,
  };
}

export type TeamRow = {
  id: number;
  name: string;
  division: DivisionSlug;
  sport: Sport;
  player_count: number;
};
