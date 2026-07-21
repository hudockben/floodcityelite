"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { isPaymentType } from "./payments";
import { ensurePaymentsSchema } from "./schema";

export type FormState = { ok?: boolean; error?: string };

export type PaymentInput = {
  playerId: number | string;
  paidOn: string;
  paymentType: string;
  amount: number | string;
};

// --- add a payment against a player ----------------------------------------

export async function addPaymentAction(
  input: PaymentInput,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Please sign in again." };

  const playerId = Number.parseInt(String(input.playerId ?? ""), 10);
  if (!Number.isFinite(playerId)) return { error: "Choose a player for this payment." };

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

  try {
    await ensurePaymentsSchema();

    // Confirm the player exists and belongs to this company before inserting.
    const owned = await sql()`
      SELECT pl.id
      FROM players pl
      JOIN teams t ON t.id = pl.team_id
      WHERE pl.id = ${playerId} AND t.company_id = ${session.companyId}
    `;
    if (owned.length === 0) return { error: "That player no longer exists." };

    await sql()`
      INSERT INTO payments (player_id, paid_on, payment_type, amount)
      VALUES (${playerId}, ${paidOn}, ${paymentType}, ${amount})
    `;
  } catch (err) {
    console.error("addPayment error:", err);
    return { error: "Could not save the payment. Please try again." };
  }

  revalidatePath("/payment-tracker");
  return { ok: true };
}

// --- delete a payment ------------------------------------------------------

export async function deletePaymentAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const paymentId = Number.parseInt(String(formData.get("paymentId") ?? ""), 10);
  if (!Number.isFinite(paymentId)) return;

  // Scope the delete to a payment whose player's team belongs to this company.
  await sql()`
    DELETE FROM payments
    WHERE id = ${paymentId}
      AND player_id IN (
        SELECT pl.id
        FROM players pl
        JOIN teams t ON t.id = pl.team_id
        WHERE t.company_id = ${session.companyId}
      )
  `;

  revalidatePath("/payment-tracker");
}
