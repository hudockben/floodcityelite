"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { saveBudgetAction, type FormState } from "./actions";
import {
  currentBalance,
  derivePortion,
  formatMoney,
  fundraisingPerPlayer,
  isBudgetConfigured,
  parseMoney,
  resolvePayingCount,
  startingBalance,
  sumFundraisedCents,
  summarizeExpenses,
  totalTuition,
  type ExpenseRow,
  type FundraiserCreditRow,
  type SavedBudget,
  type TournamentRow,
} from "./budget";
import TeamExpenses from "./team-expenses";
import TeamFundraisers from "./team-fundraisers";
import TeamTournaments from "./team-tournaments";
import { sportLabel, type Sport } from "../teams/divisions";

/**
 * How long the sheet waits after the last keystroke before saving itself.
 * Long enough to type "1500" as one figure, short enough that walking away
 * from the screen leaves the figure saved.
 */
const AUTOSAVE_DELAY_MS = 800;

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
  /** This team's Fundraiser Tracker entries (newest first); read-only here. */
  fundraisers: FundraiserCreditRow[];
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

/** Do two sets of budget inputs hold the same figures? */
function sameBudget(a: SavedBudget, b: SavedBudget): boolean {
  return (
    a.tuitionPerPlayer === b.tuitionPerPlayer &&
    a.portionToTeamBudget === b.portionToTeamBudget &&
    a.payingPlayersOverride === b.payingPlayersOverride
  );
}

/**
 * The payload saveBudgetAction expects. Built by hand rather than serialized
 * from the form, so a save can be fired from anywhere — a debounce, a blur, or
 * the card unmounting as the coach clicks another tab.
 */
function budgetFormData(teamId: number, values: SavedBudget): FormData {
  const fd = new FormData();
  fd.set("teamId", String(teamId));
  fd.set("tuition_per_player", String(values.tuitionPerPlayer));
  // Blank ⇒ NULL ⇒ "derive it" for both overrides (see budget.ts).
  fd.set(
    "portion_to_team_budget",
    values.portionToTeamBudget == null ? "" : String(values.portionToTeamBudget),
  );
  fd.set(
    "paying_players",
    values.payingPlayersOverride == null
      ? ""
      : String(values.payingPlayersOverride),
  );
  return fd;
}

function MoneyInput({
  name,
  value,
  onChange,
  onBlur,
  ariaLabel,
  placeholder = "0.00",
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
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
        onBlur={onBlur}
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

  // What's on screen vs. what's in the database. `persisted` drives the render
  // (so the status reads right); `persistedRef` is the copy the save loop reads,
  // since that runs outside React's render.
  const [persisted, setPersisted] = useState<SavedBudget>(team.saved);
  const persistedRef = useRef<SavedBudget>(team.saved);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

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
  // Money this team has raised on the Fundraiser Tracker tab. It's a credit, so
  // logging an entry there lifts the balance the moment the page reloads.
  const fundraisedCents = sumFundraisedCents(team.fundraisers);
  const fundraised = fundraisedCents / 100;
  // Current balance nets this team's total scheduled cost (from the Schedules
  // tab) and its net expenses out of the starting balance and credits back what
  // it has raised; fundraising then covers whatever shortfall is left.
  const current = currentBalance(
    starting,
    team.scheduledCost,
    expenseNet,
    fundraised,
  );
  const fundraise = fundraisingPerPlayer(current, payingCount);

  // The figures as typed, kept in a ref so the save loop, the debounce timer and
  // the unmount handler all read what's on screen *now* rather than whatever was
  // current when they were created.
  const values: SavedBudget = {
    tuitionPerPlayer: tuitionNum,
    portionToTeamBudget: portionOverride,
    payingPlayersOverride: override,
  };
  const latest = useRef<SavedBudget>(values);
  latest.current = values;

  const dirty = !sameBudget(values, persisted);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  // False once the card has unmounted, so an in-flight save doesn't call
  // setState on a component that's gone.
  const alive = useRef(true);

  /**
   * Write whatever is on screen. Loops until the saved copy matches it, so
   * edits made while a save was in flight get their own write instead of
   * sitting there unsaved. Only one loop runs at a time; a call that arrives
   * mid-save can return, because the running loop re-reads `latest` after every
   * write and there is no await between that check and releasing the lock.
   */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (saving.current) return;
    saving.current = true;
    try {
      while (!sameBudget(latest.current, persistedRef.current)) {
        const snapshot = latest.current;
        if (alive.current) {
          setStatus("saving");
          setError(null);
        }
        let result: FormState;
        try {
          result = await saveBudgetAction({}, budgetFormData(team.id, snapshot));
        } catch {
          // A dropped connection never reaches the action's own error handling,
          // and silence here is exactly the "it just didn't stick" this is meant
          // to stop.
          result = {
            error:
              "the save couldn't reach the server. Check your connection — your figures are still on screen.",
          };
        }
        if (!result?.ok) {
          if (alive.current) {
            setError(result?.error ?? "Could not save the budget.");
            setStatus("error");
          }
          // Leave it dirty: the figures stay on screen and Save budget retries.
          return;
        }
        persistedRef.current = snapshot;
        if (alive.current) {
          setPersisted(snapshot);
          setStatus("saved");
          setError(null);
        }
      }
    } finally {
      saving.current = false;
    }
  }, [team.id]);

  /** Save shortly after the coach stops typing. */
  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, AUTOSAVE_DELAY_MS);
  }, [flush]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      // Leaving the tab is the moment this bug used to bite: a figure typed and
      // then abandoned mid-debounce. The request outlives the component, so fire
      // it without waiting for it. A save already in flight is left alone — its
      // loop re-reads the figures once it lands and writes them itself.
      if (!saving.current && !sameBudget(latest.current, persistedRef.current)) {
        void saveBudgetAction(
          {},
          budgetFormData(team.id, latest.current),
        ).catch(() => {});
      }
    };
  }, [team.id]);

  // Closing the tab or a hard reload can't be saved through, so say so rather
  // than dropping the figures silently. Only armed while something is unsaved.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const saveStatus =
    status === "error"
      ? { text: "Not saved", className: "bss-error" }
      : status === "saving"
        ? { text: "Saving…", className: "bss-saving" }
        : dirty
          ? { text: "Unsaved", className: "bss-dirty" }
          : status === "saved"
            ? { text: "Saved", className: "bss-saved" }
            : null;

  // Current balance / fundraising are only meaningful once the team has real
  // inputs (paying players AND a tuition or portion override). Until then the
  // sheet would present un-entered fields as a deficit, so we gate those rows
  // and the summary figure on it. A team that *is* set up and under water shows
  // its figures — that's the shortfall the fundraising row is there to size.
  const configured = isBudgetConfigured(payingCount, tuitionNum, portionOverride);

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
          <form
            className="budget-col-sheet"
            onSubmit={(e) => {
              // Enter in a field, or the Save button, writes immediately.
              e.preventDefault();
              void flush();
            }}
          >
            {/* Above the sheet on purpose: the Save button sits under a tall
                table, so a failure reported down there is easy to scroll past
                and read as "my figure just didn't stick". */}
            {error ? (
              <p className="error budget-save-error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="budget-sheet-scroll">
              <table className="budget-sheet">
                <tbody>
                  <tr className="bs-head">
                    <th colSpan={2} scope="colgroup">
                      {/* The section header doubles as the sheet's save
                          readout, so it sits beside the fields it reports on
                          rather than below the table. */}
                      <span className="bs-head-live">
                        <span>Team Budget</span>
                        <span
                          className={`bs-save-status${saveStatus ? ` ${saveStatus.className}` : ""}`}
                          role="status"
                          aria-live="polite"
                        >
                          {saveStatus?.text ?? ""}
                        </span>
                      </span>
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
                        onChange={(e) => {
                          setPaying(e.target.value);
                          schedule();
                        }}
                        onBlur={() => void flush()}
                      />
                    </td>
                  </tr>

                  <tr>
                    <th scope="row">Tuition Per Player</th>
                    <td>
                      <MoneyInput
                        name="tuition_per_player"
                        value={tuition}
                        onChange={(v) => {
                          setTuition(v);
                          schedule();
                        }}
                        onBlur={() => void flush()}
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
                        {portionOverride != null ? (
                          `manual override · auto would be ${formatMoney(derivedPortion)}`
                        ) : tuitionNum <= 0 ? (
                          "tuition less the fixed cost per player — enter a tuition above"
                        ) : derivedPortion < 0 ? (
                          // Under water: the tuition doesn't cover the program's
                          // fixed cost per player, so every player signed puts
                          // the team further down. Say it in those terms — the
                          // figure is a real shortfall, not a missing number.
                          <>
                            {formatMoney(fixedCostPerPlayer)} fixed cost per
                            player is more than the {formatMoney(tuitionNum)}{" "}
                            tuition — every player starts the team{" "}
                            {formatMoney(-derivedPortion)} down. Check the
                            divisor on the{" "}
                            <Link className="bs-note-link" href="/fixed-cost">
                              Fixed Cost
                            </Link>{" "}
                            tab
                          </>
                        ) : (
                          `${formatMoney(tuitionNum)} tuition less ${formatMoney(fixedCostPerPlayer)} fixed cost = ${formatMoney(derivedPortion)}`
                        )}
                      </span>
                    </th>
                    <td>
                      <MoneyInput
                        name="portion_to_team_budget"
                        value={portion}
                        onChange={(v) => {
                          setPortion(v);
                          schedule();
                        }}
                        onBlur={() => void flush()}
                        // Only offer the derived figure once there's a tuition
                        // to derive it from; before that it's just the fixed
                        // cost back as a negative, which reads as nonsense in a
                        // field that takes a positive amount.
                        placeholder={
                          tuitionNum > 0 ? derivedPortion.toFixed(2) : "0.00"
                        }
                        ariaLabel="Portion of tuition that goes to the team budget, per player (leave blank to use tuition minus the fixed cost per player)"
                      />
                    </td>
                  </tr>

                  <tr className="bs-total">
                    <th scope="row">
                      Starting Balance-Team Budget
                      {configured && starting < 0 ? (
                        <span className="bs-note">
                          the team opens the season this far down — the
                          fundraising figure below covers it
                        </span>
                      ) : null}
                    </th>
                    {/* Gated like the rows below it: with no tuition entered
                        there is nothing but the fixed cost to subtract, and
                        reporting that as the team's opening deficit would be
                        reading a number the coach hasn't typed yet. */}
                    {configured ? (
                      <td className={`bs-value${starting < 0 ? " bs-negative" : ""}`}>
                        {formatMoney(starting)}
                      </td>
                    ) : (
                      <td className="bs-value bs-idle">
                        <span className="bs-muted">—</span>
                      </td>
                    )}
                  </tr>

                  <tr>
                    <th scope="row">
                      Fundraising raised
                      <span className="bs-note">
                        {fundraisedCents > 0 ? (
                          <>
                            {team.fundraisers.length}{" "}
                            {team.fundraisers.length === 1 ? "entry" : "entries"}{" "}
                            on the{" "}
                            <Link
                              className="bs-note-link"
                              href="/fundraiser-tracker"
                            >
                              Fundraiser Tracker
                            </Link>{" "}
                            tab — credited to the balance
                          </>
                        ) : (
                          <>
                            nothing raised yet — log it on the{" "}
                            <Link
                              className="bs-note-link"
                              href="/fundraiser-tracker"
                            >
                              Fundraiser Tracker
                            </Link>{" "}
                            tab
                          </>
                        )}
                      </span>
                    </th>
                    {/* Nothing raised isn't a credit worth colouring, so $0.00
                        takes the muted deduction-row grey instead of green. */}
                    <td
                      className={`bs-value ${
                        fundraisedCents > 0 ? "bs-credit" : "bs-deduct"
                      }`}
                    >
                      {fundraisedCents > 0 ? "+" : ""}
                      {formatMoney(fundraised)}
                    </td>
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
                          {fundraised > 0
                            ? ` · plus ${formatMoney(fundraised)} raised`
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
                    <th scope="row">
                      Fundraising amount needed per Player
                      {configured && fundraisedCents > 0 ? (
                        <span className="bs-note">
                          what&apos;s still needed — the{" "}
                          {formatMoney(fundraised)} already raised is off this
                          figure
                        </span>
                      ) : null}
                    </th>
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
                disabled={status === "saving" || !dirty}
              >
                {status === "saving"
                  ? "Saving…"
                  : dirty
                    ? "Save budget"
                    : "Saved"}
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
                These figures save themselves a moment after you stop typing, and
                again as you leave the field — the button is only there to write
                them right now. Portion to team budget = tuition per player minus
                the program&apos;s fixed cost per player, unless you type a
                figure here to override it for this team. Current balance =
                starting balance minus this team&apos;s total scheduled cost on
                the Schedules tab and its paid expenses (less refunds), plus
                what it has raised on the Fundraiser Tracker tab. Fundraising
                covers whatever shortfall is left, split across paying players.
              </p>
            </div>
          </form>

          <div className="budget-col-expenses">
            <TeamFundraisers fundraisers={team.fundraisers} />
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
