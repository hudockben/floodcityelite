"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DEFAULT_EXPENSE_STATUS, isExpenseStatus } from "./budget";
import { ensureBudgetsSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

// --- form-value helpers ----------------------------------------------------

// Parse a money field ("$1,200.00", "1200", "") into a non-negative number.
// Anything unparseable becomes 0 so the budget always has concrete inputs.
function money(formData: FormData, key: string): number {
  const raw = String(formData.get(key) ?? "").replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// Optional non-negative integer (the paying-player override). Blank → null,
// which tells the tab to fall back to the roster count.
function optionalCount(formData: FormData, key: string): number | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// A trimmed text field, or null when blank (for optional columns like vendor).
function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

// An <input type="date"> value ("YYYY-MM-DD"), or null when blank/malformed.
function isoDate(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "").trim();
  if (raw === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

// A positive expense amount as a fixed-2 string (so Postgres stores NUMERIC
// exactly), or null when blank / not a positive number.
function amountString(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "")
    .trim()
    .replace(/[$,]/g, "");
  if (raw === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

// --- save a team's budget inputs -------------------------------------------

export async function saveBudgetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const teamId = Number.parseInt(String(formData.get("teamId") ?? ""), 10);
  if (!Number.isFinite(teamId)) return { error: "Missing team." };

  const tuitionPerPlayer = money(formData, "tuition_per_player");
  const portionToTeamBudget = money(formData, "portion_to_team_budget");
  const payingPlayers = optionalCount(formData, "paying_players");

  try {
    await ensureBudgetsSchema();

    // Confirm the team belongs to this company before writing its budget.
    const owned = await sql()`
      SELECT id FROM teams WHERE id = ${teamId} AND company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That team no longer exists." };

    await sql()`
      INSERT INTO team_budgets (
        team_id, tuition_per_player, portion_to_team_budget, paying_players, updated_at
      ) VALUES (
        ${teamId}, ${tuitionPerPlayer}, ${portionToTeamBudget}, ${payingPlayers}, now()
      )
      ON CONFLICT (team_id) DO UPDATE SET
        tuition_per_player     = EXCLUDED.tuition_per_player,
        portion_to_team_budget = EXCLUDED.portion_to_team_budget,
        paying_players         = EXCLUDED.paying_players,
        updated_at             = now()
    `;
  } catch (err) {
    console.error("saveBudget error:", err);
    return { error: "Could not save the budget. Please try again." };
  }

  revalidatePath("/budgets");
  return { ok: true };
}

// --- log a new expense against a team --------------------------------------

export async function addExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const teamId = Number.parseInt(String(formData.get("teamId") ?? ""), 10);
  if (!Number.isFinite(teamId)) return { error: "Missing team." };

  const amount = amountString(formData, "amount");
  if (amount == null) return { error: "Enter an expense amount greater than $0." };

  const statusRaw = String(formData.get("status") ?? DEFAULT_EXPENSE_STATUS);
  const status = isExpenseStatus(statusRaw) ? statusRaw : DEFAULT_EXPENSE_STATUS;

  try {
    await ensureBudgetsSchema();

    // Confirm the team belongs to this company before logging its expense.
    const owned = await sql()`
      SELECT id FROM teams WHERE id = ${teamId} AND company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That team no longer exists." };

    await sql()`
      INSERT INTO team_expenses (team_id, expense_date, vendor, amount, status)
      VALUES (
        ${teamId},
        ${isoDate(formData, "expense_date")},
        ${text(formData, "vendor")},
        ${amount},
        ${status}
      )
    `;
  } catch (err) {
    console.error("addExpense error:", err);
    return { error: "Could not add the expense. Please try again." };
  }

  revalidatePath("/budgets");
  return { ok: true };
}

// --- edit an expense's details ---------------------------------------------

export async function updateExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const expenseId = Number.parseInt(String(formData.get("expenseId") ?? ""), 10);
  if (!Number.isFinite(expenseId)) return { error: "Missing expense." };

  const amount = amountString(formData, "amount");
  if (amount == null) return { error: "Enter an expense amount greater than $0." };

  const statusRaw = String(formData.get("status") ?? DEFAULT_EXPENSE_STATUS);
  const status = isExpenseStatus(statusRaw) ? statusRaw : DEFAULT_EXPENSE_STATUS;

  try {
    await ensureBudgetsSchema();

    // Scope the update to an expense whose team belongs to this company.
    const updated = await sql()`
      UPDATE team_expenses SET
        expense_date = ${isoDate(formData, "expense_date")},
        vendor       = ${text(formData, "vendor")},
        amount       = ${amount},
        status       = ${status},
        updated_at   = now()
      WHERE id = ${expenseId}
        AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That expense no longer exists." };
  } catch (err) {
    console.error("updateExpense error:", err);
    return { error: "Could not save changes. Please try again." };
  }

  revalidatePath("/budgets");
  return { ok: true };
}

// --- quick status change (inline dropdown) ---------------------------------

export async function updateExpenseStatusAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const expenseId = Number.parseInt(String(formData.get("expenseId") ?? ""), 10);
  const statusRaw = String(formData.get("status") ?? "");
  if (!Number.isFinite(expenseId) || !isExpenseStatus(statusRaw)) return;

  // Scope the update to an expense whose team belongs to this company.
  await sql()`
    UPDATE team_expenses SET status = ${statusRaw}, updated_at = now()
    WHERE id = ${expenseId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/budgets");
}

// --- delete an expense -----------------------------------------------------

export async function deleteExpenseAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const expenseId = Number.parseInt(String(formData.get("expenseId") ?? ""), 10);
  if (!Number.isFinite(expenseId)) return;

  // Scope the delete to an expense whose team belongs to this company.
  await sql()`
    DELETE FROM team_expenses
    WHERE id = ${expenseId}
      AND team_id IN (SELECT id FROM teams WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/budgets");
}
