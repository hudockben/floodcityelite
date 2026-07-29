"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { ITEM_NAME_MAX, SECTION_NAME_MAX } from "./fixed-costs";
import { ensureFixedCostSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

// Every write here moves the fixed cost per player, which the Budgets tab
// subtracts from tuition and Homeplate uses for its at-risk figures — so those
// pages are refreshed alongside this one.
function revalidateAll(): void {
  revalidatePath("/fixed-cost");
  revalidatePath("/budgets");
  revalidatePath("/homeplate");
}

// --- form-value helpers ----------------------------------------------------

function name(formData: FormData, key: string, max: number): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value.slice(0, max);
}

// A fixed-cost amount as a fixed-2 string so Postgres stores NUMERIC(12,2)
// exactly, or null when blank / not a valid non-negative amount. The ceiling
// mirrors the column's precision.
function amount(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/[$,]/g, "");
  if (s === "") return null;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999.99) return null;
  return n.toFixed(2);
}

// --- sections --------------------------------------------------------------

export async function addSectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const sectionName = name(formData, "name", SECTION_NAME_MAX);
  if (!sectionName) return { error: "Name the section." };

  try {
    await ensureFixedCostSchema();
    await sql()`
      INSERT INTO fixed_cost_sections (company_id, name)
      VALUES (${session.companyId}, ${sectionName})
    `;
  } catch (err) {
    console.error("addSection error:", err);
    return { error: "Could not add the section. Please try again." };
  }

  revalidateAll();
  return { ok: true };
}

export async function renameSectionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const sectionId = Number.parseInt(String(formData.get("sectionId") ?? ""), 10);
  const sectionName = name(formData, "name", SECTION_NAME_MAX);

  if (!Number.isFinite(sectionId)) return { error: "Missing section." };
  if (!sectionName) return { error: "Name the section." };

  try {
    await ensureFixedCostSchema();
    const updated = await sql()`
      UPDATE fixed_cost_sections
      SET name = ${sectionName}, updated_at = now()
      WHERE id = ${sectionId} AND company_id = ${session.companyId}
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That section no longer exists." };
  } catch (err) {
    console.error("renameSection error:", err);
    return { error: "Could not rename the section. Please try again." };
  }

  revalidateAll();
  return { ok: true };
}

// Deleting a section takes its line items with it (ON DELETE CASCADE).
export async function deleteSectionAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const sectionId = Number.parseInt(String(formData.get("sectionId") ?? ""), 10);
  if (!Number.isFinite(sectionId)) return;

  await sql()`
    DELETE FROM fixed_cost_sections
    WHERE id = ${sectionId} AND company_id = ${session.companyId}
  `;

  revalidateAll();
}

// --- line items ------------------------------------------------------------

export async function addItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const sectionId = Number.parseInt(String(formData.get("sectionId") ?? ""), 10);
  const itemName = name(formData, "name", ITEM_NAME_MAX);
  const raw = String(formData.get("amount") ?? "").trim();
  const value = amount(raw);

  if (!Number.isFinite(sectionId)) return { error: "Missing section." };
  if (!itemName) return { error: "Name the cost." };
  if (raw !== "" && value === null) return { error: "Enter a valid amount." };

  try {
    await ensureFixedCostSchema();

    // Scope the insert to a section owned by this company.
    const owned = await sql()`
      SELECT id FROM fixed_cost_sections
      WHERE id = ${sectionId} AND company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That section no longer exists." };

    await sql()`
      INSERT INTO fixed_cost_items (section_id, name, amount)
      VALUES (${sectionId}, ${itemName}, ${value ?? "0.00"})
    `;
  } catch (err) {
    console.error("addItem error:", err);
    return { error: "Could not add the cost. Please try again." };
  }

  revalidateAll();
  return { ok: true };
}

export async function updateItemAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const itemId = Number.parseInt(String(formData.get("itemId") ?? ""), 10);
  const itemName = name(formData, "name", ITEM_NAME_MAX);
  const raw = String(formData.get("amount") ?? "").trim();
  const value = amount(raw);

  if (!Number.isFinite(itemId)) return { error: "Missing cost." };
  if (!itemName) return { error: "Name the cost." };
  if (raw !== "" && value === null) return { error: "Enter a valid amount." };

  try {
    await ensureFixedCostSchema();

    // Scope the update to an item whose section belongs to this company.
    const updated = await sql()`
      UPDATE fixed_cost_items
      SET name = ${itemName}, amount = ${value ?? "0.00"}, updated_at = now()
      WHERE id = ${itemId}
        AND section_id IN (
          SELECT id FROM fixed_cost_sections WHERE company_id = ${session.companyId}
        )
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That cost no longer exists." };
  } catch (err) {
    console.error("updateItem error:", err);
    return { error: "Could not save the cost. Please try again." };
  }

  revalidateAll();
  return { ok: true };
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const itemId = Number.parseInt(String(formData.get("itemId") ?? ""), 10);
  if (!Number.isFinite(itemId)) return;

  await sql()`
    DELETE FROM fixed_cost_items
    WHERE id = ${itemId}
      AND section_id IN (
        SELECT id FROM fixed_cost_sections WHERE company_id = ${session.companyId}
      )
  `;

  revalidateAll();
}

// --- the player count the fixed cost is split across -----------------------

export async function savePlayerCountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  // Blank clears the override and falls back to the roster count.
  const raw = String(formData.get("player_count") ?? "").trim();
  let count: number | null = null;
  if (raw !== "") {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return { error: "Enter a whole number of players." };
    count = n;
  }

  try {
    await ensureFixedCostSchema();
    await sql()`
      INSERT INTO fixed_cost_settings (company_id, player_count, updated_at)
      VALUES (${session.companyId}, ${count}, now())
      ON CONFLICT (company_id) DO UPDATE SET
        player_count = EXCLUDED.player_count,
        updated_at   = now()
    `;
  } catch (err) {
    console.error("savePlayerCount error:", err);
    return { error: "Could not save the player count. Please try again." };
  }

  revalidateAll();
  return { ok: true };
}
