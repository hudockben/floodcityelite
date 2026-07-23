import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DIVISIONS, resolveDivision } from "../teams/divisions";
import { ensureTeamsSchema } from "../teams/schema";
import { ensureSchedulesSchema } from "../schedules/schema";
import { ensureBudgetsSchema } from "./schema";
import { type ExpenseRow, type TeamBudgetRow, type TournamentRow } from "./budget";
import TeamBudgetCard, { type BudgetTeam } from "./team-budget-card";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));

  let rows: TeamBudgetRow[] = [];
  let expenses: ExpenseRow[] = [];
  let tournaments: TournamentRow[] = [];
  let loadError = false;

  try {
    // Ensure the roster tables exist first (the FK target), then the budgets
    // and schedule tables. All idempotent and memoized.
    await ensureTeamsSchema();
    await ensureBudgetsSchema();
    await ensureSchedulesSchema();

    const [budgetRows, expenseRows, tournamentRows] = await Promise.all([
      sql()`
        SELECT
          t.id,
          t.name,
          t.division,
          t.sport,
          (SELECT count(*) FROM players p WHERE p.team_id = t.id)::int AS player_count,
          b.tuition_per_player::float8     AS tuition_per_player,
          b.portion_to_team_budget::float8 AS portion_to_team_budget,
          b.paying_players                 AS paying_players,
          (SELECT COALESCE(SUM(e.cost), 0) FROM schedule_events e
             WHERE e.team_id = t.id AND e.status <> 'refund')::float8
                                           AS scheduled_cost
        FROM teams t
        LEFT JOIN team_budgets b ON b.team_id = t.id
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY t.name
      `,
      sql()`
        SELECT
          x.id,
          x.team_id,
          x.expense_date::text AS expense_date,
          x.vendor,
          x.amount::text       AS amount,
          x.status
        FROM team_expenses x
        JOIN teams t ON t.id = x.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY x.expense_date DESC NULLS LAST, x.id DESC
      `,
      // Each team's Schedules-tab tournaments, so the scheduled cost that comes
      // off the balance is itemized right under the budget. Read-only here —
      // ordered like the Schedules tab (by date) for a familiar, matching total.
      sql()`
        SELECT
          e.id,
          e.team_id,
          e.event_host,
          e.event_date::text     AS event_date,
          e.event_end_date::text AS event_end_date,
          e.event_name,
          e.location,
          e.cost::text           AS cost,
          e.status
        FROM schedule_events e
        JOIN teams t ON t.id = e.team_id
        WHERE t.company_id = ${session.companyId}
          AND t.division = ${division.slug}
        ORDER BY e.event_date NULLS LAST, e.id
      `,
    ]);

    rows = budgetRows as TeamBudgetRow[];
    expenses = expenseRows as ExpenseRow[];
    tournaments = tournamentRows as TournamentRow[];
  } catch (err) {
    console.error("Budgets page load error:", err);
    loadError = true;
  }

  // Group each team's expenses so every card gets just its own rows.
  const expensesByTeam = new Map<number, ExpenseRow[]>();
  for (const e of expenses) {
    const list = expensesByTeam.get(e.team_id);
    if (list) list.push(e);
    else expensesByTeam.set(e.team_id, [e]);
  }

  // Group the scheduled tournaments the same way so each card lists only its
  // own team's events under the expense section.
  const tournamentsByTeam = new Map<number, TournamentRow[]>();
  for (const t of tournaments) {
    const list = tournamentsByTeam.get(t.team_id);
    if (list) list.push(t);
    else tournamentsByTeam.set(t.team_id, [t]);
  }

  const teams: BudgetTeam[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sport: r.sport,
    rosterCount: r.player_count,
    scheduledCost: r.scheduled_cost ?? 0,
    saved: {
      tuitionPerPlayer: r.tuition_per_player ?? 0,
      portionToTeamBudget: r.portion_to_team_budget ?? 0,
      payingPlayersOverride: r.paying_players ?? null,
    },
    expenses: expensesByTeam.get(r.id) ?? [],
    tournaments: tournamentsByTeam.get(r.id) ?? [],
  }));

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Budgets</h1>
          <p>
            One budget per team. Pick a division, then expand a team to set
            tuition and the per-player portion that goes to the team budget —
            totals update as you type. The paying-player count comes from each
            team&apos;s roster on the Teams tab.
          </p>
        </div>

        {/* Division selector */}
        <nav className="subtabs" aria-label="Division">
          {DIVISIONS.map((d) => {
            const active = d.slug === division.slug;
            return (
              <Link
                key={d.slug}
                href={`/budgets?division=${d.slug}`}
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
          <div className="panel-head budgets-panel-head">
            <div>
              <h2 className="step-title">{division.label} budgets</h2>
              <p>
                {teams.length} {teams.length === 1 ? "team" : "teams"}. Current
                balance is each team&apos;s starting balance minus its total
                scheduled cost from the Schedules tab and its paid expenses.
              </p>
            </div>
            {teams.length > 0 ? (
              <a
                className="btn-secondary budgets-print-btn"
                href={`/budgets/print?division=${division.slug}`}
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
                📊
              </div>
              <p className="empty-title">No teams in this division yet</p>
              <p className="empty-sub">
                Create a team in the{" "}
                <Link href={`/teams?division=${division.slug}`}>Teams tab</Link>{" "}
                and it&apos;ll show up here, ready to budget.
              </p>
            </div>
          ) : (
            <div className="team-groups">
              {teams.map((team) => (
                <TeamBudgetCard
                  key={team.id}
                  team={team}
                  division={division.slug}
                />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
