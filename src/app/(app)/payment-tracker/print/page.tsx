import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { divisionLabel } from "../../teams/divisions";
import { listPayments } from "../load-payments";
import {
  amountToCents,
  formatDate,
  formatMoney,
  matchesPaymentFilters,
  paymentTypeLabel,
  readPaymentFilters,
  sumPaymentCents,
  describePaymentFilters,
  type PaymentRow,
} from "../payments";
import PrintControls from "./print-controls";

// The printable / save-as-PDF view of the payment ledger.
//
// The tab's filters ride along as query params — the same ones the CSV/Excel
// download uses — and are re-applied here with the very same predicate, so the
// PDF holds exactly the rows that were on screen. The scope line under the
// title spells those filters out, so a report handed to someone else says which
// slice of the ledger it covers.
export const dynamic = "force-dynamic";

// Deterministic "Month D, YYYY" for the generated-on line (UTC, no locale).
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function todayLabel(): string {
  const d = new Date();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Next hands params through as string | string[]; take the first of each. */
function toSearchParams(
  params: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first != null) out.set(key, first);
  }
  return out;
}

export default async function PaymentTrackerPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = toSearchParams(await searchParams);
  const filters = readPaymentFilters(params);

  let payments: PaymentRow[] = [];
  let loadError = false;

  try {
    const all = await listPayments(session.companyId);
    payments = all.filter((p) => matchesPaymentFilters(p, filters));
  } catch (err) {
    console.error("Payment Tracker print load error:", err);
    loadError = true;
  }

  // Totals in cents so a long ledger can't drift a penny on floats. The
  // check/cash split is what a deposit gets reconciled against.
  const totalCents = sumPaymentCents(payments);
  const checkCents = sumPaymentCents(
    payments.filter((p) => p.payment_type === "check"),
  );
  const cashCents = totalCents - checkCents;

  // The Total column accumulates down the report exactly as it does on screen.
  let running = 0;
  const rows = payments.map((payment) => {
    running += amountToCents(payment.amount);
    return { payment, runningTotal: running };
  });

  const scope = describePaymentFilters(filters) || "All payments";
  // Carry the filters back to the tab so "Back" returns to the same view.
  const query = params.toString();
  const backHref = query === "" ? "/payment-tracker" : `/payment-tracker?${query}`;

  return (
    <div className="print-view">
      {/* Eight narrow columns fit a portrait sheet, and a ledger reads better
          down the page than across it. Scoped to this route only. */}
      <style>{"@media print { @page { size: letter portrait; margin: 0.5in; } }"}</style>

      <PrintControls backHref={backHref} />

      <article className="print-doc">
        <header className="print-doc-head">
          <div>
            <p className="print-brand">Flood City Elite</p>
            <h1 className="print-doc-title">Payment Report</h1>
            <p className="print-doc-scope">{scope}</p>
          </div>
          <p className="print-doc-meta">
            Generated {todayLabel()}
            <br />
            {session.companyName}
          </p>
        </header>

        {loadError ? (
          <p className="print-note">
            Couldn&apos;t load the payments. Please return to the Payment
            Tracker and try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="print-note">No payments match these filters.</p>
        ) : (
          <>
            <div className="print-pay-summary">
              <div className="print-stat">
                <span className="print-stat-label">Payments</span>
                <span className="print-stat-value">{rows.length}</span>
              </div>
              <div className="print-stat">
                <span className="print-stat-label">Checks</span>
                <span className="print-stat-value">
                  {formatMoney(checkCents / 100)}
                </span>
              </div>
              <div className="print-stat">
                <span className="print-stat-label">Cash</span>
                <span className="print-stat-value">
                  {formatMoney(cashCents / 100)}
                </span>
              </div>
              <div className="print-stat is-total">
                <span className="print-stat-label">Total received</span>
                <span className="print-stat-value">
                  {formatMoney(totalCents / 100)}
                </span>
              </div>
            </div>

            <table className="print-pay-table">
              <thead>
                <tr>
                  <th className="col-date">Date</th>
                  <th>Division</th>
                  <th>Team Name</th>
                  <th>Player Name</th>
                  <th>Type</th>
                  <th className="amt">Check #</th>
                  <th className="amt">Amount</th>
                  <th className="amt">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ payment, runningTotal }) => (
                  <tr key={payment.id}>
                    <td className="col-date">{formatDate(payment.paid_on)}</td>
                    <td>{divisionLabel(payment.division)}</td>
                    <td>{payment.team_name}</td>
                    <td className="col-name">{payment.player_name}</td>
                    <td>{paymentTypeLabel(payment.payment_type)}</td>
                    <td className="amt">{payment.check_number ?? "—"}</td>
                    <td className="amt">{formatMoney(payment.amount)}</td>
                    <td className="amt col-total">
                      {formatMoney(runningTotal / 100)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="print-grand">
              <span className="print-grand-label">
                Total payments received
                {rows.length === 1 ? " · 1 payment" : ` · ${rows.length} payments`}
              </span>
              <span className="print-grand-value">
                {formatMoney(totalCents / 100)}
              </span>
            </div>
          </>
        )}
      </article>
    </div>
  );
}
