import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import FundraiserTracker from "./fundraiser-tracker";
import { ensureFundraisersSchema } from "./schema";
import type {
  FundraiserEntryRow,
  FundraiserOption,
  PlayerOption,
  TeamOption,
} from "./fundraisers";

export const dynamic = "force-dynamic";

export default async function FundraiserTrackerPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let teams: TeamOption[] = [];
  let players: PlayerOption[] = [];
  let fundraisers: FundraiserOption[] = [];
  let entries: FundraiserEntryRow[] = [];
  let loadError = false;

  try {
    // Create the fundraiser tables on first use so the tab works even if the
    // database predates this feature. Idempotent and memoized.
    await ensureFundraisersSchema();

    const [teamRows, playerRows, fundraiserRows, entryRows] = await Promise.all([
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
          id,
          name,
          goal::text        AS goal,
          event_date::text  AS event_date
        FROM fundraisers
        WHERE company_id = ${session.companyId}
        ORDER BY event_date NULLS LAST, name, id
      `,
      sql()`
        SELECT
          fe.id,
          fe.raised_on::text AS raised_on,
          fe.amount::text    AS amount,
          f.id               AS fundraiser_id,
          f.name             AS fundraiser_name,
          pl.id              AS player_id,
          pl.player_name,
          t.id               AS team_id,
          t.name             AS team_name,
          t.division
        FROM fundraiser_entries fe
        JOIN fundraisers f ON f.id = fe.fundraiser_id
        JOIN players pl    ON pl.id = fe.player_id
        JOIN teams t       ON t.id = pl.team_id
        WHERE t.company_id = ${session.companyId}
        ORDER BY fe.raised_on, fe.id
      `,
    ]);

    teams = teamRows as TeamOption[];
    players = playerRows as PlayerOption[];
    fundraisers = fundraiserRows as FundraiserOption[];
    entries = entryRows as FundraiserEntryRow[];
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
      teams={teams}
      players={players}
      fundraisers={fundraisers}
      entries={entries}
    />
  );
}
