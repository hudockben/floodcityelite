"use client";

import { useActionState, useEffect, useState } from "react";
import { saveBudgetAction, type FormState } from "./actions";
import {
  currentBalance,
  formatMoney,
  fundraisingPerPlayer,
  parseMoney,
  resolvePayingCount,
  startingBalance,
  totalTuition,
  type SavedBudget,
} from "./budget";
import { sportLabel, type Sport } from "../teams/divisions";

const initialState: FormState = {};

export type BudgetTeam = {
  id: number;
  name: string;
  sport: Sport;
  divisionLabel: string;
  rosterCount: number;
  /** Total scheduled cost for this team (Schedules tab total), in dollars. */
  scheduledCost: number;
  saved: SavedBudget;
};

/** Blank string ↔ null; otherwise a non-negative integer. */
function normalizeOverride(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number.parseInt(t, 10);
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
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
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
        placeholder="0.00"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export default function TeamBudgetCard({ team }: { team: BudgetTeam }) {
  const [tuition, setTuition] = useState(moneyToInput(team.saved.tuitionPerPlayer));
  const [portion, setPortion] = useState(
    moneyToInput(team.saved.portionToTeamBudget),
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
        portionToTeamBudget: parseMoney(portion),
        payingPlayersOverride: normalizeOverride(paying),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Live-computed figures (recompute every keystroke, spreadsheet-style).
  const tuitionNum = parseMoney(tuition);
  const portionNum = parseMoney(portion);
  const override = normalizeOverride(paying);
  const payingCount = resolvePayingCount(override, team.rosterCount);
  const tuitionTotal = totalTuition(payingCount, tuitionNum);
  const starting = startingBalance(payingCount, portionNum);
  // Current balance nets this team's total scheduled cost (from the Schedules
  // tab) out of the starting balance; fundraising then covers any shortfall.
  const current = currentBalance(starting, team.scheduledCost);
  const fundraise = fundraisingPerPlayer(current, payingCount);

  const dirty =
    tuitionNum !== baseline.tuitionPerPlayer ||
    portionNum !== baseline.portionToTeamBudget ||
    override !== baseline.payingPlayersOverride;

  const isConfigured =
    baseline.tuitionPerPlayer > 0 || baseline.portionToTeamBudget > 0;

  return (
    <details className="team-group budget-group">
      <summary className="team-group-summary">
        <span className="tg-caret" aria-hidden="true" />
        <span className="tg-name">{team.name}</span>
        <span className={`sport-badge sport-${team.sport}`}>
          {sportLabel(team.sport)}
        </span>
        <span className="division-badge">{team.divisionLabel}</span>
        <span className="budget-summary">
          {isConfigured ? (
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

      <form action={formAction} className="budget-body">
        <input type="hidden" name="teamId" value={team.id} />

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
                      ? `from roster (${team.rosterCount})`
                      : "manual override"}
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
                    aria-label="Number of paying players (leave blank to use the roster count)"
                    placeholder={String(team.rosterCount)}
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
                <th scope="row">Portion to team budget</th>
                <td>
                  <MoneyInput
                    name="portion_to_team_budget"
                    value={portion}
                    onChange={setPortion}
                    ariaLabel="Portion of tuition that goes to the team budget, per player"
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
                  <span className="bs-note">
                    less {formatMoney(team.scheduledCost)} scheduled
                  </span>
                </th>
                <td className={`bs-value${current < 0 ? " bs-negative" : ""}`}>
                  {formatMoney(current)}
                </td>
              </tr>

              <tr className="bs-fundraise">
                <th scope="row">Fundraising amount needed per Player</th>
                <td className="bs-value">{formatMoney(fundraise)}</td>
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
          {state?.error ? (
            <p className="error budget-msg" role="alert">
              {state.error}
            </p>
          ) : null}
          <p className="budget-hint">
            Current balance = starting balance minus this team&apos;s total
            scheduled cost on the Schedules tab. Fundraising covers any
            shortfall, split across paying players.
          </p>
        </div>
      </form>
    </details>
  );
}
