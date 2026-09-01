import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import FundraiserTracker from "./fundraiser-tracker";
import { loadFundraiserData, type FundraiserData } from "./load-fundraisers";

export const dynamic = "force-dynamic";

const NOTHING: FundraiserData = {
  teams: [],
  players: [],
  fundraisers: [],
  entries: [],
};

export default async function FundraiserTrackerPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let data = NOTHING;
  let loadError = false;

  try {
    data = await loadFundraiserData(session.companyId);
  } catch (err) {
    console.error("Fundraiser Tracker load error:", err);
    loadError = true;
  }

  if (loadError) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h1>Fundraiser Tracker</h1>
          <p>Create fundraisers and track what each player raises.</p>
        </div>
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            ⚠️
          </div>
          <p className="empty-title">Couldn&apos;t load fundraisers</p>
          <p className="empty-sub">
            The fundraiser tables may still be getting set up. Refresh in a
            moment — if this keeps happening, run <code>npm run db:setup</code>{" "}
            against the database.
          </p>
        </div>
      </section>
    );
  }

  return (
    <FundraiserTracker
      teams={data.teams}
      players={data.players}
      fundraisers={data.fundraisers}
      entries={data.entries}
    />
  );
}
