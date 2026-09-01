import { getSession } from "@/lib/session";
import { resolveFormat, sheetResponse } from "@/lib/sheet-export";
import {
  FUNDRAISER_EXPORT_COLUMNS,
  withRunningTotals,
  type FundraiserExportRow,
} from "../fundraiser-export";
import {
  matchesFundraiserFilters,
  normalizeFundraiserFilters,
  readFundraiserFilters,
} from "../fundraisers";
import { loadFundraiserEntries } from "../load-fundraisers";

// Download the fundraising log as a spreadsheet.
//
// The tab's fundraiser and division filters ride along as query params and are
// re-applied here with the very same predicate the log uses, so the file holds
// exactly the rows that were on screen — the running Total column included.
// Never cached: the download must reflect the log as it stands right now.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const format = resolveFormat(params.get("format"));

  let rows: FundraiserExportRow[];
  try {
    const all = await loadFundraiserEntries(session.companyId);
    // Normalized against the log first, so a filter naming a fundraiser nothing
    // was raised toward widens the file rather than emptying it.
    const filters = normalizeFundraiserFilters(
      readFundraiserFilters(params),
      all,
    );
    // Totals accumulate over what's in the file, oldest entry first as they do
    // on screen — so the last Total cell is the total raised by this slice of
    // the log, the figure the tab was showing.
    rows = withRunningTotals(
      all.filter((e) => matchesFundraiserFilters(e, filters)),
    );
  } catch (err) {
    console.error("Fundraiser Tracker export error:", err);
    return new Response("Could not build the export. Please try again.", {
      status: 500,
    });
  }

  return sheetResponse({
    format,
    baseName: "fundraising",
    sheetName: "Fundraising",
    columns: FUNDRAISER_EXPORT_COLUMNS,
    rows,
  });
}
