import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { resolveDivision, sportLabel } from "../../teams/divisions";
import { ensureSchedulesSchema } from "../schema";
import {
  EVENT_FIELDS,
  formatDate,
  type AttendanceRow,
  type GroupPlayer,
  type ScheduleEventRow,
  type ScheduleTeamRow,
} from "../events";
import PrintControls from "./print-controls";

export const dynamic = "force-dynamic";

// The printed schedule is parent-facing, so it deliberately leaves out the
// cost column, every money total, and the registration status that the
// on-screen Schedules tab shows.
const PRINT_EVENT_FIELDS = EVENT_FIELDS.filter((f) => f.type !== "money");

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Deterministic "Month D, YYYY" for the generated-on line (UTC, no locale).
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function todayLabel(): string {
  const d = new Date();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// Compact "Jul 3" for the rotation grid's column headers (dates only, no year
// or locale so it stays narrow and matches the deterministic date handling).
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return `${MONTHS_SHORT[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** Format a single schedule cell the way the on-screen table does: dates as
 *  "Jul 21, 2026", everything else verbatim; empty -> em dash. The cost column
 *  is dropped from the printout entirely, so money isn't handled here. */
function cellValue(
  field: (typeof EVENT_FIELDS)[number],
  event: ScheduleEventRow,
): string {
  const value = event[field.key as keyof ScheduleEventRow];
  if (value == null || value === "") return "—";
  if (field.type === "date") return formatDate(String(value));
  return String(value);
}

export default async function SchedulesPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string | string[]; team?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));
  const teamParam = firstParam(params.team);
  const teamId = teamParam ? Number.parseInt(teamParam, 10) : null;

  let teams: ScheduleTeamRow[] = [];
  let events: ScheduleEventRow[] = [];
  let roster: GroupPlayer[] = [];
  let attendance: AttendanceRow[] = [];
  let loadError = false;

  try {
    await ensureSchedulesSchema();

    const [teamRows, eventRows, playerRows, attendanceRows] = await Promise.all([
      sql()`
        SELECT
          t.id,
          t.name,
          t.division,
          t.sport,
          (SELECT count(*) FROM schedule_events e WHERE e.team_id = t.id)::int AS event_count
        FROM teams t
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY t.name
      `,
      sql()`
        SELECT
          e.id,
          e.team_id,
          e.event_host,
          e.event_date::text AS event_date,
          e.event_end_date::text AS event_end_date,
          e.event_name,
          e.location,
          e.cost::text AS cost,
          e.status
        FROM schedule_events e
        JOIN teams t ON t.id = e.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY t.name, e.event_date NULLS LAST, e.id
      `,
      // Roster for each team so the rotation grid can list every player.
      sql()`
        SELECT p.id, p.team_id, p.player_name, p.primary_position
        FROM players p
        JOIN teams t ON t.id = p.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY t.name, p.player_name
      `,
      // Only the "sitting" decisions — a player plays an event unless a row
      // marks them attending = false — enough to fill in the grid.
      sql()`
        SELECT a.event_id, a.player_id, a.attending
        FROM event_attendance a
        JOIN schedule_events e ON e.id = a.event_id
        JOIN teams t ON t.id = e.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
          AND a.attending = false
      `,
    ]);

    teams = teamRows as ScheduleTeamRow[];
    events = eventRows as ScheduleEventRow[];
    roster = playerRows as GroupPlayer[];
    attendance = attendanceRows as AttendanceRow[];
  } catch (err) {
    console.error("Schedules print load error:", err);
    loadError = true;
  }

  // Narrow to a single team when ?team= is supplied (per-team print).
  if (teamId != null && Number.isFinite(teamId)) {
    teams = teams.filter((t) => t.id === teamId);
  }
  const teamIds = new Set(teams.map((t) => t.id));

  const eventsByTeam = new Map<number, ScheduleEventRow[]>();
  for (const e of events) {
    if (!teamIds.has(e.team_id)) continue;
    const list = eventsByTeam.get(e.team_id);
    if (list) list.push(e);
    else eventsByTeam.set(e.team_id, [e]);
  }

  // Roster per team, and who's sitting out each event, for the rotation grid.
  const playersByTeam = new Map<number, GroupPlayer[]>();
  for (const p of roster) {
    if (!teamIds.has(p.team_id)) continue;
    const list = playersByTeam.get(p.team_id);
    if (list) list.push(p);
    else playersByTeam.set(p.team_id, [p]);
  }

  const benchByEvent = new Map<number, Set<number>>();
  for (const a of attendance) {
    const set = benchByEvent.get(a.event_id);
    if (set) set.add(a.player_id);
    else benchByEvent.set(a.event_id, new Set([a.player_id]));
  }

  // Total number of events across the teams being printed (all of them, or the
  // single one for a per-team print). Costs are intentionally left off the
  // parent-facing printout, so there's no money total here.
  const eventTotal = teams.reduce(
    (n, t) => n + (eventsByTeam.get(t.id) ?? []).length,
    0,
  );

  const backHref = `/schedules?division=${division.slug}`;
  const scopeLabel =
    teams.length === 1 && teamId != null ? teams[0].name : division.label;

  return (
    <div className="print-view">
      <PrintControls backHref={backHref} />

      <article className="print-doc">
        <header className="print-doc-head">
          <div>
            <p className="print-brand">Flood City Elite</p>
            <h1 className="print-doc-title">Tournament Schedule</h1>
            <p className="print-doc-scope">{scopeLabel}</p>
          </div>
          <p className="print-doc-meta">
            Generated {todayLabel()}
            <br />
            {session.companyName}
          </p>
        </header>

        {loadError ? (
          <p className="print-note">
            Couldn&apos;t load the schedule. Please return to the Schedules tab
            and try again.
          </p>
        ) : teams.length === 0 ? (
          <p className="print-note">No teams to report in {division.label}.</p>
        ) : (
          <>
            {teams.map((t) => {
              const teamEvents = eventsByTeam.get(t.id) ?? [];
              const teamPlayers = playersByTeam.get(t.id) ?? [];
              return (
                <section className="print-team" key={t.id}>
                  <div className="print-team-head">
                    <h2 className="print-team-name">{t.name}</h2>
                    <span className="print-badge">{sportLabel(t.sport)}</span>
                    <span className="print-team-count">
                      {teamEvents.length}{" "}
                      {teamEvents.length === 1 ? "event" : "events"}
                    </span>
                  </div>

                  {teamEvents.length === 0 ? (
                    <p className="print-note small">
                      No tournaments scheduled.
                    </p>
                  ) : (
                    <table className="print-sched">
                      <thead>
                        <tr>
                          {PRINT_EVENT_FIELDS.map((f) => (
                            <th key={f.key}>{f.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {teamEvents.map((e) => (
                          <tr key={e.id}>
                            {PRINT_EVENT_FIELDS.map((f) => (
                              <td
                                key={f.key}
                                className={
                                  f.key === "event_name" ? "col-name" : undefined
                                }
                              >
                                {cellValue(f, e)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {/* Rotation grid: every roster player against every
                      tournament, with a ✓ where they're playing plus per-player
                      and per-tournament totals — the "who's playing and when"
                      sheet. Only shown when there's a roster and a schedule. */}
                  {teamPlayers.length > 0 && teamEvents.length > 0 ? (
                    <div className="print-groups">
                      <h3 className="print-groups-title">Who&apos;s playing</h3>
                      <div className="print-grid-scroll">
                        <table className="print-grid">
                          <thead>
                            <tr>
                              <th className="pg-player">Player</th>
                              {teamEvents.map((e) => (
                                <th key={e.id} className="pg-evt">
                                  <span className="pg-evt-date">
                                    {shortDate(e.event_date) || "—"}
                                  </span>
                                  <span className="pg-evt-name">
                                    {e.event_name}
                                  </span>
                                </th>
                              ))}
                              <th className="pg-total">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teamPlayers.map((p) => {
                              const played = teamEvents.filter(
                                (e) =>
                                  !(benchByEvent.get(e.id)?.has(p.id) ?? false),
                              ).length;
                              return (
                                <tr key={p.id}>
                                  <td className="pg-player">{p.player_name}</td>
                                  {teamEvents.map((e) => {
                                    const playing = !(
                                      benchByEvent.get(e.id)?.has(p.id) ?? false
                                    );
                                    return (
                                      <td
                                        key={e.id}
                                        className={playing ? "pg-in" : "pg-out"}
                                      >
                                        {playing ? "✓" : "–"}
                                      </td>
                                    );
                                  })}
                                  <td className="pg-total">{played}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td className="pg-player">Playing</td>
                              {teamEvents.map((e) => {
                                const benched = benchByEvent.get(e.id);
                                const count = teamPlayers.reduce(
                                  (n, p) => n + (benched?.has(p.id) ? 0 : 1),
                                  0,
                                );
                                return (
                                  <td key={e.id} className="pg-count">
                                    {count}
                                  </td>
                                );
                              })}
                              <td className="pg-total" />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                      <p className="print-groups-legend">
                        ✓ = playing · Total = tournaments per player
                      </p>
                    </div>
                  ) : null}
                </section>
              );
            })}

            {teams.length > 1 ? (
              <section className="print-grand">
                <span className="print-grand-label">
                  {division.label} — {eventTotal}{" "}
                  {eventTotal === 1 ? "event" : "events"} across {teams.length}{" "}
                  {teams.length === 1 ? "team" : "teams"}
                </span>
              </section>
            ) : null}
          </>
        )}
      </article>
    </div>
  );
}
