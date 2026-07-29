import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { resolveFormat, sheetResponse } from "@/lib/sheet-export";
import { sportLabel } from "../../teams/divisions";
import { COACH_EXPORT_COLUMNS } from "../coach-export";
import {
  matchesCoachFilters,
  resolveSport,
  type CoachRow,
} from "../coaches";
import { ensureCoachesSchema } from "../schema";

// Download the college contact list as a spreadsheet.
//
// The tab's sport tab, search box, and level filter ride along as query params
// and are re-applied here with the very same predicate the directory uses, so
// the file holds exactly the rows that were on screen. Never cached — the
// download must reflect the list as it stands right now.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const params = new URL(request.url).searchParams;
  const format = resolveFormat(params.get("format"));
  const sport = resolveSport(params.get("sport"));
  const query = params.get("q") ?? "";
  const level = params.get("level") ?? "";

  let rows: CoachRow[];
  try {
    await ensureCoachesSchema();
    // Ordered exactly like the tab's own query, so the file reads in the order
    // the screen did.
    const all = (await sql()`
      SELECT
        id, sport, school_name, coach_name, coach_title, division_level,
        conference, cell_phone, email, website, city, state, notes
      FROM college_coaches
      WHERE company_id = ${session.companyId} AND sport = ${sport}
      ORDER BY lower(school_name), lower(coach_name) NULLS LAST, id
    `) as CoachRow[];
    rows = all.filter((c) => matchesCoachFilters(c, query, level));
  } catch (err) {
    console.error("Contact Info export error:", err);
    return new Response("Could not build the export. Please try again.", {
      status: 500,
    });
  }

  return sheetResponse({
    format,
    baseName: `${sport}-college-contacts`,
    sheetName: `${sportLabel(sport)} Contacts`,
    columns: COACH_EXPORT_COLUMNS,
    rows,
  });
}
