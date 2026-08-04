"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DEFAULT_EXPENSE_STATUS, isExpenseStatus, isPaymentType } from "./camps";
import { ensureCampsSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

// --- form-value helpers ----------------------------------------------------

function text(formData: FormData, key: string): string | null {
  const value = String(formData.get(key) ?? "").trim();
  return value === "" ? null : value;
}

// event_date comes from an <input type="date"> as "YYYY-MM-DD" (or empty).
function isoDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// A positive expense amount as a fixed-2 string (so Postgres stores NUMERIC
// exactly), or null when blank / not a positive number. Matches the Budgets
// tab's handling so an expense behaves the same on either tab.
function amountString(formData: FormData, key: string): string | null {
  const raw = String(formData.get(key) ?? "")
    .trim()
    .replace(/[$,]/g, "");
  if (raw === "") return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
}

// The expense status from the form, falling back to the default rather than
// rejecting an unrecognized value.
function expenseStatus(formData: FormData): string {
  const raw = String(formData.get("status") ?? DEFAULT_EXPENSE_STATUS);
  return isExpenseStatus(raw) ? raw : DEFAULT_EXPENSE_STATUS;
}

// --- create a camp ---------------------------------------------------------

export async function addCampAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const name = text(formData, "name");
  if (!name) return { error: "Enter a camp name." };

  try {
    await ensureCampsSchema();

    await sql()`
      INSERT INTO camps (company_id, name, location, event_date)
      VALUES (
        ${session.companyId},
        ${name.slice(0, 160)},
        ${text(formData, "location")},
        ${isoDate(formData.get("event_date"))}
      )
    `;
  } catch (err) {
    console.error("addCamp error:", err);
    return { error: "Could not create the camp. Please try again." };
  }

  revalidatePath("/program-camps");
  return { ok: true };
}

// --- delete a camp (and its players + payments, via ON DELETE CASCADE) ------

export async function deleteCampAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const campId = Number.parseInt(String(formData.get("campId") ?? ""), 10);
  if (!Number.isFinite(campId)) return;

  await sql()`
    DELETE FROM camps
    WHERE id = ${campId} AND company_id = ${session.companyId}
  `;

  revalidatePath("/program-camps");
}

// --- add a player to a camp ------------------------------------------------

export async function addCampPlayerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const campId = Number.parseInt(String(formData.get("campId") ?? ""), 10);
  if (!Number.isFinite(campId)) return { error: "Choose a camp for this player." };

  const playerName = text(formData, "player_name");
  if (!playerName) return { error: "Enter the player's name." };

  try {
    await ensureCampsSchema();

    // Confirm the camp exists and belongs to this company before inserting.
    const owned = await sql()`
      SELECT id FROM camps WHERE id = ${campId} AND company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That camp no longer exists." };

    await sql()`
      INSERT INTO camp_players (camp_id, player_name, parent_name, parent_contact, location)
      VALUES (
        ${campId},
        ${playerName.slice(0, 160)},
        ${text(formData, "parent_name")},
        ${text(formData, "parent_contact")},
        ${text(formData, "location")}
      )
    `;
  } catch (err) {
    console.error("addCampPlayer error:", err);
    return { error: "Could not add the player. Please try again." };
  }

  revalidatePath("/program-camps");
  return { ok: true };
}

// --- delete a camp player (and their payments, via ON DELETE CASCADE) -------

export async function deleteCampPlayerAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const playerId = Number.parseInt(String(formData.get("playerId") ?? ""), 10);
  if (!Number.isFinite(playerId)) return;

  // Scope the delete to a player whose camp belongs to this company.
  await sql()`
    DELETE FROM camp_players
    WHERE id = ${playerId}
      AND camp_id IN (SELECT id FROM camps WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/program-camps");
}

// --- add a payment against a camp player -----------------------------------

export type CampPaymentInput = {
  campPlayerId: number | string;
  paidOn: string;
  paymentType: string;
  checkNumber?: string | null;
  amount: number | string;
};

export async function addCampPaymentAction(
  input: CampPaymentInput,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const campPlayerId = Number.parseInt(String(input.campPlayerId ?? ""), 10);
  if (!Number.isFinite(campPlayerId)) return { error: "Choose a player for this payment." };

  const paidOn = String(input.paidOn ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return { error: "Pick a valid date." };

  const paymentType = String(input.paymentType ?? "");
  if (!isPaymentType(paymentType)) return { error: "Pick a payment type (Check or Cash)." };

  const amountNum = Number(input.amount);
  if (!Number.isFinite(amountNum) || amountNum < 0) {
    return { error: "Enter a valid payment amount." };
  }
  // Keep two decimals; NUMERIC(10,2) also caps the value at 99,999,999.99.
  if (amountNum > 99_999_999.99) return { error: "That amount is too large." };
  const amount = amountNum.toFixed(2);

  // A check number only applies to check payments; ignore it for cash. Cap to
  // the column width (VARCHAR(32)).
  const rawCheck = String(input.checkNumber ?? "").trim();
  const checkNumber =
    paymentType === "check" && rawCheck !== "" ? rawCheck.slice(0, 32) : null;

  try {
    await ensureCampsSchema();

    // Confirm the camp player exists and belongs to this company before
    // inserting.
    const owned = await sql()`
      SELECT cp.id
      FROM camp_players cp
      JOIN camps c ON c.id = cp.camp_id
      WHERE cp.id = ${campPlayerId} AND c.company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That player no longer exists." };

    await sql()`
      INSERT INTO camp_payments (camp_player_id, paid_on, payment_type, check_number, amount)
      VALUES (${campPlayerId}, ${paidOn}, ${paymentType}, ${checkNumber}, ${amount})
    `;
  } catch (err) {
    console.error("addCampPayment error:", err);
    return { error: "Could not save the payment. Please try again." };
  }

  revalidatePath("/program-camps");
  return { ok: true };
}

// --- delete a camp payment -------------------------------------------------

export async function deleteCampPaymentAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const paymentId = Number.parseInt(String(formData.get("paymentId") ?? ""), 10);
  if (!Number.isFinite(paymentId)) return;

  // Scope the delete to a payment whose camp player's camp belongs to this
  // company.
  await sql()`
    DELETE FROM camp_payments
    WHERE id = ${paymentId}
      AND camp_player_id IN (
        SELECT cp.id
        FROM camp_players cp
        JOIN camps c ON c.id = cp.camp_id
        WHERE c.company_id = ${session.companyId}
      )
  `;

  revalidatePath("/program-camps");
}

// --- log an expense against a camp -----------------------------------------
//
// What the camp cost to put on — umpire fees for a showcase, field rental,
// gear. A paid expense comes off what the camp collected, a refund is credited
// back, and a not-paid one is tracked without moving the camp's net.

export async function addCampExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const campId = Number.parseInt(String(formData.get("campId") ?? ""), 10);
  if (!Number.isFinite(campId)) return { error: "Choose a camp for this expense." };

  const amount = amountString(formData, "amount");
  if (amount == null) return { error: "Enter an expense amount greater than $0." };

  try {
    await ensureCampsSchema();

    // Confirm the camp exists and belongs to this company before inserting.
    const owned = await sql()`
      SELECT id FROM camps WHERE id = ${campId} AND company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That camp no longer exists." };

    await sql()`
      INSERT INTO camp_expenses (camp_id, expense_date, vendor, amount, status)
      VALUES (
        ${campId},
        ${isoDate(formData.get("expense_date"))},
        ${text(formData, "vendor")},
        ${amount},
        ${expenseStatus(formData)}
      )
    `;
  } catch (err) {
    console.error("addCampExpense error:", err);
    return { error: "Could not add the expense. Please try again." };
  }

  revalidatePath("/program-camps");
  return { ok: true };
}

// --- edit a camp expense's details -----------------------------------------

export async function updateCampExpenseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const expenseId = Number.parseInt(String(formData.get("expenseId") ?? ""), 10);
  if (!Number.isFinite(expenseId)) return { error: "Missing expense." };

  const amount = amountString(formData, "amount");
  if (amount == null) return { error: "Enter an expense amount greater than $0." };

  try {
    await ensureCampsSchema();

    // Scope the update to an expense whose camp belongs to this company.
    const updated = await sql()`
      UPDATE camp_expenses SET
        expense_date = ${isoDate(formData.get("expense_date"))},
        vendor       = ${text(formData, "vendor")},
        amount       = ${amount},
        status       = ${expenseStatus(formData)},
        updated_at   = now()
      WHERE id = ${expenseId}
        AND camp_id IN (SELECT id FROM camps WHERE company_id = ${session.companyId})
      RETURNING id
    `;
    if (updated.length === 0) return { error: "That expense no longer exists." };
  } catch (err) {
    console.error("updateCampExpense error:", err);
    return { error: "Could not save changes. Please try again." };
  }

  revalidatePath("/program-camps");
  return { ok: true };
}

// --- quick status change (inline dropdown) ---------------------------------

export async function updateCampExpenseStatusAction(
  formData: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const expenseId = Number.parseInt(String(formData.get("expenseId") ?? ""), 10);
  const statusRaw = String(formData.get("status") ?? "");
  if (!Number.isFinite(expenseId) || !isExpenseStatus(statusRaw)) return;

  // Scope the update to an expense whose camp belongs to this company.
  await sql()`
    UPDATE camp_expenses SET status = ${statusRaw}, updated_at = now()
    WHERE id = ${expenseId}
      AND camp_id IN (SELECT id FROM camps WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/program-camps");
}

// --- delete a camp expense -------------------------------------------------

export async function deleteCampExpenseAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const expenseId = Number.parseInt(String(formData.get("expenseId") ?? ""), 10);
  if (!Number.isFinite(expenseId)) return;

  // Scope the delete to an expense whose camp belongs to this company.
  await sql()`
    DELETE FROM camp_expenses
    WHERE id = ${expenseId}
      AND camp_id IN (SELECT id FROM camps WHERE company_id = ${session.companyId})
  `;

  revalidatePath("/program-camps");
}
