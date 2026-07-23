import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  DIVISIONS,
  resolveDivision,
  sportLabel,
} from "../teams/divisions";
import { ensureSchedulesSchema } from "./schema";
import AddEventForm from "./add-event-form";
import EventRow from "./event-row";
import RotationPlanner from "./rotation-planner";
import {
  COST_FIELD_INDEX,
  SCHEDULE_HEADERS,
  costToCents,
  eventCostCounts,
  formatCents,
  type AttendanceRow,
  type GroupPlayer,
  type ScheduleEventRow,
  type ScheduleTeamRow,
} from "./events";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));

  let teams: ScheduleTeamRow[] = [];
  let events: ScheduleEventRow[] = [];
  let roster: GroupPlayer[] = [];
  let attendance: AttendanceRow[] = [];
  let loadError = false;

  try {
    // Create the schedule_events table on first use so the tab works even if
    // the database predates this feature. Idempotent and memoized.
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
      // The roster for each team in this division, so an event's Groups panel
      // can list who's available and the planner knows the roster size.
      sql()`
        SELECT p.id, p.team_id, p.player_name, p.primary_position
        FROM players p
        JOIN teams t ON t.id = p.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY t.name, p.player_name
      `,
      // Only the "sitting" decisions — a player attends an event unless a row
      // marks them attending = false, so this is all we need to reconstruct
      // each event's group and every player's appearance count.
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
    console.error("Schedules page load error:", err);
    loadError = true;
  }

  const teamOptions = teams.map((t) => ({
    id: t.id,
    name: t.name,
    sport: t.sport,
  }));

  // Group events by team so each team can be shown as a collapsible schedule.
  const eventsByTeam = new Map<number, ScheduleEventRow[]>();
  for (const e of events) {
    const list = eventsByTeam.get(e.team_id);
    if (list) list.push(e);
    else eventsByTeam.set(e.team_id, [e]);
  }

  // Group the roster by team for the Groups panels and the planner.
  const playersByTeam = new Map<number, GroupPlayer[]>();
  for (const p of roster) {
    const list = playersByTeam.get(p.team_id);
    if (list) list.push(p);
    else playersByTeam.set(p.team_id, [p]);
  }

  // Who's sitting out each event (event_id -> set of benched player ids).
  const benchByEvent = new Map<number, Set<number>>();
  for (const a of attendance) {
    const set = benchByEvent.get(a.event_id);
    if (set) set.add(a.player_id);
    else benchByEvent.set(a.event_id, new Set([a.player_id]));
  }

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Schedules</h1>
          <p>
            Pick a division, then expand a team to see its tournament schedule
            and running cost. Add tournaments below.
          </p>
        </div>

        {/* Division selector */}
        <nav className="subtabs" aria-label="Division">
          {DIVISIONS.map((d) => {
            const active = d.slug === division.slug;
            return (
              <Link
                key={d.slug}
                href={`/schedules?division=${d.slug}`}
                className={`subtab${active ? " active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {d.label}
              </Link>
            );
          })}
        </nav>
      </section>

      {loadError ? (
        <section className="panel">
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ⚠️
            </div>
            <p className="empty-title">Couldn&apos;t load schedules</p>
            <p className="empty-sub">
              The schedule tables may still be getting set up. Refresh in a
              moment — if this keeps happening, run <code>npm run db:setup</code>{" "}
              against the database.
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* Add a tournament to a team in this division */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">+</span> Add a tournament
              </h2>
              <p>
                Choose a {division.label} team and fill in the event details —
                only the event name is required.
              </p>
            </div>

            <AddEventForm division={division.slug} teams={teamOptions} />
          </section>

          {/* Schedule by team */}
          <section className="panel">
            <div className="panel-head panel-head-row">
              <div>
                <h2 className="step-title">{division.label} schedule</h2>
                <p>
                  {events.length} {events.length === 1 ? "event" : "events"}{" "}
                  across {teams.length} {teams.length === 1 ? "team" : "teams"}.
                </p>
              </div>
              {teams.length > 0 ? (
                <a
                  className="btn-secondary print-all-btn"
                  href={`/schedules/print?division=${division.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  🖨 Print all / Save PDF
                </a>
              ) : null}
            </div>

            {teams.length === 0 ? (
              <div className="empty">
                <div className="empty-icon" aria-hidden="true">
                  🗓️
                </div>
                <p className="empty-title">No teams in this division yet</p>
                <p className="empty-sub">
                  Create a team in the{" "}
                  <Link href={`/teams?division=${division.slug}`}>Teams tab</Link>{" "}
                  first, then come back to build out its schedule.
                </p>
              </div>
            ) : (
              <div className="team-groups">
                {teams.map((t) => {
                  const teamEvents = eventsByTeam.get(t.id) ?? [];
                  const teamPlayers = playersByTeam.get(t.id) ?? [];
                  // Refunded events are credited back, so their cost drops out
                  // of the running total (matches the Budgets scheduled cost).
                  const totalCents = teamEvents.reduce(
                    (sum, e) =>
                      sum + (eventCostCounts(e.status) ? costToCents(e.cost) : 0),
                    0,
                  );
                  const total = formatCents(totalCents);

                  // Each player's appearances so far: every one of the team's
                  // events they're not sitting out.
                  const playerAttendance = teamPlayers.map((p) => ({
                    id: p.id,
                    player_name: p.player_name,
                    attending: teamEvents.filter(
                      (e) => !(benchByEvent.get(e.id)?.has(p.id) ?? false),
                    ).length,
                  }));
                  return (
                    <details key={t.id} className="team-group">
                      <summary className="team-group-summary">
                        <span className="tg-caret" aria-hidden="true" />
                        <span className="tg-name">{t.name}</span>
                        <span className={`sport-badge sport-${t.sport}`}>
                          {sportLabel(t.sport)}
                        </span>
                        <span className="tg-count">
                          {teamEvents.length}{" "}
                          {teamEvents.length === 1 ? "event" : "events"}
                        </span>
                        <span className="tg-total" title="Total schedule cost">
                          Total {total}
                        </span>
                      </summary>

                      {teamEvents.length > 0 ? (
                        <div className="tg-print-row">
                          <a
                            className="team-print-link"
                            href={`/schedules/print?division=${division.slug}&team=${t.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            🖨 Print / Save PDF
                          </a>
                        </div>
                      ) : null}

                      <RotationPlanner
                        rosterSize={teamPlayers.length}
                        scheduledEvents={teamEvents.length}
                        players={playerAttendance}
                      />

                      {teamEvents.length === 0 ? (
                        <p className="tg-empty">
                          No tournaments scheduled yet — add one above.
                        </p>
                      ) : (
                        <div className="roster-scroll">
                          <table className="sched">
                            <thead>
                              <tr>
                                {SCHEDULE_HEADERS.map((h) => (
                                  <th key={h}>{h}</th>
                                ))}
                                <th className="col-actions">
                                  <span className="sr-only">Actions</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {teamEvents.map((row) => (
                                <EventRow
                                  key={row.id}
                                  event={row}
                                  division={division.slug}
                                  players={teamPlayers}
                                  benchedIds={[
                                    ...(benchByEvent.get(row.id) ?? []),
                                  ]}
                                />
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="sched-total-row">
                                <td
                                  colSpan={COST_FIELD_INDEX}
                                  className="sched-total-label"
                                >
                                  Total Cost
                                </td>
                                <td className="col-cost sched-total-value">
                                  {total}
                                </td>
                                <td
                                  colSpan={SCHEDULE_HEADERS.length - COST_FIELD_INDEX}
                                />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
