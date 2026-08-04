// ---------------------------------------------------------------------------
// Program/Camps — reading a company's camps
//
// Server-only (it reaches for the database), and shared by the three places
// that render the same rows: the tab itself, the CSV/Excel downloads, and the
// printed report. One query means a downloaded file and a printout can't come
// out in a different order — or hold different rows — than the tab on screen.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";
import { amountToCents } from "./camps";
import type {
  CampExpenseRow,
  CampOption,
  CampPaymentRow,
  CampPlayerRow,
} from "./camps";
import { ensureCampsSchema } from "./schema";

/** Everything the Program/Camps tab shows, for one company. */
export type CampData = {
  camps: CampOption[];
  players: CampPlayerRow[];
  payments: CampPaymentRow[];
  expenses: CampExpenseRow[];
};

/**
 * Every camp this company owns, with its roster, payments, and expenses.
 *
 * Payments come back oldest first — the order the tab's running Total column
 * accumulates in, so the download and the report can accumulate it the same
 * way.
 */
export async function loadCampData(companyId: number): Promise<CampData> {
  // Create the camp tables on first use so the tab works even if the database
  // predates this feature. Idempotent and memoized.
  await ensureCampsSchema();

  const [campRows, playerRows, paymentRows, expenseRows] = await Promise.all([
    sql()`
      SELECT
        id,
        name,
        location,
        event_date::text AS event_date
      FROM camps
      WHERE company_id = ${companyId}
      ORDER BY event_date NULLS LAST, name, id
    `,
    sql()`
      SELECT
        cp.id,
        cp.camp_id,
        cp.player_name,
        cp.parent_name,
        cp.parent_contact,
        cp.location
      FROM camp_players cp
      JOIN camps c ON c.id = cp.camp_id
      WHERE c.company_id = ${companyId}
      ORDER BY cp.player_name, cp.id
    `,
    sql()`
      SELECT
        pay.id,
        pay.paid_on::text AS paid_on,
        pay.payment_type,
        pay.check_number,
        pay.amount::text  AS amount,
        cp.id             AS camp_player_id,
        c.id              AS camp_id,
        cp.player_name
      FROM camp_payments pay
      JOIN camp_players cp ON cp.id = pay.camp_player_id
      JOIN camps c         ON c.id = cp.camp_id
      WHERE c.company_id = ${companyId}
      ORDER BY pay.paid_on, pay.id
    `,
    sql()`
      SELECT
        e.id,
        e.camp_id,
        e.expense_date::text AS expense_date,
        e.vendor,
        e.amount::text       AS amount,
        e.status
      FROM camp_expenses e
      JOIN camps c ON c.id = e.camp_id
      WHERE c.company_id = ${companyId}
      ORDER BY e.expense_date NULLS LAST, e.id
    `,
  ]);

  return {
    camps: campRows as CampOption[],
    players: playerRows as CampPlayerRow[],
    payments: paymentRows as CampPaymentRow[],
    expenses: expenseRows as CampExpenseRow[],
  };
}

/**
 * One camp's slice of the loaded data, with the two derived figures the tab
 * shows beside the rows: what each player has paid, and the running Total the
 * payment ledger accumulates.
 *
 * `camp` is looked up in `data.camps`, which is already scoped to the signed-in
 * company — so an id from a query string can only ever reach that company's
 * camps, and anything else comes back null.
 */
export function selectCamp(
  data: CampData,
  campId: number,
): {
  camp: CampOption;
  players: (CampPlayerRow & { paidCents: number })[];
  payments: (CampPaymentRow & { runningCents: number })[];
  expenses: CampExpenseRow[];
} | null {
  const camp = data.camps.find((c) => c.id === campId);
  if (!camp) return null;
  return { camp, ...campSlice(data, camp.id) };
}

/** The rows of one camp, with the per-player and running totals attached. */
export function campSlice(data: CampData, campId: number) {
  const payments = data.payments.filter((p) => p.camp_id === campId);

  // Money in integer cents so a long ledger can't drift a penny on floats.
  const paidByPlayer = new Map<number, number>();
  for (const p of payments) {
    paidByPlayer.set(
      p.camp_player_id,
      (paidByPlayer.get(p.camp_player_id) ?? 0) + amountToCents(p.amount),
    );
  }

  let running = 0;
  return {
    players: data.players
      .filter((p) => p.camp_id === campId)
      .map((p) => ({ ...p, paidCents: paidByPlayer.get(p.id) ?? 0 })),
    payments: payments.map((p) => {
      running += amountToCents(p.amount);
      return { ...p, runningCents: running };
    }),
    expenses: data.expenses.filter((e) => e.camp_id === campId),
  };
}
