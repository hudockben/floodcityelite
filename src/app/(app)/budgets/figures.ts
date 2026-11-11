// ---------------------------------------------------------------------------
// Budgets tab — a team's figures from its inputs
//
// Plain module (no "use server" / "use client"), shared by the budget card,
// which works the sheet out live from what's typed on it, and the Budgets
// page, which adds the teams' current balances up from what's saved. Both go
// through budgetFigures, so the division's total balance is always the sum of
// the balances on the cards. It lives apart from budget.ts because it needs
// the Fixed Cost tab's split, and that module imports from budget.ts.
// ---------------------------------------------------------------------------

import { fixedCostFor, type FixedCostRule } from "../fixed-cost/fixed-costs";
import {
  currentBalance,
  derivePortion,
  fundraisingPerPlayer,
  isBudgetConfigured,
  resolveFixedCost,
  resolvePayingCount,
  startingBalance,
  sumFundraisedCents,
  summarizeExpenses,
  totalTuition,
  type ExpenseRow,
  type FundraiserCreditRow,
  type SavedBudget,
} from "./budget";

/** What a team brings to its budget besides the figures typed on its card. */
export type BudgetTeamData = {
  /** Roster players marked "Paying" — the paying-player default. */
  payingRosterCount: number;
  /** Total scheduled cost for this team (Schedules tab total), in dollars. */
  scheduledCost: number;
  expenses: Pick<ExpenseRow, "amount" | "status">[];
  fundraisers: Pick<FundraiserCreditRow, "amount">[];
};

export type BudgetFigures = {
  payingCount: number;
  /** This team's piece of the program's fixed cost, per player. */
  derivedFixedCost: number;
  /** The fixed cost per player in use: hand-set, else derived. */
  fixedCostPerPlayer: number;
  /** Tuition per player less the fixed cost per player. */
  derivedPortion: number;
  /** The portion per player in use: hand-set, else derived. */
  portionNum: number;
  tuitionTotal: number;
  starting: number;
  /** Paid expenses less refunds — what the expenses take off the balance. */
  expenseNet: number;
  fundraisedCents: number;
  fundraised: number;
  current: number;
  /** Fundraising still needed per paying player. */
  fundraise: number;
  /**
   * Whether the current balance and the fundraising figure mean anything yet:
   * the team needs paying players and a tuition or a hand-set portion. Until
   * then the sheet would present un-entered fields as a deficit, so the card
   * gates those rows and its summary figure on this, and the division's total
   * balance leaves the team out. A team that *is* set up and under water shows
   * its figures — that's the shortfall the fundraising row is there to size.
   */
  configured: boolean;
};

/**
 * Every figure a team's budget sheet shows, from its inputs and the program's
 * fixed-cost split. `fixedCost` is the split as it stands with this team's
 * inputs counted in: the card swaps its own tuition in as it's typed (see
 * withTeamContribution), and the page passes the split it loaded, which
 * already counts what's saved.
 */
export function budgetFigures(
  team: BudgetTeamData,
  fixedCost: FixedCostRule,
  inputs: SavedBudget,
): BudgetFigures {
  const tuition = inputs.tuitionPerPlayer;
  const payingCount = resolvePayingCount(
    inputs.payingPlayersOverride,
    team.payingRosterCount,
  );
  // The fixed cost per player is this team's piece of the program's, unless
  // the team has its own figure typed in, which wins. The portion that reaches
  // the team budget is tuition less that, unless it's typed in by hand too.
  const derivedFixedCost = fixedCostFor(fixedCost, tuition);
  const fixedCostPerPlayer = resolveFixedCost(
    inputs.fixedCostOverride,
    derivedFixedCost,
  );
  const derivedPortion = derivePortion(tuition, fixedCostPerPlayer);
  const portionNum = inputs.portionToTeamBudget ?? derivedPortion;
  const starting = startingBalance(payingCount, portionNum);
  // Net expense impact (paid minus refunds) that comes off the starting balance
  // alongside scheduled costs. Not-paid expenses are excluded — they're tracked
  // but don't move the balance until marked paid.
  const expenseNet = summarizeExpenses(team.expenses).netCents / 100;
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
  return {
    payingCount,
    derivedFixedCost,
    fixedCostPerPlayer,
    derivedPortion,
    portionNum,
    tuitionTotal: totalTuition(payingCount, tuition),
    starting,
    expenseNet,
    fundraisedCents,
    fundraised,
    current,
    fundraise: fundraisingPerPlayer(current, payingCount),
    configured: isBudgetConfigured(
      payingCount,
      tuition,
      inputs.portionToTeamBudget,
    ),
  };
}
