import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  amountToCents,
  expenseStatusLabel,
  formatCents,
  formatDate,
  paymentTypeLabel,
  summarizeExpenses,
} from "../camps";
import { campSlice, loadCampData, type CampData } from "../load-camps";
import PrintControls from "./print-controls";

// The printable / save-as-PDF view of a camp.
//
// One report per camp: what it took in, what it cost to put on, its roster with
// each player's Paid figure, its payment ledger with the same running Total the
// tab shows, and its expense log. `camp` picks one camp; without it every camp
// is reported, each starting a fresh sheet.
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

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ProgramCampsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ camp?: string | string[] }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const campParam = firstParam((await searchParams).camp) ?? "";
  const campId = /^\d+$/.test(campParam) ? Number(campParam) : null;

  let data: CampData = { camps: [], players: [], payments: [], expenses: [] };
  let loadError = false;

  try {
    data = await loadCampData(session.companyId);
  } catch (err) {
    console.error("Program/Camps print load error:", err);
    loadError = true;
  }

  // The loader only ever returns this company's camps, so an id from the query
  // string can't reach another company's — an unknown one simply reports none.
  const camps =
    campId === null ? data.camps : data.camps.filter((c) => c.id === campId);
  const scope =
    campId === null
      ? camps.length === 1
        ? camps[0].name
        : "All camps"
      : (camps[0]?.name ?? "Camp not found");

  return (
    <div className="print-view">
      {/* Six narrow columns fit a portrait sheet, and a ledger reads better down
          the page than across it. Scoped to this route only. */}
      <style>{"@media print { @page { size: letter portrait; margin: 0.5in; } }"}</style>

      <PrintControls />

      <article className="print-doc">
        <header className="print-doc-head">
          <div>
            <p className="print-brand">Flood City Elite</p>
            <h1 className="print-doc-title">Camp Report</h1>
            {/* No scope line when the load failed — it could only name a camp
                this page never managed to read. */}
            {loadError ? null : <p className="print-doc-scope">{scope}</p>}
          </div>
          <p className="print-doc-meta">
            Generated {todayLabel()}
            <br />
            {session.companyName}
          </p>
        </header>

        {loadError ? (
          <p className="print-note">
            Couldn&apos;t load the camps. Please return to Program/Camps and try
            again.
          </p>
        ) : camps.length === 0 ? (
          <p className="print-note">No camps to report.</p>
        ) : (
          camps.map((camp) => {
            const { players, payments, expenses } = campSlice(data, camp.id);

            // Money in integer cents so a long camp can't drift a penny on
            // floats. Only paid expenses (less refunds) move the net — a Not
            // Paid one is tracked without changing it, the same rule the tab
            // and the Budgets tab apply.
            const collectedCents = payments.reduce(
              (sum, p) => sum + amountToCents(p.amount),
              0,
            );
            const totals = summarizeExpenses(expenses);
            const netCents = collectedCents - totals.netCents;

            const meta = [
              camp.location,
              camp.event_date ? formatDate(camp.event_date) : null,
            ]
              .filter(Boolean)
              .join(" · ");

            return (
              <section className="print-team" key={camp.id}>
                <div className="print-team-head">
                  <h2 className="print-team-name">{camp.name}</h2>
                  <span className="print-team-count">
                    {players.length}{" "}
                    {players.length === 1 ? "player" : "players"}
                    {meta ? ` · ${meta}` : ""}
                  </span>
                </div>

                <div className="print-pay-summary">
                  <div className="print-stat">
                    <span className="print-stat-label">Collected</span>
                    <span className="print-stat-value">
                      {formatCents(collectedCents)}
                    </span>
                  </div>
                  <div className="print-stat">
                    <span className="print-stat-label">Payments</span>
                    <span className="print-stat-value">{payments.length}</span>
                  </div>
                  <div className="print-stat">
                    <span className="print-stat-label">Expenses</span>
                    <span className="print-stat-value">
                      {formatCents(totals.netCents)}
                    </span>
                  </div>
                  <div className="print-stat is-total">
                    <span className="print-stat-label">Net</span>
                    <span className="print-stat-value">
                      {netCents < 0 ? "−" : ""}
                      {formatCents(Math.abs(netCents))}
                    </span>
                  </div>
                </div>

                <h3 className="print-sub print-camp-sub">Players</h3>
                {players.length === 0 ? (
                  <p className="print-note small">No players on this roster.</p>
                ) : (
                  // On a phone the paper is narrower than these columns need,
                  // so each table scrolls inside the report instead of bursting
                  // out of it. The wrapper is inert when printing.
                  <div className="print-scroll">
                    <table className="print-exp-table">
                      <thead>
                        <tr>
                          <th>Player Name</th>
                          <th>Parent Name</th>
                          <th>Parent Contact</th>
                          <th>Location</th>
                          <th className="amt">Paid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {players.map((p) => (
                          <tr key={p.id}>
                            <td>{p.player_name}</td>
                            <td>{p.parent_name || "—"}</td>
                            <td>{p.parent_contact || "—"}</td>
                            <td>{p.location || "—"}</td>
                            <td className="amt">{formatCents(p.paidCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <h3 className="print-sub print-camp-sub">Payments</h3>
                {payments.length === 0 ? (
                  <p className="print-note small">No payments recorded.</p>
                ) : (
                  <>
                    <div className="print-scroll">
                      <table className="print-pay-table">
                        <thead>
                          <tr>
                            <th className="col-date">Date</th>
                            <th>Player Name</th>
                            <th>Type</th>
                            <th className="amt">Check #</th>
                            <th className="amt">Amount</th>
                            <th className="amt">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {payments.map((p) => (
                            <tr key={p.id}>
                              <td className="col-date">
                                {formatDate(p.paid_on)}
                              </td>
                              <td className="col-name">{p.player_name}</td>
                              <td>{paymentTypeLabel(p.payment_type)}</td>
                              <td className="amt">{p.check_number || "—"}</td>
                              <td className="amt">
                                {formatCents(amountToCents(p.amount))}
                              </td>
                              <td className="amt col-total">
                                {formatCents(p.runningCents)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="print-grand">
                      <span className="print-grand-label">
                        Total payments received
                        {payments.length === 1
                          ? " · 1 payment"
                          : ` · ${payments.length} payments`}
                      </span>
                      <span className="print-grand-value">
                        {formatCents(collectedCents)}
                      </span>
                    </div>
                  </>
                )}

                <h3 className="print-sub print-camp-sub">Expenses</h3>
                {expenses.length === 0 ? (
                  <p className="print-note small">No expenses logged.</p>
                ) : (
                  <div className="print-scroll">
                    <table className="print-exp-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Expense</th>
                          <th className="amt">Total Cost</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expenses.map((e) => (
                          <tr key={e.id}>
                            <td>{formatDate(e.expense_date)}</td>
                            <td>{e.vendor || "—"}</td>
                            <td className="amt">
                              {formatCents(amountToCents(e.amount))}
                            </td>
                            <td>{expenseStatusLabel(e.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={2}>Paid</td>
                          <td className="amt">
                            {totals.paidCents > 0 ? "−" : ""}
                            {formatCents(totals.paidCents)}
                          </td>
                          <td />
                        </tr>
                        {totals.refundCents > 0 ? (
                          <tr>
                            <td colSpan={2}>Refunded</td>
                            <td className="amt">
                              +{formatCents(totals.refundCents)}
                            </td>
                            <td />
                          </tr>
                        ) : null}
                        {totals.notPaidCents > 0 ? (
                          <tr>
                            <td colSpan={2}>Not paid yet (not deducted)</td>
                            <td className="amt">
                              {formatCents(totals.notPaidCents)}
                            </td>
                            <td />
                          </tr>
                        ) : null}
                        <tr className="net">
                          <td colSpan={2}>Net after expenses</td>
                          <td className="amt">
                            {netCents < 0 ? "−" : ""}
                            {formatCents(Math.abs(netCents))}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>
            );
          })
        )}
      </article>
    </div>
  );
}
