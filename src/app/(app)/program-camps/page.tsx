import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { loadCampData } from "./load-camps";
import ProgramCamps from "./program-camps";
import type {
  CampExpenseRow,
  CampOption,
  CampPaymentRow,
  CampPlayerRow,
} from "./camps";

export const dynamic = "force-dynamic";

export default async function ProgramCampsPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let camps: CampOption[] = [];
  let players: CampPlayerRow[] = [];
  let payments: CampPaymentRow[] = [];
  let expenses: CampExpenseRow[] = [];
  let loadError = false;

  try {
    // The same loader the downloads and the printed report read from, so a file
    // or a printout can't come out holding different rows than the tab.
    ({ camps, players, payments, expenses } = await loadCampData(
      session.companyId,
    ));
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
    <ProgramCamps
      camps={camps}
      players={players}
      payments={payments}
      expenses={expenses}
    />
  );
}
