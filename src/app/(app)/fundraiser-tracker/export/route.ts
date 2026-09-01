import { getSession } from "@/lib/session";
import { resolveFormat, sheetResponse } from "@/lib/sheet-export";
import {
  FUNDRAISER_EXPORT_COLUMNS,
  withRunningTotals,
  type FundraiserExportRow,
} from "../fundraiser-export";
import { loadFundraiserEntries } from "../load-fundraisers";

// Download the fundraising log as a spreadsheet.
//
// The rows, their order and the running Total column all come from the same
// place the tab reads them from, so the file holds exactly what was on screen.
// Never cached: the download must reflect the log as it stands right now.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const format = resolveFormat(new URL(request.url).searchParams.get("format"));

  let rows: FundraiserExportRow[];
  try {
    // Totals accumulate over what's in the file, oldest entry first as they do
    // on screen — so the last Total cell is the total raised, the figure the
    // tab was showing.
    rows = withRunningTotals(await loadFundraiserEntries(session.companyId));
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
