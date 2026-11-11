import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DIVISIONS, resolveDivision } from "../teams/divisions";
import { resolveSeason, type Season } from "../teams/seasons";
import SeasonBar from "../teams/season-bar";
import { ensureTeamsSchema } from "../teams/schema";
import { ensureSchedulesSchema } from "../schedules/schema";
import { ensureFundraisersSchema } from "../fundraiser-tracker/schema";
import { ensureBudgetsSchema } from "./schema";
import { loadFixedCostRule } from "../fixed-cost/basis";
import { NO_FIXED_COST, type FixedCostRule } from "../fixed-cost/fixed-costs";
import {
  formatCents,
  type ExpenseRow,
  type FundraiserCreditRow,
  type TeamBudgetRow,
  type TournamentRow,
} from "./budget";
import { budgetFigures } from "./figures";
import TeamBudgetCard, { type BudgetTeam } from "./team-budget-card";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ division?: string | string[]; year?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));
  const yearRaw = firstParam(params.year);
  const yearParam = yearRaw ? Number.parseInt(yearRaw, 10) : null;

  let rows: TeamBudgetRow[] = [];
  let expenses: ExpenseRow[] = [];
  let tournaments: TournamentRow[] = [];
  let fundraisers: FundraiserCreditRow[] = [];
  let seasons: Season[] = [];
  let season: Season | null = null;
  let loadError = false;
  // How the program's fixed cost is split for the season being viewed — the
  // rule each card turns its tuition into a fixed cost per player with. A
  // team's portion of tuition is derived from that unless the team overrides
  // the portion by hand. Resolved once the season is known, below.
  let fixedCost: FixedCostRule = NO_FIXED_COST;

  try {
    // Ensure the roster tables exist first (the FK target), then the budgets,
    // schedule, and fundraiser tables — the sheet reads all four. All
    // idempotent and memoized.
    await ensureTeamsSchema();
    await ensureBudgetsSchema();
    await ensureSchedulesSchema();
    await ensureFundraisersSchema();

    // Budgets are per team, so scoping the teams to the selected season scopes
    // the whole tab (expenses and tournaments hang off those teams).
    const resolved = await resolveSeason(
      session.companyId,
      division.slug,
      yearParam,
    );
    season = resolved.current;
    seasons = resolved.seasons;
    const seasonId = resolved.current.id;

    // The fixed-cost sheet is kept per year, so this season's year picks it.
    fixedCost = await loadFixedCostRule(
      session.companyId,
      resolved.current.year,
    );

    const [budgetRows, expenseRows, tournamentRows, fundraiserRows] =
      await Promise.all([
        sql()`
          SELECT
            t.id,
            t.name,
            t.division,
            t.sport,
            (SELECT count(*) FROM players p WHERE p.team_id = t.id)::int AS player_count,
            (SELECT count(*) FROM players p
               WHERE p.team_id = t.id AND p.is_paying)::int AS paying_count,
            b.tuition_per_player::float8     AS tuition_per_player,
            b.portion_to_team_budget::float8 AS portion_to_team_budget,
            b.paying_players                 AS paying_players,
            b.fixed_cost_per_player::float8  AS fixed_cost_per_player,
            (SELECT COALESCE(SUM(e.cost), 0) FROM schedule_events e
               WHERE e.team_id = t.id AND e.status <> 'refund')::float8
                                             AS scheduled_cost
          FROM teams t
          LEFT JOIN team_budgets b ON b.team_id = t.id
          WHERE t.company_id = ${session.companyId}
            AND t.season_id = ${seasonId}
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
            AND t.season_id = ${seasonId}
          ORDER BY x.expense_date DESC NULLS LAST, x.id DESC
        `,
        // Each team's Schedules-tab tournaments, so the scheduled cost that
        // comes off the balance is itemized right under the budget. Read-only
        // here — ordered like the Schedules tab (by date) so the total matches.
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
            AND t.season_id = ${seasonId}
          ORDER BY e.event_date NULLS LAST, e.id
        `,
        // Each team's Fundraiser Tracker entries — the money raised that gets
        // credited to the balance. Scoped through the team (which carries the
        // season), so a team only ever counts what was raised for it. Both
        // player-level and whole-team entries come back; the LEFT JOIN leaves
        // player_name NULL for the latter.
        sql()`
          SELECT
            fe.id,
            fe.team_id,
            fe.raised_on::text AS raised_on,
            fe.amount::text    AS amount,
            f.name             AS fundraiser_name,
            pl.player_name
          FROM fundraiser_entries fe
          JOIN fundraisers f   ON f.id = fe.fundraiser_id
          JOIN teams t         ON t.id = fe.team_id
          LEFT JOIN players pl ON pl.id = fe.player_id
          WHERE t.company_id = ${session.companyId}
            AND t.season_id = ${seasonId}
          ORDER BY fe.raised_on DESC NULLS LAST, fe.id DESC
        `,
      ]);

    rows = budgetRows as TeamBudgetRow[];
    expenses = expenseRows as ExpenseRow[];
    tournaments = tournamentRows as TournamentRow[];
    fundraisers = fundraiserRows as FundraiserCreditRow[];
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

  // And the fundraiser entries, so each card credits only its own team's money.
  const fundraisersByTeam = new Map<number, FundraiserCreditRow[]>();
  for (const f of fundraisers) {
    const list = fundraisersByTeam.get(f.team_id);
    if (list) list.push(f);
    else fundraisersByTeam.set(f.team_id, [f]);
  }

  // Every team's total cost on the Schedules tab, added up. Summed in whole
  // cents so the division figure is exactly the team figures on the cards.
  const divisionCost = formatCents(
    rows.reduce((sum, r) => sum + Math.round((r.scheduled_cost ?? 0) * 100), 0),
  );

  const teams: BudgetTeam[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sport: r.sport,
    rosterCount: r.player_count,
    payingRosterCount: r.paying_count,
    scheduledCost: r.scheduled_cost ?? 0,
    saved: {
      tuitionPerPlayer: r.tuition_per_player ?? 0,
      // NULL (or no budget row at all) means "derive it" — see resolvePortion.
      portionToTeamBudget: r.portion_to_team_budget ?? null,
      payingPlayersOverride: r.paying_players ?? null,
      // NULL derives it from the Fixed Cost tab's split — see resolveFixedCost.
      fixedCostOverride: r.fixed_cost_per_player ?? null,
    },
    expenses: expensesByTeam.get(r.id) ?? [],
    tournaments: tournamentsByTeam.get(r.id) ?? [],
    fundraisers: fundraisersByTeam.get(r.id) ?? [],
  }));

  // The division's total balance: every set-up team's current balance from
  // what's saved, through the same arithmetic as the cards (see figures.ts), so
  // it is the sum of the balances on them. A team not set up yet shows no
  // balance, so it isn't counted. An edit on a card reaches this total when the
  // card saves, since saving refreshes the page.
  let balanceCents = 0;
  let balancedTeams = 0;
  for (const team of teams) {
    const { configured, current } = budgetFigures(team, fixedCost, team.saved);
    if (!configured) continue;
    balanceCents += Math.round(current * 100);
    balancedTeams += 1;
  }

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Budgets</h1>
          <p>
            One budget per team. Pick a division, then expand a team to set its
            tuition — totals update as you type, and the figures save themselves
            a moment after you stop. The portion of that tuition
            reaching the team budget is what&apos;s left after the program&apos;s
            fixed cost per player from the{" "}
            <Link className="inline-link" href="/fixed-cost">
              Fixed Cost
            </Link>{" "}
            tab, unless you type in either figure by hand for a team. The
            paying-player count
            comes from the players marked <strong>Paying</strong> on each
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

        {/* Season (year) selector for this division. */}
        {season ? (
          <SeasonBar
            basePath="/budgets"
            division={division.slug}
            seasons={seasons}
            current={season}
          />
        ) : null}
      </section>

      {loadError || !season ? (
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
              <h2 className="step-title">
                {season.year} {division.label} budgets
              </h2>
              <p>
                {teams.length} {teams.length === 1 ? "team" : "teams"}
                {tournaments.length > 0 ? (
                  <>
                    , with a total cost of <strong>{divisionCost}</strong> in
                    scheduled tournaments
                  </>
                ) : null}
                . Current balance is each team&apos;s starting balance minus
                its total scheduled cost from the Schedules tab and its paid
                expenses, plus everything it has raised on the{" "}
                <Link className="inline-link" href="/fundraiser-tracker">
                  Fundraiser Tracker
                </Link>{" "}
                tab.
              </p>
            </div>
            {teams.length > 0 ? (
              <a
                className="btn-secondary budgets-print-btn"
                href={`/budgets/print?division=${division.slug}&year=${season.year}`}
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
                <Link href={`/teams?division=${division.slug}&year=${season.year}`}>
                  Teams tab
                </Link>{" "}
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
                  seasonYear={season.year}
                  fixedCost={fixedCost}
                />
              ))}

              {/* Every team's current balance and total cost above, added up —
                  laid out like a team's bar, so each figure sits under the
                  column it sums. The balance counts the teams that show one. */}
              {teams.length > 1 ? (
                <div className="team-groups-total">
                  <span className="tg-caret tg-caret-spacer" aria-hidden="true" />
                  <span className="tg-grand-label">All teams</span>
                  {balancedTeams > 0 ? (
                    <span
                      className="budget-summary"
                      title="Every set-up team's current balance, added up. A team still showing Set up budget isn't counted."
                    >
                      <span className="budget-summary-label">
                        Total balance
                        {balancedTeams < teams.length
                          ? ` · ${balancedTeams} of ${teams.length} teams`
                          : ""}
                      </span>
                      <span
                        className={`budget-summary-value${balanceCents < 0 ? " bs-negative" : ""}`}
                      >
                        {formatCents(balanceCents)}
                      </span>
                    </span>
                  ) : null}
                  <span
                    className="tg-total tg-grand-total"
                    title="Total cost of every team's tournaments on the Schedules tab"
                  >
                    Total cost {divisionCost}
                  </span>
                </div>
              ) : null}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
