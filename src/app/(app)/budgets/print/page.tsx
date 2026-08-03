import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { resolveDivision, sportLabel } from "../../teams/divisions";
import { resolveSeason, type Season } from "../../teams/seasons";
import { ensureTeamsSchema } from "../../teams/schema";
import { ensureSchedulesSchema } from "../../schedules/schema";
import { ensureFundraisersSchema } from "../../fundraiser-tracker/schema";
import { eventCostCounts, statusLabel } from "../../schedules/events";
import { ensureBudgetsSchema } from "../schema";
import { loadFixedCostPerPlayer } from "../../fixed-cost/basis";
import {
  amountToCents,
  currentBalance,
  expenseStatusLabel,
  formatCents,
  formatDate,
  formatDateRange,
  formatMoney,
  fundraisingPerPlayer,
  isBudgetConfigured,
  resolvePayingCount,
  resolvePortion,
  startingBalance,
  sumFundraisedCents,
  summarizeExpenses,
  totalTuition,
  type ExpenseRow,
  type FundraiserCreditRow,
  type TeamBudgetRow,
  type TournamentRow,
} from "../budget";
import PrintControls from "./print-controls";

export const dynamic = "force-dynamic";

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

export default async function BudgetPrintPage({
  searchParams,
}: {
  searchParams: Promise<{
    division?: string | string[];
    team?: string | string[];
    year?: string | string[];
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const division = resolveDivision(firstParam(params.division));
  const teamParam = firstParam(params.team);
  const teamId = teamParam ? Number.parseInt(teamParam, 10) : null;
  const yearRaw = firstParam(params.year);
  const yearParam = yearRaw ? Number.parseInt(yearRaw, 10) : null;

  let rows: TeamBudgetRow[] = [];
  let expenses: ExpenseRow[] = [];
  let tournaments: TournamentRow[] = [];
  let fundraisers: FundraiserCreditRow[] = [];
  let season: Season | null = null;
  let loadError = false;
  // Same figure the on-screen sheet subtracts, so the printout matches it —
  // resolved from the season's year once that's known, below.
  let fixedCostPerPlayer = 0;

  try {
    await ensureTeamsSchema();
    await ensureBudgetsSchema();
    await ensureSchedulesSchema();
    await ensureFundraisersSchema();

    const resolved = await resolveSeason(
      session.companyId,
      division.slug,
      yearParam,
    );
    season = resolved.current;
    const seasonId = resolved.current.id;

    fixedCostPerPlayer = await loadFixedCostPerPlayer(
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
        // Each team's scheduled tournaments, itemized so the printed report
        // shows exactly what makes up the "less scheduled cost" line.
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
        // And each team's Fundraiser Tracker entries, itemized the same way so
        // the "plus fundraising raised" line shows where the credit came from.
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
    console.error("Budget print load error:", err);
    loadError = true;
  }

  // Narrow to a single team when ?team= is supplied (per-team print).
  if (teamId != null && Number.isFinite(teamId)) {
    rows = rows.filter((r) => r.id === teamId);
  }

  const expensesByTeam = new Map<number, ExpenseRow[]>();
  for (const e of expenses) {
    const list = expensesByTeam.get(e.team_id);
    if (list) list.push(e);
    else expensesByTeam.set(e.team_id, [e]);
  }

  const tournamentsByTeam = new Map<number, TournamentRow[]>();
  for (const t of tournaments) {
    const list = tournamentsByTeam.get(t.team_id);
    if (list) list.push(t);
    else tournamentsByTeam.set(t.team_id, [t]);
  }

  const fundraisersByTeam = new Map<number, FundraiserCreditRow[]>();
  for (const f of fundraisers) {
    const list = fundraisersByTeam.get(f.team_id);
    if (list) list.push(f);
    else fundraisersByTeam.set(f.team_id, [f]);
  }

  const backHref = season
    ? `/budgets?division=${division.slug}&year=${season.year}`
    : `/budgets?division=${division.slug}`;
  const divisionScope = season
    ? `${season.year} ${division.label}`
    : division.label;
  const scopeLabel =
    rows.length === 1 && teamId != null ? rows[0].name : divisionScope;

  return (
    <div className="print-view">
      <PrintControls backHref={backHref} />

      <article className="print-doc">
        <header className="print-doc-head">
          <div>
            <p className="print-brand">Flood City Elite</p>
            <h1 className="print-doc-title">Team Budget Report</h1>
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
            Couldn&apos;t load the budgets. Please return to the Budgets tab and
            try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="print-note">No teams to report in {division.label}.</p>
        ) : (
          rows.map((r) => {
            const payingCount = resolvePayingCount(
              r.paying_players ?? null,
              r.paying_count,
            );
            const tuitionPer = r.tuition_per_player ?? 0;
            // Same rule as the on-screen sheet: a saved figure is this team's
            // override, otherwise tuition less the fixed cost per player.
            const portion = resolvePortion(
              r.portion_to_team_budget ?? null,
              tuitionPer,
              fixedCostPerPlayer,
            );
            const tuitionTotal = totalTuition(payingCount, tuitionPer);
            const starting = startingBalance(payingCount, portion);
            const scheduled = r.scheduled_cost ?? 0;
            const teamTournaments = tournamentsByTeam.get(r.id) ?? [];
            const scheduledCents = teamTournaments.reduce(
              (sum, t) =>
                sum + (eventCostCounts(t.status) ? amountToCents(t.cost) : 0),
              0,
            );
            const teamExpenses = expensesByTeam.get(r.id) ?? [];
            const totals = summarizeExpenses(teamExpenses);
            const expenseNet = totals.netCents / 100;
            // What this team has raised on the Fundraiser Tracker tab — a
            // credit to the balance, exactly as the on-screen sheet counts it.
            const teamFundraisers = fundraisersByTeam.get(r.id) ?? [];
            const fundraisedCents = sumFundraisedCents(teamFundraisers);
            const fundraised = fundraisedCents / 100;
            const current = currentBalance(
              starting,
              scheduled,
              expenseNet,
              fundraised,
            );
            const fundraise = fundraisingPerPlayer(current, payingCount);
            // Same rule as the on-screen sheet: real inputs, not a positive
            // balance — a team under water still reports its figures.
            const configured = isBudgetConfigured(
              payingCount,
              tuitionPer,
              r.portion_to_team_budget ?? null,
            );

            return (
              <section className="print-team" key={r.id}>
                <div className="print-team-head">
                  <h2 className="print-team-name">{r.name}</h2>
                  <span className="print-badge">{sportLabel(r.sport)}</span>
                  {configured ? (
                    <span
                      className={`print-team-balance${
                        current < 0 ? " neg" : ""
                      }`}
                    >
                      {formatMoney(current)}
                      <small>current balance</small>
                    </span>
                  ) : (
                    <span className="print-team-balance idle">
                      Budget not set up
                    </span>
                  )}
                </div>

                <div className="print-cols">
                  {/* Budget breakdown */}
                  <div className="print-scroll">
                    {/* A table wider than the paper scrolls inside the
                        report on a phone rather than bursting out of it.
                        Inert when printing — see @media screen. */}
                    <table className="print-budget">
                      <tbody>
                        <tr className="ph">
                          <th colSpan={2}>Team Budget</th>
                        </tr>
                        <tr>
                          <th># of paying players</th>
                          <td>{payingCount}</td>
                        </tr>
                        <tr>
                          <th>Tuition per player</th>
                          <td>{formatMoney(tuitionPer)}</td>
                        </tr>
                        <tr className="pt">
                          <th>Total team tuition</th>
                          <td>{formatMoney(tuitionTotal)}</td>
                        </tr>

                        <tr className="ph">
                          <th colSpan={2}>Player Expense</th>
                        </tr>
                        {fixedCostPerPlayer > 0 ? (
                          <tr>
                            <th>Fixed cost per player</th>
                            <td>−{formatMoney(fixedCostPerPlayer)}</td>
                          </tr>
                        ) : null}
                        {/* Both are gated like the balance rows below: with no
                            tuition entered there's only the fixed cost to
                            subtract, and printing that as the team's opening
                            deficit reports a figure nobody entered. */}
                        <tr>
                          <th>Portion to team budget</th>
                          <td className={portion < 0 ? "neg" : undefined}>
                            {configured ? formatMoney(portion) : "—"}
                          </td>
                        </tr>
                        <tr className="pt">
                          <th>Starting balance — team budget</th>
                          <td className={starting < 0 ? "neg" : undefined}>
                            {configured ? formatMoney(starting) : "—"}
                          </td>
                        </tr>
                        <tr>
                          <th>Less scheduled cost</th>
                          <td>
                            {scheduled > 0 ? "−" : ""}
                            {formatMoney(scheduled)}
                          </td>
                        </tr>
                        <tr>
                          <th>Less expenses (net of refunds)</th>
                          <td>
                            {expenseNet > 0 ? "−" : expenseNet < 0 ? "+" : ""}
                            {formatMoney(Math.abs(expenseNet))}
                          </td>
                        </tr>
                        <tr>
                          <th>Plus fundraising raised</th>
                          <td>
                            {fundraisedCents > 0 ? "+" : ""}
                            {formatMoney(fundraised)}
                          </td>
                        </tr>
                        <tr className="pcur">
                          <th>Current balance</th>
                          <td className={current < 0 ? "neg" : undefined}>
                            {configured ? formatMoney(current) : "—"}
                          </td>
                        </tr>
                        <tr className="pfund">
                          <th>Fundraising needed per player</th>
                          <td>{configured ? formatMoney(fundraise) : "—"}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Right column: what the team raised, then its scheduled
                      tournaments, then the expense log */}
                  <div className="print-expenses">
                    <div className="print-fundraisers">
                      <h3 className="print-sub">Fundraising</h3>
                      {teamFundraisers.length === 0 ? (
                        <p className="print-note small">
                          Nothing raised for this team.
                        </p>
                      ) : (
                        <div className="print-scroll">
                          {/* A table wider than the paper scrolls inside the
                              report on a phone rather than bursting out of it.
                              Inert when printing — see @media screen. */}
                          <table className="print-exp-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Fundraiser</th>
                                <th>Raised by</th>
                                <th className="amt">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {teamFundraisers.map((f) => (
                                <tr key={f.id}>
                                  <td>{formatDate(f.raised_on)}</td>
                                  <td>{f.fundraiser_name}</td>
                                  <td>{f.player_name ?? "Whole team"}</td>
                                  <td className="amt">
                                    {formatCents(amountToCents(f.amount))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="net">
                                <td colSpan={3}>Total raised (credited)</td>
                                <td className="amt">
                                  {fundraisedCents > 0 ? "+" : ""}
                                  {formatCents(fundraisedCents)}
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="print-schedule">
                      <h3 className="print-sub">Scheduled tournaments</h3>
                      {teamTournaments.length === 0 ? (
                        <p className="print-note small">
                          No tournaments scheduled.
                        </p>
                      ) : (
                        <div className="print-scroll">
                          {/* A table wider than the paper scrolls inside the
                              report on a phone rather than bursting out of it.
                              Inert when printing — see @media screen. */}
                          <table className="print-exp-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Tournament</th>
                                <th className="amt">Cost</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {teamTournaments.map((t) => {
                                const meta = [t.event_host, t.location]
                                  .filter(Boolean)
                                  .join(" · ");
                                return (
                                  <tr key={t.id}>
                                    <td>
                                      {formatDateRange(
                                        t.event_date,
                                        t.event_end_date,
                                      )}
                                    </td>
                                    <td>
                                      {t.event_name}
                                      {meta ? (
                                        <span className="print-tour-meta">
                                          {meta}
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className="amt">
                                      {t.cost == null || t.cost === "" ? (
                                        "—"
                                      ) : eventCostCounts(t.status) ? (
                                        formatCents(amountToCents(t.cost))
                                      ) : (
                                        <span className="cost-refunded">
                                          {formatCents(amountToCents(t.cost))}
                                        </span>
                                      )}
                                    </td>
                                    <td>{statusLabel(t.status)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                            <tfoot>
                              <tr className="net">
                                <td colSpan={2}>Total scheduled cost</td>
                                <td className="amt">
                                  {scheduledCents > 0 ? "−" : ""}
                                  {formatCents(scheduledCents)}
                                </td>
                                <td />
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </div>

                    <h3 className="print-sub">Expenses</h3>
                    {teamExpenses.length === 0 ? (
                      <p className="print-note small">No expenses logged.</p>
                    ) : (
                      <div className="print-scroll">
                        {/* A table wider than the paper scrolls inside the
                            report on a phone rather than bursting out of it.
                            Inert when printing — see @media screen. */}
                        <table className="print-exp-table">
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Vendor</th>
                              <th className="amt">Total Cost</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {teamExpenses.map((e) => (
                              <tr key={e.id}>
                                <td>{formatDate(e.expense_date)}</td>
                                <td>{e.vendor ?? "—"}</td>
                                <td className="amt">
                                  {formatCents(amountToCents(e.amount))}
                                </td>
                                <td>{expenseStatusLabel(e.status)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td colSpan={2}>Paid (deducted)</td>
                              <td className="amt">
                                {totals.paidCents > 0 ? "−" : ""}
                                {formatCents(totals.paidCents)}
                              </td>
                              <td />
                            </tr>
                            <tr>
                              <td colSpan={2}>Refunds (credited)</td>
                              <td className="amt">
                                {totals.refundCents > 0 ? "+" : ""}
                                {formatCents(totals.refundCents)}
                              </td>
                              <td />
                            </tr>
                            {totals.notPaidCents > 0 ? (
                              <tr>
                                <td colSpan={2}>Not paid (tracked only)</td>
                                <td className="amt">
                                  {formatCents(totals.notPaidCents)}
                                </td>
                                <td />
                              </tr>
                            ) : null}
                            <tr className="net">
                              <td colSpan={2}>Net off budget</td>
                              <td className="amt">
                                {totals.netCents > 0
                                  ? "−"
                                  : totals.netCents < 0
                                    ? "+"
                                    : ""}
                                {formatCents(Math.abs(totals.netCents))}
                              </td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            );
          })
        )}
      </article>
    </div>
  );
}
