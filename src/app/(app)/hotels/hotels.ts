// ---------------------------------------------------------------------------
// Hotels tab — shared constants, types, and helpers
//
// Plain module (no "use server" / "use client") so the server page/actions and
// the client form/table all share one definition of the fields. Like the Teams
// tab's PLAYER_FIELDS and Contact Info's COACH_FIELDS, each field's `key` is
// BOTH the form input name and the DB column, so the add form, the inline
// editor, the server insert/update, and the table headers stay in step.
//
// Two columns are handled outside HOTEL_FIELDS because they're dropdowns, not
// typed values: the **division** (a Teams division slug) and the **tournament**
// the stay is for (a Schedules-tab event). Both are optional — a hotel the
// program likes can be logged before it's tied to a weekend.
// ---------------------------------------------------------------------------

import {
  divisionLabel,
  type Division,
  type DivisionSlug,
} from "../teams/divisions";

export type HotelFieldType = "text" | "tel" | "link" | "money" | "notes";

export type HotelField = {
  key: string;
  label: string;
  type: HotelFieldType;
  placeholder?: string;
  required?: boolean;
  /**
   * Mirrors the column's width in the database so the input's maxLength, the
   * server-side slice, and the DDL agree. For the money field it's just an
   * input cap — the column is NUMERIC(10,2).
   */
  max: number;
};

// The typed part of a hotel record. `name` is first: it's the frozen column in
// the table and the only required field.
export const HOTEL_FIELDS: HotelField[] = [
  {
    key: "name",
    label: "Hotel Name",
    type: "text",
    required: true,
    max: 160,
    placeholder: "e.g. Hampton Inn & Suites",
  },
  {
    key: "address",
    label: "Address",
    type: "text",
    max: 300,
    placeholder: "1235 Scalp Ave",
  },
  { key: "city", label: "City", type: "text", max: 120, placeholder: "Johnstown" },
  { key: "state", label: "State", type: "text", max: 40, placeholder: "PA" },
  {
    key: "avg_cost_per_night",
    label: "Avg Cost / Night",
    type: "money",
    max: 12,
    placeholder: "129.00",
  },
  {
    key: "phone",
    label: "Phone",
    type: "tel",
    max: 40,
    placeholder: "e.g. (814) 555-0110",
  },
  {
    key: "website",
    label: "Website",
    type: "link",
    max: 300,
    placeholder: "hotel.com/johnstown",
  },
  {
    key: "notes",
    label: "Notes",
    type: "notes",
    max: 2000,
    placeholder: "Team rate code, breakfast included, 10 min from the complex…",
  },
];

/**
 * Sentinel value for the tournament dropdown meaning "leave the stay tied to
 * the tournament it already names".
 *
 * A tournament deleted from the Schedules tab nulls `event_id` but leaves
 * `event_name` behind, and a name with no id can't be an option in a dropdown
 * built from live tournaments. Without this the editor would show "not tied to
 * a tournament" for such a stay, and saving an unrelated field — a new phone
 * number — would quietly wipe the name it was booked under. The editor selects
 * this instead, and the update leaves both columns untouched; picking any real
 * option (including "none") still applies normally, so it can still be cleared
 * on purpose.
 */
export const KEEP_EVENT = "keep";

// A Schedules-tab tournament offered in the "which tournament" dropdown, with
// the team and season it belongs to so the option reads unambiguously and the
// saved row can link back to the right Schedules view.
export type TournamentOption = {
  id: number;
  event_name: string;
  event_date: string | null; // YYYY-MM-DD
  team_name: string;
  division: DivisionSlug;
  year: number | null; // null when the team predates seasons
};

// Shape returned by the hotels query (snake_case columns from Postgres) plus
// the joined tournament context. `avg_cost_per_night` arrives from NUMERIC as
// a string (e.g. "129.00").
//
// `event_name` is a snapshot taken when the tournament was chosen, so a stay
// still shows what it was for after that tournament is deleted from the
// Schedules tab (which nulls `event_id`).
export type HotelRow = {
  id: number;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  avg_cost_per_night: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  division: DivisionSlug | null;
  event_id: number | null;
  event_name: string | null;
  event_date: string | null;
  event_division: DivisionSlug | null;
  event_year: number | null;
};

/** One field's value off a row — null for both NULL and an empty string. */
export function hotelValue(row: HotelRow, key: string): string | null {
  const value = row[key as keyof HotelRow];
  if (value == null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** Everything on a hotel, lowercased, for the search box to match against. */
export function hotelSearchText(row: HotelRow, divisionName: string): string {
  return [
    ...HOTEL_FIELDS.map((f) => hotelValue(row, f.key) ?? ""),
    row.event_name ?? "",
    divisionName,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * The travel list's search box, division filter and tournament filter, as one
 * predicate.
 *
 * Shared with the export route so a downloaded file holds exactly the rows the
 * screen was showing — the two can't drift, because there's only one rule.
 * `searchText` lets the on-screen list pass its memoized haystack instead of
 * rebuilding it per keystroke; the route just lets it be computed.
 */
export function matchesHotelFilters(
  row: HotelRow,
  query: string,
  division: string,
  tournament: string,
  searchText?: string,
  divisions: Division[] = [],
): boolean {
  if (division !== "" && row.division !== division) return false;
  if (tournament !== "" && String(row.event_id) !== tournament) return false;
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const haystack =
    searchText ??
    hotelSearchText(
      row,
      row.division ? divisionLabel(row.division, divisions) : "",
    );
  return haystack.includes(q);
}

/** "Summer Slam · 12U Elite · Jul 21, 2026" — one tournament dropdown option. */
export function tournamentOptionLabel(t: TournamentOption): string {
  const parts = [t.event_name, t.team_name];
  if (t.event_date) parts.push(formatShortDate(t.event_date));
  return parts.join(" · ");
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "2026-07-21" -> "Jul 21, 2026", without going through a Date object (which
 * would shift the day across time zones) and without locale lookups (which
 * could differ between the server and client renders of the same row).
 */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Where a tournament's Schedules-tab view lives, for the link on its cell. */
export function scheduleHref(
  division: DivisionSlug | null,
  year: number | null,
): string {
  if (!division) return "/schedules";
  return year == null
    ? `/schedules?division=${division}`
    : `/schedules?division=${division}&year=${year}`;
}
