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
import {
  SCHEDULE_HEADERS,
  costToCents,
  formatCents,
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
  let loadError = false;

  try {
    // Create the schedule_events table on first use so the tab works even if
    // the database predates this feature. Idempotent and memoized.
    await ensureSchedulesSchema();

    const [teamRows, eventRows] = await Promise.all([
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
    ]);

    teams = teamRows as ScheduleTeamRow[];
    events = eventRows as ScheduleEventRow[];
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
            <div className="panel-head">
              <h2 className="step-title">{division.label} schedule</h2>
              <p>
                {events.length} {events.length === 1 ? "event" : "events"} across{" "}
                {teams.length} {teams.length === 1 ? "team" : "teams"}.
              </p>
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
                  const totalCents = teamEvents.reduce(
                    (sum, e) => sum + costToCents(e.cost),
                    0,
                  );
                  const total = formatCents(totalCents);
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
                                />
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="sched-total-row">
                                <td colSpan={4} className="sched-total-label">
                                  Total Cost
                                </td>
                                <td className="col-cost sched-total-value">
                                  {total}
                                </td>
                                <td colSpan={2} />
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
