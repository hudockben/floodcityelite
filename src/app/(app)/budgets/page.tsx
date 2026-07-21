import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ensureTeamsSchema } from "../teams/schema";
import { ensureSchedulesSchema } from "../schedules/schema";
import { ensureBudgetsSchema } from "./schema";
import { divisionLabel, type TeamBudgetRow } from "./budget";
import TeamBudgetCard, { type BudgetTeam } from "./team-budget-card";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let rows: TeamBudgetRow[] = [];
  let loadError = false;

  try {
    // Ensure the roster tables exist first (the FK target), then the budgets
    // and schedule tables. All idempotent and memoized.
    await ensureTeamsSchema();
    await ensureBudgetsSchema();
    await ensureSchedulesSchema();

    const result = await sql()`
      SELECT
        t.id,
        t.name,
        t.division,
        t.sport,
        (SELECT count(*) FROM players p WHERE p.team_id = t.id)::int AS player_count,
        b.tuition_per_player::float8     AS tuition_per_player,
        b.portion_to_team_budget::float8 AS portion_to_team_budget,
        b.paying_players                 AS paying_players,
        (SELECT COALESCE(SUM(e.cost), 0) FROM schedule_events e WHERE e.team_id = t.id)::float8
                                         AS scheduled_cost
      FROM teams t
      LEFT JOIN team_budgets b ON b.team_id = t.id
      WHERE t.company_id = ${session.companyId}
      ORDER BY t.division, t.name
    `;
    rows = result as TeamBudgetRow[];
  } catch (err) {
    console.error("Budgets page load error:", err);
    loadError = true;
  }

  const teams: BudgetTeam[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sport: r.sport,
    divisionLabel: divisionLabel(r.division),
    rosterCount: r.player_count,
    scheduledCost: r.scheduled_cost ?? 0,
    saved: {
      tuitionPerPlayer: r.tuition_per_player ?? 0,
      portionToTeamBudget: r.portion_to_team_budget ?? 0,
      payingPlayersOverride: r.paying_players ?? null,
    },
  }));

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Budgets</h1>
          <p>
            One budget per team. Expand a team to set tuition and the per-player
            portion that goes to the team budget — totals update as you type.
            The paying-player count comes from each team&apos;s roster on the
            Teams tab.
          </p>
        </div>
      </section>

      {loadError ? (
        <section className="panel">
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ⚠️
            </div>
            <p className="empty-title">Couldn&apos;t load budgets</p>
            <p className="empty-sub">
              The budget tables may still be getting set up. Refresh in a moment
              — if this keeps happening, run <code>npm run db:setup</code>{" "}
              against the database.
            </p>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h2 className="step-title">Team budgets</h2>
            <p>
              {teams.length} {teams.length === 1 ? "team" : "teams"}. Current
              balance is each team&apos;s starting balance minus its total
              scheduled cost from the Schedules tab.
            </p>
          </div>

          {teams.length === 0 ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true">
                📊
              </div>
              <p className="empty-title">No teams yet</p>
              <p className="empty-sub">
                Create teams on the <Link href="/teams">Teams tab</Link> and
                they&apos;ll show up here, ready to budget.
              </p>
            </div>
          ) : (
            <div className="team-groups">
              {teams.map((team) => (
                <TeamBudgetCard key={team.id} team={team} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
