"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { saveBudgetAction, type FormState } from "./actions";
import {
  currentBalance,
  derivePortion,
  formatMoney,
  fundraisingPerPlayer,
  parseMoney,
  resolvePayingCount,
  startingBalance,
  summarizeExpenses,
  totalTuition,
  type ExpenseRow,
  type SavedBudget,
  type TournamentRow,
} from "./budget";
import TeamExpenses from "./team-expenses";
import TeamTournaments from "./team-tournaments";
import { sportLabel, type Sport } from "../teams/divisions";

const initialState: FormState = {};

export type BudgetTeam = {
  id: number;
  name: string;
  sport: Sport;
  /** Total roster size (shown alongside the paying count for context). */
  rosterCount: number;
  /** Roster players marked "Paying" — the paying-player default. */
  payingRosterCount: number;
  /** Total scheduled cost for this team (Schedules tab total), in dollars. */
  scheduledCost: number;
  saved: SavedBudget;
  /** Expenses logged against this team (newest first). */
  expenses: ExpenseRow[];
  /** This team's Schedules-tab tournaments (by date); read-only here. */
  tournaments: TournamentRow[];
};

/** Blank string ↔ null; otherwise a non-negative integer. */
function normalizeOverride(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Blank string ↔ null; otherwise a non-negative amount (the portion override). */
function normalizeMoneyOverride(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number.parseFloat(t.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function moneyToInput(n: number): string {
  return n === 0 ? "" : String(n);
}

function MoneyInput({
  name,
  value,
  onChange,
  ariaLabel,
  placeholder = "0.00",
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
  placeholder?: string;
}) {
  return (
    <div className="budget-money">
      <span className="budget-money-sign" aria-hidden="true">
        $
      </span>
      <input
        className="budget-input budget-input-money"
        name={name}
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        placeholder={placeholder}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function TeamBudgetCard({
  team,
  division,
  seasonYear,
  fixedCostPerPlayer,
}: {
  team: BudgetTeam;
  division: string;
  seasonYear: number;
  /** The program's fixed cost per player, from the Fixed Cost tab. */
  fixedCostPerPlayer: number;
}) {
  const [tuition, setTuition] = useState(moneyToInput(team.saved.tuitionPerPlayer));
  // Blank means "derive it" — the placeholder shows what that comes to.
  const [portion, setPortion] = useState(
    team.saved.portionToTeamBudget == null
      ? ""
      : String(team.saved.portionToTeamBudget),
  );
  const [paying, setPaying] = useState(
    team.saved.payingPlayersOverride == null
      ? ""
      : String(team.saved.payingPlayersOverride),
  );

  // Baseline the saved values so the Save button only lights up on real edits.
  const [baseline, setBaseline] = useState<SavedBudget>(team.saved);

  const [state, formAction, pending] = useActionState(
    saveBudgetAction,
    initialState,
  );

  // After a successful save, the persisted values become the new baseline.
  useEffect(() => {
    if (state?.ok) {
      setBaseline({
        tuitionPerPlayer: parseMoney(tuition),
        portionToTeamBudget: normalizeMoneyOverride(portion),
        payingPlayersOverride: normalizeOverride(paying),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Live-computed figures (recompute every keystroke, spreadsheet-style).
  const tuitionNum = parseMoney(tuition);
  // The portion is derived from tuition minus the program's fixed cost per
  // player unless this team overrides it by typing one in.
  const portionOverride = normalizeMoneyOverride(portion);
  const derivedPortion = derivePortion(tuitionNum, fixedCostPerPlayer);
  const portionNum = portionOverride ?? derivedPortion;
  const override = normalizeOverride(paying);
  const payingCount = resolvePayingCount(override, team.payingRosterCount);
  const tuitionTotal = totalTuition(payingCount, tuitionNum);
  const starting = startingBalance(payingCount, portionNum);
  // Net expense impact (paid minus refunds) that comes off the starting balance
  // alongside scheduled costs. Not-paid expenses are excluded — they're tracked
  // but don't move the balance until marked paid.
  const expenseTotals = summarizeExpenses(team.expenses);
  const expenseNet = expenseTotals.netCents / 100;
  // Current balance nets this team's total scheduled cost (from the Schedules
  // tab) and its net expenses out of the starting balance; fundraising then
  // covers any shortfall.
  const current = currentBalance(starting, team.scheduledCost, expenseNet);
  const fundraise = fundraisingPerPlayer(current, payingCount);

  const dirty =
    tuitionNum !== baseline.tuitionPerPlayer ||
    portionOverride !== baseline.portionToTeamBudget ||
    override !== baseline.payingPlayersOverride;

  // Current balance / fundraising are only meaningful once the team has a real
  // starting-balance basis (a per-player portion AND paying players). Until
  // then the sheet would present un-entered inputs as a deficit, so we gate
  // those rows and the summary figure on it.
  const configured = starting > 0;

  return (
    <details className="team-group budget-group">
      <summary className="team-group-summary">
        <span className="tg-caret" aria-hidden="true" />
        <span className="tg-name">{team.name}</span>
        <span className={`sport-badge sport-${team.sport}`}>
          {sportLabel(team.sport)}
        </span>
        <span className="budget-summary">
          {configured ? (
            <>
              <span className="budget-summary-label">Current balance</span>
              <span
                className={`budget-summary-value${current < 0 ? " bs-negative" : ""}`}
              >
                {formatMoney(current)}
              </span>
            </>
          ) : (
            <span className="budget-summary-empty">Set up budget</span>
          )}
        </span>
      </summary>

      <div className="budget-body">
        <div className="budget-columns">
          <form action={formAction} className="budget-col-sheet">
            <input type="hidden" name="teamId" value={team.id} />

            {/* Above the sheet on purpose: the Save button sits under a tall
                table, so a failure reported down there is easy to scroll past
                and read as "my figure just didn't stick". */}
            {state?.error ? (
              <p className="error budget-save-error" role="alert">
                {state.error}
              </p>
            ) : null}

            <div className="budget-sheet-scroll">
              <table className="budget-sheet">
                <tbody>
                  <tr className="bs-head">
                    <th colSpan={2} scope="colgroup">
                      Team Budget
                    </th>
                  </tr>

                  <tr>
                    <th scope="row">
                      # of paying Players
                      <span className="bs-note">
                        {override == null
                          ? `from roster (${team.payingRosterCount} of ${team.rosterCount} marked paying)`
                          : `manual override · roster has ${team.payingRosterCount} marked paying`}
                      </span>
                    </th>
                    <td>
                      <input
                        className="budget-input"
                        name="paying_players"
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        aria-label="Number of paying players (leave blank to use the count marked Paying on the roster)"
                        placeholder={String(team.payingRosterCount)}
                        value={paying}
                        onChange={(e) => setPaying(e.target.value)}
                      />
                    </td>
                  </tr>

                  <tr>
                    <th scope="row">Tuition Per Player</th>
                    <td>
                      <MoneyInput
                        name="tuition_per_player"
                        value={tuition}
                        onChange={setTuition}
                        ariaLabel="Tuition per player"
                      />
                    </td>
                  </tr>

                  <tr className="bs-total">
                    <th scope="row">Total Team Tuition</th>
                    <td className="bs-value">{formatMoney(tuitionTotal)}</td>
                  </tr>

                  <tr className="bs-head">
                    <th colSpan={2} scope="colgroup">
                      Player Expense
                    </th>
                  </tr>

                  <tr>
                    <th scope="row">
                      Fixed cost per player
                      <span className="bs-note">
                        {fixedCostPerPlayer > 0 ? (
                          <>
                            from the{" "}
                            <Link className="bs-note-link" href="/fixed-cost">
                              Fixed Cost
                            </Link>{" "}
                            tab
                          </>
                        ) : (
                          // Zero covers two cases — no costs logged, and costs
                          // logged with nobody to split them across — so the
                          // note says what's true of both rather than guessing.
                          <>
                            nothing to deduct — see the{" "}
                            <Link className="bs-note-link" href="/fixed-cost">
                              Fixed Cost
                            </Link>{" "}
                            tab
                          </>
                        )}
                      </span>
                    </th>
                    <td className="bs-value bs-deduct">
                      {fixedCostPerPlayer > 0 ? "−" : ""}
                      {formatMoney(fixedCostPerPlayer)}
                    </td>
                  </tr>

                  <tr>
                    <th scope="row">
                      Portion to team budget
                      <span className="bs-note">
                        {portionOverride == null
                          ? `tuition less the fixed cost per player (${formatMoney(derivedPortion)})`
                          : `manual override · auto would be ${formatMoney(derivedPortion)}`}
                      </span>
                    </th>
                    <td>
                      <MoneyInput
                        name="portion_to_team_budget"
                        value={portion}
                        onChange={setPortion}
                        placeholder={String(derivedPortion.toFixed(2))}
                        ariaLabel="Portion of tuition that goes to the team budget, per player (leave blank to use tuition minus the fixed cost per player)"
                      />
                    </td>
                  </tr>

                  <tr className="bs-total">
                    <th scope="row">Starting Balance-Team Budget</th>
                    <td className="bs-value">{formatMoney(starting)}</td>
                  </tr>

                  <tr className="bs-current">
                    <th scope="row">
                      Current Balance
                      {configured ? (
                        <span className="bs-note">
                          less {formatMoney(team.scheduledCost)} scheduled
                          {expenseNet > 0
                            ? ` · ${formatMoney(expenseNet)} expenses`
                            : expenseNet < 0
                              ? ` · ${formatMoney(-expenseNet)} net refund`
                              : ""}
                        </span>
                      ) : null}
                    </th>
                    {configured ? (
                      <td className={`bs-value${current < 0 ? " bs-negative" : ""}`}>
                        {formatMoney(current)}
                      </td>
                    ) : (
                      <td className="bs-value bs-idle">
                        <span className="bs-muted">Set up the budget above</span>
                      </td>
                    )}
                  </tr>

                  <tr className="bs-fundraise">
                    <th scope="row">Fundraising amount needed per Player</th>
                    {configured ? (
                      <td className="bs-value">{formatMoney(fundraise)}</td>
                    ) : (
                      <td className="bs-value bs-idle">
                        <span className="bs-muted">—</span>
                      </td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="budget-actions">
              <button
                type="submit"
                className="btn budget-save-btn"
                disabled={pending || !dirty}
              >
                {pending ? "Saving…" : dirty ? "Save budget" : "Saved"}
              </button>
              <a
                className="budget-print-link"
                href={`/budgets/print?division=${division}&team=${team.id}&year=${seasonYear}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                🖨 Print / Save PDF
              </a>
              <p className="budget-hint">
                Portion to team budget = tuition per player minus the program&apos;s
                fixed cost per player, unless you type a figure here to override
                it for this team. Current balance = starting balance minus this
                team&apos;s total scheduled cost on the Schedules tab and its paid
                expenses (less refunds). Fundraising covers any shortfall, split
                across paying players.
              </p>
            </div>
          </form>

          <div className="budget-col-expenses">
            <TeamTournaments
              tournaments={team.tournaments}
              division={division}
              seasonYear={seasonYear}
            />
            <TeamExpenses
              teamId={team.id}
              division={division}
              expenses={team.expenses}
            />
          </div>
        </div>
      </div>
    </details>
  );
}
