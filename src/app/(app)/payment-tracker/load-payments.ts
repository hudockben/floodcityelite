// ---------------------------------------------------------------------------
// Payment Tracker — reading the ledger
//
// Server-only (it reaches for the database), and shared by the three places
// that render the same rows: the tab itself, the CSV/Excel download, and the
// printed report. One query means the file and the printout can't come out in a
// different order — or hold different columns — than the table on screen.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import type { PaymentRow } from "./payments";
import { ensurePaymentsSchema } from "./schema";

/**
 * Every payment logged against this company's players, oldest first — the order
 * the ledger's running Total column accumulates in.
 */
export async function listPayments(companyId: number): Promise<PaymentRow[]> {
  // Create the payments table on first use so the tab works even if the
  // database predates this feature. Idempotent and memoized.
  await ensurePaymentsSchema();

  return (await sql()`
    SELECT
      pay.id,
      pay.paid_on::text AS paid_on,
      pay.payment_type,
      pay.check_number,
      pay.amount::text  AS amount,
      pl.id             AS player_id,
      pl.player_name,
      t.id              AS team_id,
      t.name            AS team_name,
      t.division
    FROM payments pay
    JOIN players pl ON pl.id = pay.player_id
    JOIN teams t    ON t.id = pl.team_id
    WHERE t.company_id = ${companyId}
    ORDER BY pay.paid_on, pay.id
  `) as PaymentRow[];
}
