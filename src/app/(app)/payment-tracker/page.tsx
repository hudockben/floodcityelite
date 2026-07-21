import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import PaymentTracker from "./payment-tracker";
import { ensurePaymentsSchema } from "./schema";
import type { PaymentRow, PlayerOption, TeamOption } from "./payments";

export const dynamic = "force-dynamic";

export default async function PaymentTrackerPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let teams: TeamOption[] = [];
  let players: PlayerOption[] = [];
  let payments: PaymentRow[] = [];
  let loadError = false;

  try {
    // Create the payments table on first use so the tab works even if the
    // database predates this feature. Idempotent and memoized.
    await ensurePaymentsSchema();

    const [teamRows, playerRows, paymentRows] = await Promise.all([
      sql()`
        SELECT id, name, division
        FROM teams
        WHERE company_id = ${session.companyId}
        ORDER BY name
      `,
      sql()`
        SELECT pl.id, pl.team_id, pl.player_name
        FROM players pl
        JOIN teams t ON t.id = pl.team_id
        WHERE t.company_id = ${session.companyId}
        ORDER BY pl.player_name
      `,
      sql()`
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
        WHERE t.company_id = ${session.companyId}
        ORDER BY pay.paid_on, pay.id
      `,
    ]);

    teams = teamRows as TeamOption[];
    players = playerRows as PlayerOption[];
    payments = paymentRows as PaymentRow[];
  } catch (err) {
    console.error("Payment Tracker load error:", err);
    loadError = true;
  }

  if (loadError) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h1>Payment Tracker</h1>
          <p>Track dues, invoices, and payments.</p>
        </div>
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            ⚠️
          </div>
          <p className="empty-title">Couldn&apos;t load payments</p>
          <p className="empty-sub">
            The payment tables may still be getting set up. Refresh in a moment —
            if this keeps happening, run <code>npm run db:setup</code> against the
            database.
          </p>
        </div>
      </section>
    );
  }

  return (
    <PaymentTracker teams={teams} players={players} payments={payments} />
  );
}
