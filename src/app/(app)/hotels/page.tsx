import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import AddHotelForm from "./add-hotel-form";
import BulkUploadForm from "./bulk-upload-form";
import HotelDirectory from "./hotel-directory";
import { ensureHotelsSchema } from "./schema";
import { listDivisionsSafe } from "../teams/division-store";
import type { Division } from "../teams/divisions";
import type { HotelRow, TournamentOption } from "./hotels";

export const dynamic = "force-dynamic";

export default async function HotelsPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let hotels: HotelRow[] = [];
  let tournaments: TournamentOption[] = [];
  // The company's divisions, so the Division select and filter offer every
  // division the program runs — including ones added on the Teams tab.
  const divisions: Division[] = await listDivisionsSafe(session.companyId);
  let loadError = false;

  try {
    // Create the table on first use so the tab works even if the database
    // predates this feature. Idempotent and memoized.
    await ensureHotelsSchema();

    const [hotelRows, tournamentRows] = await Promise.all([
      // The tournament columns come from the live event when it still exists;
      // `event_name` on the hotel is the snapshot that survives its deletion.
      // Ordered by lower(name) so the sort doesn't depend on the database's
      // collation (a hotel typed in lower case would otherwise sort last).
      sql()`
        SELECT
          h.id,
          h.name,
          h.address,
          h.city,
          h.state,
          h.division,
          h.event_id,
          h.event_name,
          h.avg_cost_per_night::text AS avg_cost_per_night,
          h.phone,
          h.website,
          h.notes,
          ev.event_date::text AS event_date,
          t.division          AS event_division,
          s.year              AS event_year
        FROM hotels h
        LEFT JOIN schedule_events ev ON ev.id = h.event_id
        LEFT JOIN teams t            ON t.id = ev.team_id
        LEFT JOIN seasons s          ON s.id = t.season_id
        WHERE h.company_id = ${session.companyId}
        ORDER BY lower(h.name), h.id
      `,
      // Every tournament this company has scheduled, newest first, for the
      // "which tournament is this stay for" dropdown.
      sql()`
        SELECT
          ev.id,
          ev.event_name,
          ev.event_date::text AS event_date,
          t.name              AS team_name,
          t.division,
          s.year
        FROM schedule_events ev
        JOIN teams t     ON t.id = ev.team_id
        LEFT JOIN seasons s ON s.id = t.season_id
        WHERE t.company_id = ${session.companyId}
        ORDER BY ev.event_date DESC NULLS LAST, lower(ev.event_name)
      `,
    ]);

    hotels = hotelRows as HotelRow[];
    tournaments = tournamentRows as TournamentOption[];
  } catch (err) {
    console.error("Hotels load error:", err);
    loadError = true;
  }

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Hotels</h1>
          <p>
            Where the program stays on the road — the tournament each stay is
            for, the address, the nightly rate, and the booking site, all in one
            list.
          </p>
        </div>
      </section>

      {loadError ? (
        <section className="panel">
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ⚠️
            </div>
            <p className="empty-title">Couldn&apos;t load hotels</p>
            <p className="empty-sub">
              The hotels table may still be getting set up. Refresh in a moment
              — if this keeps happening, run <code>npm run db:setup</code>{" "}
              against the database.
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* Step 1 — add a hotel */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">1</span> Add a hotel
              </h2>
              <p>
                Fill in what you have — only the hotel name is required. Tie it
                to a tournament from the{" "}
                <Link className="inline-link" href="/schedules">
                  Schedules
                </Link>{" "}
                tab so the weekend&apos;s rooms and games line up.
              </p>
            </div>

            <AddHotelForm tournaments={tournaments} divisions={divisions} />

            <BulkUploadForm />
          </section>

          {/* Step 2 — the travel list */}
          <section className="panel">
            <div className="panel-head">
              <h2 className="step-title">
                <span className="step-num">2</span> Travel list
              </h2>
              <p>
                {hotels.length} {hotels.length === 1 ? "hotel" : "hotels"} saved.
                Phone and website are tap-to-open, a tournament links through to
                its schedule, and Edit updates a stay.
              </p>
            </div>

            <HotelDirectory
              hotels={hotels}
              tournaments={tournaments}
              divisions={divisions}
            />
          </section>
        </>
      )}
    </div>
  );
}
