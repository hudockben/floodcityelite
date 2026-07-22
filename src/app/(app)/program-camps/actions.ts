"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isPaymentType } from "./camps";
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
