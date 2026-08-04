import { getSession } from "@/lib/session";
import { resolveFormat, sheetResponse } from "@/lib/sheet-export";
import {
  CAMP_EXPENSE_COLUMNS,
  CAMP_PAYMENT_COLUMNS,
  CAMP_ROSTER_COLUMNS,
  CAMP_SHEET_NAMES,
  isCampSheet,
} from "../camp-export";
import { loadCampData, selectCamp } from "../load-camps";

// Download one camp's roster, payments, or expenses as a spreadsheet.
//
// `camp` names the camp and `sheet` picks which of its three tables to build;
// the rows come from the very same loader the tab renders from, so the file
// holds exactly what was on screen — the Paid and running Total columns
// included. Never cached: the download must reflect the camp as it stands right
// now, and these files carry a company's own registrations.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const params = new URL(request.url).searchParams;
  const format = resolveFormat(params.get("format"));

  const sheetParam = params.get("sheet");
  if (!isCampSheet(sheetParam)) {
    return new Response("Unknown export.", { status: 400 });
  }

  const campParam = params.get("camp") ?? "";
  const campId = /^\d+$/.test(campParam) ? Number(campParam) : NaN;
  if (!Number.isFinite(campId)) {
    return new Response("No camp selected.", { status: 400 });
  }

  let selected: ReturnType<typeof selectCamp>;
  try {
    // The loader is scoped to the signed-in company, so an id typed into the
    // query string can only ever reach this company's camps.
    selected = selectCamp(await loadCampData(session.companyId), campId);
  } catch (err) {
    console.error("Program/Camps export error:", err);
    return new Response("Could not build the export. Please try again.", {
      status: 500,
    });
  }

  if (!selected) return new Response("Camp not found.", { status: 404 });

  const { camp, players, payments, expenses } = selected;
  // e.g. "winter-hitting-clinic-payments" — sheetResponse strips anything that
  // doesn't belong in a filename and appends today's date.
  const baseName = `${camp.name}-${sheetParam}`;
  const sheetName = CAMP_SHEET_NAMES[sheetParam];

  if (sheetParam === "roster") {
    return sheetResponse({
      format,
      baseName,
      sheetName,
      columns: CAMP_ROSTER_COLUMNS,
      rows: players,
    });
  }

  if (sheetParam === "payments") {
    return sheetResponse({
      format,
      baseName,
      sheetName,
      columns: CAMP_PAYMENT_COLUMNS,
      rows: payments,
    });
  }

  return sheetResponse({
    format,
    baseName,
    sheetName,
    columns: CAMP_EXPENSE_COLUMNS,
    rows: expenses,
  });
}
