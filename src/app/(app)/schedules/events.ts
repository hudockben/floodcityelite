// ---------------------------------------------------------------------------
// Schedules tab — shared constants
//
// Plain module (no "use server" / "use client") so it can be imported by both
// the server page/actions and the client forms. Keeping the schedule-event
// column definitions and the status options here keeps the add/edit form
// inputs and the schedule table headers in sync, and keeps the DB values in
// one place. Divisions and the team shape are reused from the Teams tab.
// ---------------------------------------------------------------------------

// The registration status of a scheduled event, as offered in the dropdown.
export type EventStatus =
  | "registered"
  | "paid"
  | "waitlisted"
  | "rainout"
  | "refund";

export const STATUSES: { value: EventStatus; label: string }[] = [
  { value: "registered", label: "Registered" },
  { value: "paid", label: "Paid" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "rainout", label: "Rain Out" },
  { value: "refund", label: "Refund" },
];

export const DEFAULT_STATUS: EventStatus = "registered";

// Derived from STATUSES so it can never drift from the offered options.
export function isEventStatus(value: string): value is EventStatus {
  return STATUSES.some((s) => s.value === value);
}

export function statusLabel(value: string): string {
  return STATUSES.find((s) => s.value === value)?.label ?? value;
}

// An event/tournament field. `key` is BOTH the form input name and the DB
// column, so the add-event form, the server insert, and the schedule table
// stay aligned. `status` is handled separately (an inline dropdown), so it is
// not part of this list.
export type EventFieldType = "text" | "date" | "money";

export type EventField = {
  key: string;
  label: string;
  type: EventFieldType;
  placeholder?: string;
  required?: boolean;
};

export const EVENT_FIELDS: EventField[] = [
  { key: "event_host", label: "Event Host", type: "text", placeholder: "e.g. USSSA" },
  { key: "event_date", label: "Start Date", type: "date" },
  { key: "event_end_date", label: "End Date", type: "date" },
  {
    key: "event_name",
    label: "Event Name",
    type: "text",
    placeholder: "e.g. Summer Slam",
    required: true,
  },
  { key: "location", label: "Location", type: "text", placeholder: "City, ST" },
  { key: "cost", label: "Cost", type: "money", placeholder: "500.00" },
];

// Column index of the money "cost" field within EVENT_FIELDS. The Schedules
// table's "Total Cost" footer row uses it to place the total under the Cost
// column no matter how many fields precede it.
export const COST_FIELD_INDEX = EVENT_FIELDS.findIndex((f) => f.type === "money");

// Header/label for the status dropdown. Shared by the schedule table header
// and the add/edit form field labels so they stay in sync; kept short since
// the dropdown now offers five options.
export const STATUS_HEADER = "Status";

// Schedule table headers, in order: every event field, then the status
// dropdown, then a per-team total. The Actions column has no visible label.
export const SCHEDULE_HEADERS = [
  ...EVENT_FIELDS.map((f) => f.label),
  STATUS_HEADER,
];

// Shape returned by the schedule query (snake_case columns from Postgres).
// `cost` comes back as text (NUMERIC cast to text) so we format it ourselves
// and sum it without floating-point surprises.
export type ScheduleEventRow = {
  id: number;
  team_id: number;
  event_host: string | null;
  event_date: string | null;
  event_end_date: string | null;
  event_name: string;
  location: string | null;
  cost: string | null;
  status: EventStatus;
};

// A team as shown in the Schedules tab: the roster count is replaced with the
// number of scheduled events.
export type ScheduleTeamRow = {
  id: number;
  name: string;
  division: string;
  sport: string;
  event_count: number;
};

// ---------------------------------------------------------------------------
// Groups / playing-time rotation
//
// Each event can carry a "group" — the subset of the team's roster that's
// attending that tournament. Rather than store a row per (event, player), we
// store only the deviations from the default: a player is attending an event
// unless there's an event_attendance row marking them as not attending. That
// keeps the common case (take most of the roster, bench a few) to a handful of
// rows and means a brand-new event starts with the whole roster attending.
// ---------------------------------------------------------------------------

// A roster player as shown in an event's Groups panel.
export type GroupPlayer = {
  id: number;
  team_id: number;
  player_name: string;
  primary_position: string | null;
};

// One (event, player) attendance decision, as returned from the DB. Only
// rows where attending = false are meaningful for counting (they mark a
// benched player); everything else defaults to attending.
export type AttendanceRow = {
  event_id: number;
  player_id: number;
  attending: boolean;
};

// Per-player attendance summary across a team's scheduled events, used by the
// rotation planner's live fairness readout.
export type PlayerAttendance = {
  id: number;
  player_name: string;
  attending: number; // number of the team's events this player is attending
};

// Result of the rotation math: given a roster size, how many players are taken
// to each tournament, and a per-player target, how many tournaments are needed
// and how evenly the playing time comes out.
export type RotationPlan = {
  valid: boolean;
  rosterSize: number; // N
  perEvent: number; // S, clamped to the roster size
  target: number; // T
  tournamentsNeeded: number; // Y = ceil(N * T / S)
  totalSlots: number; // S * Y — total player-appearances available
  minPlays: number; // everyone plays at least this many over Y tournaments
  playersAtMax: number; // this many players play one extra (minPlays + 1)
  benchPerEvent: number; // N - S players rest each tournament
};

/**
 * Work out how many tournaments to schedule so every player reaches a target
 * number of appearances, taking a fixed number of players to each one.
 *
 * The core identity: each tournament offers `perEvent` player-slots, and the
 * roster needs `rosterSize * target` slots in total for everyone to hit the
 * target, so the minimum number of tournaments is
 *
 *     ceil(rosterSize * target / perEvent)
 *
 * With that many tournaments the `perEvent * tournaments` slots are shared out
 * as evenly as possible: everyone plays at least `minPlays`, and `playersAtMax`
 * of them play one more. `perEvent` is clamped to the roster — you can't take
 * more players than you have.
 *
 * Example: 15 on the roster, take 12 each time, target 4 → 5 tournaments, and
 * because 12 × 5 = 60 = 15 × 4 exactly, every player plays 4 and sits once.
 */
export function planRotation(
  rosterSize: number,
  perEvent: number,
  target: number,
): RotationPlan {
  const N = Math.max(0, Math.floor(rosterSize));
  const S = Math.min(Math.max(0, Math.floor(perEvent)), N);
  const T = Math.max(0, Math.floor(target));
  const benchPerEvent = Math.max(0, N - S);

  if (N === 0 || S === 0 || T === 0) {
    return {
      valid: false,
      rosterSize: N,
      perEvent: S,
      target: T,
      tournamentsNeeded: 0,
      totalSlots: 0,
      minPlays: 0,
      playersAtMax: 0,
      benchPerEvent,
    };
  }

  const tournamentsNeeded = Math.ceil((N * T) / S);
  const totalSlots = S * tournamentsNeeded;
  const minPlays = Math.floor(totalSlots / N);
  const playersAtMax = totalSlots - minPlays * N; // remainder plays minPlays + 1

  return {
    valid: true,
    rosterSize: N,
    perEvent: S,
    target: T,
    tournamentsNeeded,
    totalSlots,
    minPlays,
    playersAtMax,
    benchPerEvent,
  };
}

// --- formatting helpers ----------------------------------------------------
//
// Deterministic (no locale/timezone lookups) so server-rendered and
// client-rendered output always match — the schedule rows hydrate as client
// components, so a locale-dependent formatter could cause a mismatch.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-07-21" -> "Jul 21, 2026". Empty/invalid -> em dash. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** Parse a stored cost (string|number|null) to a number of cents, or 0. */
export function costToCents(value: string | number | null | undefined): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Format cents as "$1,234.50". */
export function formatCents(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rem = Math.abs(cents % 100).toString().padStart(2, "0");
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${withCommas}.${rem}`;
}

/** Format a stored cost value for a table cell. Empty -> em dash. */
export function formatMoney(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return "—";
  return formatCents(Math.round(n * 100));
}
