// ---------------------------------------------------------------------------
// Roster Submissions — shared filtering and export columns
//
// Plain module (no "use server" / "use client") so the client list and the
// server-side export route share one definition of what the filters mean. The
// list narrows the responses in the browser; the export route re-applies the
// same predicates to the same rows so a download contains exactly what the
// screen was showing — without either side reimplementing the other.
// ---------------------------------------------------------------------------

import { divisionLabel } from "../teams/divisions";
import { formatRosterDate } from "@/lib/roster-format";
import type { RosterSubmissionRow } from "@/lib/roster-submissions";

export type StatusFilter = "all" | "accepted" | "declined";

export function isStatusFilter(value: string): value is StatusFilter {
  return value === "all" || value === "accepted" || value === "declined";
}

export function handednessLabel(value: string | null): string | null {
  if (!value) return null;
  const map: Record<string, string> = {
    L: "Left (L)",
    R: "Right (R)",
    S: "Switch (S)",
  };
  return map[value] ?? value;
}

/** The team a submission chose: the live name, else the snapshot. */
export function teamNameOf(s: RosterSubmissionRow): string | null {
  return s.current_team_name ?? s.team_name;
}

/**
 * A stable key for the team a submission chose: prefer the live team id, fall
 * back to the snapshot name (a team that's since been deleted). Declines with
 * no team at all return null and belong to no team group.
 */
export function teamKeyOf(s: RosterSubmissionRow): string | null {
  if (s.team_id != null) return `id:${s.team_id}`;
  const name = teamNameOf(s);
  return name ? `name:${name}` : null;
}

/**
 * The lowercased text a submission is matched against — every field a user
 * might reasonably type. Built once per submission so keystrokes stay cheap.
 */
export function haystackOf(s: RosterSubmissionRow): string {
  const parts: (string | number | null)[] = [
    s.player_name,
    s.email,
    s.high_school,
    s.primary_position,
    s.secondary_position,
    s.parent_name,
    s.parent_phone,
    s.secondary_phone,
    s.returning_jersey,
    s.jersey_option_1,
    s.jersey_option_2,
    s.jersey_option_3,
    s.grad_year,
    s.height,
    s.weight,
    s.hat_size,
    handednessLabel(s.bats),
    handednessLabel(s.throws),
    teamNameOf(s),
    s.current_division ? divisionLabel(s.current_division) : null,
    s.division ? divisionLabel(s.division) : null,
  ];
  return parts
    .filter((p) => p != null && p !== "")
    .join(" ")
    .toLowerCase();
}

/**
 * Search + team, the pair the status counts are computed over (so "Accepted 12"
 * reflects the current search rather than the whole list). `query` is matched
 * against the haystack; an empty team key means "all teams".
 */
export function matchesSearchAndTeam(
  query: string,
  teamFilter: string,
  haystack: string,
  teamKey: string | null,
): boolean {
  const q = query.trim().toLowerCase();
  if (q !== "" && !haystack.includes(q)) return false;
  if (teamFilter !== "" && teamKey !== teamFilter) return false;
  return true;
}

export function matchesStatus(accepted: boolean, status: StatusFilter): boolean {
  if (status === "accepted") return accepted;
  if (status === "declined") return !accepted;
  return true;
}

// ---- export ---------------------------------------------------------------

/**
 * The spreadsheet's columns, in the order the submission cards read. Unlike a
 * card — which drops a parent's blank answers to stay compact — every row of
 * the export carries every column, blank where unanswered, so the sheet stays
 * rectangular and sortable.
 */
export const EXPORT_COLUMNS: {
  header: string;
  /** Column width in characters, for the Excel sheet. */
  width: number;
  value: (s: RosterSubmissionRow) => string;
}[] = [
  { header: "Status", width: 10, value: (s) => (s.accepted ? "Accepted" : "Declined") },
  { header: "Player", width: 22, value: (s) => s.player_name },
  { header: "Team", width: 28, value: (s) => teamNameOf(s) ?? "" },
  {
    header: "Division",
    width: 20,
    value: (s) => {
      const slug = s.current_division ?? s.division;
      return slug ? divisionLabel(slug) : "";
    },
  },
  {
    header: "Submitted",
    width: 14,
    value: (s) => formatRosterDate(s.created_at.slice(0, 10)),
  },
  { header: "Email", width: 28, value: (s) => s.email ?? "" },
  { header: "Grad year", width: 10, value: (s) => (s.grad_year != null ? String(s.grad_year) : "") },
  { header: "High school", width: 24, value: (s) => s.high_school ?? "" },
  {
    header: "Date of birth",
    width: 14,
    value: (s) => (s.date_of_birth ? formatRosterDate(s.date_of_birth) : ""),
  },
  { header: "Parent's name", width: 20, value: (s) => s.parent_name ?? "" },
  { header: "Parent's cell", width: 16, value: (s) => s.parent_phone ?? "" },
  { header: "Secondary cell", width: 16, value: (s) => s.secondary_phone ?? "" },
  { header: "Height", width: 10, value: (s) => s.height ?? "" },
  { header: "Weight", width: 10, value: (s) => (s.weight != null ? String(s.weight) : "") },
  { header: "Bats", width: 12, value: (s) => handednessLabel(s.bats) ?? "" },
  { header: "Throws", width: 12, value: (s) => handednessLabel(s.throws) ?? "" },
  { header: "Primary position", width: 16, value: (s) => s.primary_position ?? "" },
  { header: "Secondary position", width: 18, value: (s) => s.secondary_position ?? "" },
  { header: "Returning jersey #", width: 16, value: (s) => s.returning_jersey ?? "" },
  { header: "Jersey option #1", width: 15, value: (s) => s.jersey_option_1 ?? "" },
  { header: "Jersey option #2", width: 15, value: (s) => s.jersey_option_2 ?? "" },
  { header: "Jersey option #3", width: 15, value: (s) => s.jersey_option_3 ?? "" },
  {
    header: "Played in 2026",
    width: 14,
    value: (s) => (s.played_fce_2026 == null ? "" : s.played_fce_2026 ? "Yes" : "No"),
  },
  { header: "Hat size", width: 12, value: (s) => s.hat_size ?? "" },
];

/**
 * Escape one CSV field.
 *
 * Beyond the usual quoting, a value that opens with =, +, -, or @ is prefixed
 * with an apostrophe: parents type these fields on a public form, and a
 * spreadsheet treats such a value as a *formula* when it opens the file. The
 * apostrophe keeps it text. (The .xlsx export needs no such guard — its cells
 * are written as strings, and Excel only evaluates cells that are actually
 * typed as formulas.)
 */
function csvField(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/** The whole export as CSV text, CRLF-delimited the way spreadsheets expect. */
export function toCsv(rows: RosterSubmissionRow[]): string {
  const lines = [EXPORT_COLUMNS.map((c) => csvField(c.header)).join(",")];
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map((c) => csvField(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}
