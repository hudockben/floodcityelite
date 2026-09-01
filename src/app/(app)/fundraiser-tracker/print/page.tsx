import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { divisionLabel } from "../../teams/divisions";
import {
  TEAM_LEVEL_LABEL,
  amountToCents,
  describeFundraiserFilters,
  formatDate,
  formatMoney,
  isFiltering,
  ledgerRows,
  matchesFundraiserFilters,
  normalizeFundraiserFilters,
  raisedByFundraiser,
  readFundraiserFilters,
  sumEntryCents,
  type FundraiserEntryRow,
  type FundraiserOption,
} from "../fundraisers";
import { loadFundraiserReport } from "../load-fundraisers";
import PrintControls from "./print-controls";

// The printable / save-as-PDF view of the fundraising log.
//
// The tab's fundraiser and division filters ride along as query params — the
// same ones the CSV/Excel download uses — and are re-applied here with the very
// same predicate, so a report handed to a board or a parent can't disagree with
// the screen it was printed off. The scope line under the title spells those
// filters out, so the report says which slice of the log it covers. Above the
// log sits a line per fundraiser — raised, goal, and progress — since that's
// the question a fundraising report is usually asked to answer.
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

/** A fundraiser's goal in cents, or null when it was never given one. */
function goalCents(fundraiser: FundraiserOption): number | null {
  if (fundraiser.goal == null || fundraiser.goal === "") return null;
  const cents = amountToCents(fundraiser.goal);
  return cents > 0 ? cents : null;
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

export default async function FundraiserTrackerPrintPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = toSearchParams(await searchParams);

  let fundraisers: FundraiserOption[] = [];
  let entries: FundraiserEntryRow[] = [];
  let filters = readFundraiserFilters(params);
  let loadError = false;

  try {
    const data = await loadFundraiserReport(session.companyId);
    fundraisers = data.fundraisers;
    // Normalized against the log first, so a filter naming a fundraiser nothing
    // was raised toward widens the report rather than emptying it.
    filters = normalizeFundraiserFilters(filters, data.entries);
    entries = data.entries.filter((e) => matchesFundraiserFilters(e, filters));
  } catch (err) {
    console.error("Fundraiser Tracker print load error:", err);
    loadError = true;
  }

  // Totals in cents so a long log can't drift a penny on floats.
  const totalCents = sumEntryCents(entries);
  const raised = raisedByFundraiser(entries);

  // Oldest first with the Total column accumulating through each entry, exactly
  // as the tab and the spreadsheet read it.
  const rows = ledgerRows(entries);

  // Only the fundraisers this report actually covers: one with nothing logged
  // against it — or nothing left after the filters — has no line to add, and a
  // summary of empty rows buries the ones that matter.
  const summary = fundraisers
    .map((f) => ({ fundraiser: f, cents: raised.get(f.id) ?? 0 }))
    .filter((s) => s.cents > 0);

  const filtering = isFiltering(filters);
  const scope =
    describeFundraiserFilters(filters, fundraisers) || "All fundraising logged";

  return (
    <div className="print-view">
      {/* Seven narrow columns fit a portrait sheet, and a log reads better
          down the page than across it. Scoped to this route only. */}
      <style>{"@media print { @page { size: letter portrait; margin: 0.5in; } }"}</style>

      {/* Plain, with no filters appended: the tab holds them in client state
          and doesn't read them off the URL, so a link carrying them would land
          on an unfiltered log under an address claiming otherwise. The report
          opens in its own tab anyway — the filtered log is still sitting behind
          it. */}
      <PrintControls backHref="/fundraiser-tracker" />

      <article className="print-doc">
        <header className="print-doc-head">
          <div>
            {/* The organization the signed-in user belongs to, not a
                hard-coded club — the portal serves more than one. */}
            <p className="print-brand">{session.companyName}</p>
            <h1 className="print-doc-title">Fundraising Report</h1>
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
            Couldn&apos;t load the fundraising log. Please return to the
            Fundraiser Tracker and try again.
          </p>
        ) : rows.length === 0 ? (
          <p className="print-note">
            {filtering
              ? "No entries match these filters."
              : "No fundraising has been logged yet."}
          </p>
        ) : (
          <>
            <div className="print-pay-summary">
              <div className="print-stat">
                <span className="print-stat-label">Entries</span>
                <span className="print-stat-value">{rows.length}</span>
              </div>
              <div className="print-stat">
                <span className="print-stat-label">Fundraisers</span>
                <span className="print-stat-value">{summary.length}</span>
              </div>
              <div className="print-stat is-total">
                <span className="print-stat-label">Total raised</span>
                <span className="print-stat-value">
                  {formatMoney(totalCents / 100)}
                </span>
              </div>
            </div>

            {summary.length > 0 ? (
              <section className="print-fund-breakdown">
                <h2 className="print-sub">By fundraiser</h2>
                <div className="print-scroll">
                  <table className="print-pay-table">
                    <thead>
                      <tr>
                        <th>Fundraiser</th>
                        <th className="col-date">Date</th>
                        <th className="amt">Raised</th>
                        <th className="amt">Goal</th>
                        <th className="amt">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.map(({ fundraiser, cents }) => {
                        const goal = goalCents(fundraiser);
                        return (
                          <tr key={fundraiser.id}>
                            <td className="col-name">{fundraiser.name}</td>
                            <td className="col-date">
                              {formatDate(fundraiser.event_date)}
                            </td>
                            <td className="amt col-total">
                              {formatMoney(cents / 100)}
                            </td>
                            <td className="amt">
                              {goal == null ? "—" : formatMoney(goal / 100)}
                            </td>
                            <td className="amt">
                              {goal == null
                                ? "—"
                                : `${Math.round((cents / goal) * 100)}%`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <h2 className="print-sub print-fund-sub">Every entry</h2>

            {/* On a phone the paper is narrower than seven columns need, so
                the table scrolls inside the report instead of bursting out of
                it. The wrapper is inert when printing — see @media screen. */}
            <div className="print-scroll">
              <table className="print-pay-table">
                <thead>
                  <tr>
                    <th className="col-date">Date</th>
                    <th>Division</th>
                    <th>Team Name</th>
                    <th>Player Name</th>
                    <th>Fundraiser</th>
                    <th className="amt">Amount</th>
                    <th className="amt">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ entry, runningTotalCents }) => (
                    <tr key={entry.id}>
                      <td className="col-date">{formatDate(entry.raised_on)}</td>
                      <td>{divisionLabel(entry.division)}</td>
                      <td>{entry.team_name}</td>
                      <td className="col-name">
                        {entry.player_name ?? TEAM_LEVEL_LABEL}
                      </td>
                      <td>{entry.fundraiser_name}</td>
                      <td className="amt">{formatMoney(entry.amount)}</td>
                      <td className="amt col-total">
                        {formatMoney(runningTotalCents / 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="print-grand">
              <span className="print-grand-label">
                Total raised
                {rows.length === 1 ? " · 1 entry" : ` · ${rows.length} entries`}
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
