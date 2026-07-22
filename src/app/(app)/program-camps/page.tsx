import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import ProgramCamps from "./program-camps";
import { ensureCampsSchema } from "./schema";
import type { CampOption, CampPaymentRow, CampPlayerRow } from "./camps";

export const dynamic = "force-dynamic";

export default async function ProgramCampsPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let camps: CampOption[] = [];
  let players: CampPlayerRow[] = [];
  let payments: CampPaymentRow[] = [];
  let loadError = false;

  try {
    // Create the camp tables on first use so the tab works even if the database
    // predates this feature. Idempotent and memoized.
    await ensureCampsSchema();

    const [campRows, playerRows, paymentRows] = await Promise.all([
      sql()`
        SELECT
          id,
          name,
          location,
          event_date::text AS event_date
        FROM camps
        WHERE company_id = ${session.companyId}
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
        WHERE c.company_id = ${session.companyId}
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
        WHERE c.company_id = ${session.companyId}
        ORDER BY pay.paid_on, pay.id
      `,
    ]);

    camps = campRows as CampOption[];
    players = playerRows as CampPlayerRow[];
    payments = paymentRows as CampPaymentRow[];
  } catch (err) {
    console.error("Program/Camps load error:", err);
    loadError = true;
  }

  if (loadError) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h1>Program/Camps</h1>
          <p>Create camps, add players, and track their payments.</p>
        </div>
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            ⚠️
          </div>
          <p className="empty-title">Couldn&apos;t load camps</p>
          <p className="empty-sub">
            The camp tables may still be getting set up. Refresh in a moment — if
            this keeps happening, run <code>npm run db:setup</code> against the
            database.
          </p>
        </div>
      </section>
    );
  }

  return (
    <ProgramCamps camps={camps} players={players} payments={payments} />
  );
}
