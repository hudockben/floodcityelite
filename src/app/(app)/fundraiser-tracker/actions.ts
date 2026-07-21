"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ensureFundraisersSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

// --- form-value helpers ----------------------------------------------------

// A money value: strips "$" and thousands separators, keeps two decimals, and
// rejects negatives. Returned as a fixed-2 string so Postgres stores it as
// NUMERIC(10,2) exactly, or null when blank. NUMERIC(10,2) also caps the value
// at 99,999,999.99.
function money(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/[$,]/g, "");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999.99) return null;
  return n.toFixed(2);
}

// event_date comes from an <input type="date"> as "YYYY-MM-DD" (or empty).
function isoDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// --- create a fundraiser ---------------------------------------------------

export async function addFundraiserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a fundraiser name." };

  // Goal is optional, but if something was typed it must be a valid amount.
  const rawGoal = String(formData.get("goal") ?? "").trim();
  const goal = money(rawGoal);
  if (rawGoal !== "" && goal === null) return { error: "Enter a valid goal amount." };

  try {
    await ensureFundraisersSchema();

    await sql()`
      INSERT INTO fundraisers (company_id, name, goal, event_date)
      VALUES (
        ${session.companyId},
        ${name.slice(0, 160)},
        ${goal},
        ${isoDate(formData.get("event_date"))}
      )
    `;
  } catch (err) {
    console.error("addFundraiser error:", err);
    return { error: "Could not create the fundraiser. Please try again." };
  }

  revalidatePath("/fundraiser-tracker");
  return { ok: true };
}

// --- delete a fundraiser (and its entries, via ON DELETE CASCADE) ----------

export async function deleteFundraiserAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const fundraiserId = Number.parseInt(String(formData.get("fundraiserId") ?? ""), 10);
  if (!Number.isFinite(fundraiserId)) return;

  await sql()`
    DELETE FROM fundraisers
    WHERE id = ${fundraiserId} AND company_id = ${session.companyId}
  `;

  revalidatePath("/fundraiser-tracker");
}

// --- log a fundraiser entry against a player + fundraiser ------------------

export type EntryInput = {
  playerId: number | string;
  fundraiserId: number | string;
  raisedOn: string;
  amount: number | string;
};

export async function addFundraiserEntryAction(
  input: EntryInput,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const playerId = Number.parseInt(String(input.playerId ?? ""), 10);
  if (!Number.isFinite(playerId)) return { error: "Choose a player for this entry." };

  const fundraiserId = Number.parseInt(String(input.fundraiserId ?? ""), 10);
  if (!Number.isFinite(fundraiserId)) return { error: "Choose a fundraiser for this entry." };

  const raisedOn = String(input.raisedOn ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raisedOn)) return { error: "Pick a valid date." };

  const amount = money(input.amount);
  if (amount === null) return { error: "Enter a valid amount raised." };

  try {
    await ensureFundraisersSchema();

    // Confirm the player exists and belongs to this company before inserting.
    const ownedPlayer = await sql()`
      SELECT pl.id
      FROM players pl
      JOIN teams t ON t.id = pl.team_id
      WHERE pl.id = ${playerId} AND t.company_id = ${session.companyId}
    `;
    if (ownedPlayer.length === 0) return { error: "That player no longer exists." };

    // Confirm the fundraiser exists and belongs to this company too.
    const ownedFundraiser = await sql()`
      SELECT id FROM fundraisers
      WHERE id = ${fundraiserId} AND company_id = ${session.companyId}
    `;
    if (ownedFundraiser.length === 0) return { error: "That fundraiser no longer exists." };

    await sql()`
      INSERT INTO fundraiser_entries (fundraiser_id, player_id, raised_on, amount)
      VALUES (${fundraiserId}, ${playerId}, ${raisedOn}, ${amount})
    `;
  } catch (err) {
    console.error("addFundraiserEntry error:", err);
    return { error: "Could not save the entry. Please try again." };
  }

  revalidatePath("/fundraiser-tracker");
  return { ok: true };
}

// --- delete a fundraiser entry ---------------------------------------------

export async function deleteFundraiserEntryAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const entryId = Number.parseInt(String(formData.get("entryId") ?? ""), 10);
  if (!Number.isFinite(entryId)) return;

  // Scope the delete to an entry whose player's team belongs to this company.
  await sql()`
    DELETE FROM fundraiser_entries
    WHERE id = ${entryId}
      AND player_id IN (
        SELECT pl.id
        FROM players pl
        JOIN teams t ON t.id = pl.team_id
        WHERE t.company_id = ${session.companyId}
      )
  `;

  revalidatePath("/fundraiser-tracker");
}
