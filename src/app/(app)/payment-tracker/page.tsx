import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { listPayments } from "./load-payments";
import PaymentTracker from "./payment-tracker";
import { ensurePaymentsSchema } from "./schema";
import { listDivisionsSafe } from "../teams/division-store";
import type { Division } from "../teams/divisions";
import type { PaymentRow, PlayerOption, TeamOption } from "./payments";

export const dynamic = "force-dynamic";

export default async function PaymentTrackerPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let teams: TeamOption[] = [];
  let players: PlayerOption[] = [];
  let payments: PaymentRow[] = [];
  // The company's divisions, so the Division dropdown offers every division the
  // program runs and a division name reads the same here as on the Teams tab.
  const divisions: Division[] = await listDivisionsSafe(session.companyId);
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
      // The same rows, in the same order, that the download and the printed
      // report are built from.
      listPayments(session.companyId),
    ]);

    teams = teamRows as TeamOption[];
    players = playerRows as PlayerOption[];
    payments = paymentRows;
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
    <PaymentTracker
      teams={teams}
      players={players}
      payments={payments}
      divisions={divisions}
    />
  );
}
