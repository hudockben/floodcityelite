import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { resolveFormat, sheetResponse } from "@/lib/sheet-export";
import { isDivisionSlugFormat } from "../../teams/divisions";
import { listDivisionsSafe } from "../../teams/division-store";
import { hotelExportColumns } from "../hotel-export";
import { matchesHotelFilters, type HotelRow } from "../hotels";
import { ensureHotelsSchema } from "../schema";

// Download the travel list as a spreadsheet.
//
// The tab's search box, division filter, and tournament filter ride along as
// query params and are re-applied here with the very same predicate the
// directory uses, so the file holds exactly the rows that were on screen. Never
// cached — the download must reflect the list as it stands right now.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const format = resolveFormat(params.get("format"));
  const query = params.get("q") ?? "";
  const divisionRaw = params.get("division") ?? "";
  const division = isDivisionSlugFormat(divisionRaw) ? divisionRaw : "";
  // The tournament filter is an event id as a string, matching the <select>.
  const tournamentRaw = params.get("tournament") ?? "";
  const tournament = /^\d+$/.test(tournamentRaw) ? tournamentRaw : "";

  let rows: HotelRow[];
  try {
    await ensureHotelsSchema();
    // The same query and ordering the tab itself uses, so the file reads in the
    // order the screen did.
    const all = (await sql()`
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
    `) as HotelRow[];
    rows = all.filter((h) =>
      matchesHotelFilters(h, query, division, tournament),
    );
  } catch (err) {
    console.error("Hotels export error:", err);
    return new Response("Could not build the export. Please try again.", {
      status: 500,
    });
  }

  return sheetResponse({
    format,
    baseName: "hotels",
    sheetName: "Hotels",
    columns: hotelExportColumns(await listDivisionsSafe(session.companyId)),
    rows,
  });
}
