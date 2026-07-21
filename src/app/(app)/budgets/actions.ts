"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
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
