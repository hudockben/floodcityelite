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
export type EventStatus = "registered" | "paid" | "waitlisted";

export const STATUSES: { value: EventStatus; label: string }[] = [
  { value: "registered", label: "Registered" },
  { value: "paid", label: "Paid" },
  { value: "waitlisted", label: "Waitlisted" },
];

export const DEFAULT_STATUS: EventStatus = "registered";

export function isEventStatus(value: string): value is EventStatus {
  return value === "registered" || value === "paid" || value === "waitlisted";
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
  { key: "event_date", label: "Date", type: "date" },
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

// Schedule table headers, in order: every event field, then the status
// dropdown, then a per-team total. The Actions column has no visible label.
export const SCHEDULE_HEADERS = [
  ...EVENT_FIELDS.map((f) => f.label),
  "Registered/Paid/Waitlisted",
];

// Shape returned by the schedule query (snake_case columns from Postgres).
// `cost` comes back as text (NUMERIC cast to text) so we format it ourselves
// and sum it without floating-point surprises.
export type ScheduleEventRow = {
  id: number;
  team_id: number;
  event_host: string | null;
  event_date: string | null;
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
