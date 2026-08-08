import { getSession } from "@/lib/session";
import { resolveFormat, sheetResponse } from "@/lib/sheet-export";
import { listPayments } from "../load-payments";
import {
  PAYMENT_EXPORT_COLUMNS,
  withRunningTotals,
  type PaymentExportRow,
} from "../payment-export";
import { matchesPaymentFilters, readPaymentFilters } from "../payments";

// Download the payment ledger as a spreadsheet.
//
// The tab's search box, division, payment type, check # and date-range filters
// ride along as query params and are re-applied here with the very same
// predicate the ledger uses, so the file holds exactly the rows that were on
// screen — the running Total column included. Never cached: the download must
// reflect the ledger as it stands right now.
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Not signed in.", { status: 401 });

  const params = new URL(request.url).searchParams;
  const format = resolveFormat(params.get("format"));
  const filters = readPaymentFilters(params);

  let rows: PaymentExportRow[];
  try {
    const all = await listPayments(session.companyId);
    // Totals accumulate over what's in the file, and the rows come out newest
    // first as they do on screen — so the first Total cell is the total for
    // this slice of the ledger, the figure the tab was showing.
    rows = withRunningTotals(
      all.filter((p) => matchesPaymentFilters(p, filters)),
    );
  } catch (err) {
    console.error("Payment Tracker export error:", err);
    return new Response("Could not build the export. Please try again.", {
      status: 500,
    });
  }

  return sheetResponse({
    format,
    baseName: "payments",
    sheetName: "Payments",
    columns: PAYMENT_EXPORT_COLUMNS,
    rows,
  });
}
