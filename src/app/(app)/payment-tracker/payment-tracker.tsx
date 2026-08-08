"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import ConfirmButton from "../teams/confirm-button";
import { divisionLabel } from "../teams/divisions";
import { deletePaymentAction } from "./actions";
import PaymentDraftRow, { type DraftInitial } from "./payment-draft-row";
import PaymentFilters from "./payment-filters";
import PaymentPager, {
  ALL_ROWS,
  DEFAULT_PAGE_SIZE,
  PAGER_MIN_ROWS,
} from "./payment-pager";
import PaymentSearch, { type PlayerMatch } from "./payment-search";
import {
  NO_PAYMENT_FILTERS,
  amountToCents,
  formatDate,
  formatMoney,
  isFiltering,
  matchesPaymentFilters,
  normalizePaymentFilters,
  paymentSearchText,
  paymentTypeLabel,
  sumPaymentCents,
  type PaymentFilters as Filters,
  type PaymentRow,
  type PlayerOption,
  type TeamOption,
} from "./payments";

// A draft (unsaved) row. `initial` is set when the row is seeded from the
// search bar so its Division/Team/Player start filled in.
type Draft = { id: number; initial?: DraftInitial };

/**
 * Which page of the ledger is on screen: a number the user picked, or a date
 * left behind by a save. The anchor resolves against the ledger as it stands
 * *now*, so a payment that only arrives from the server a moment later still
 * lands on screen — including one backdated into the middle of the ledger,
 * and one that spills the last page over onto a new one.
 */
type PageState = number | { anchor: string };

// Date, Division, Team, Player, Type, Check #, Amount, Total, Actions.
const COL_COUNT = 9;

function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(page, 1), pageCount);
}

/**
 * The page a just-saved payment landed on. Rows run oldest first, so the saved
 * one is the last row dated on or before it — anything later starts the page
 * after. Falls back to the end of the ledger while the row is still in flight.
 */
function anchoredPage(
  anchor: string,
  rows: PaymentRow[],
  perPage: number,
  pageCount: number,
): number {
  if (rows.length === 0) return 1;
  const after = rows.findIndex((r) => r.paid_on.slice(0, 10) > anchor);
  const index = after === -1 ? rows.length - 1 : after - 1;
  if (index < 0) return 1;
  return clampPage(Math.floor(index / perPage) + 1, pageCount);
}

export default function PaymentTracker({
  teams,
  players,
  payments,
}: {
  teams: TeamOption[];
  players: PlayerOption[];
  payments: PaymentRow[];
}) {
  // Draft (unsaved) rows added by "Add Payment" or the search bar, each with a
  // stable key.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextDraftId = useRef(1);

  // The filter bar's state. Normalized against the ledger so a filter whose
  // last matching payment was removed doesn't stay silently applied.
  const [rawFilters, setFilters] = useState<Filters>(NO_PAYMENT_FILTERS);
  const filters = useMemo(
    () => normalizePaymentFilters(rawFilters, payments),
    [rawFilters, payments],
  );

  const [page, setPage] = useState<PageState>(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // Everything on a payment, lowercased, memoized so the search box doesn't
  // rebuild every haystack on each keystroke.
  const searchText = useMemo(
    () => new Map(payments.map((p) => [p.id, paymentSearchText(p)])),
    [payments],
  );

  const filtered = useMemo(
    () =>
      payments.filter((p) =>
        matchesPaymentFilters(p, filters, searchText.get(p.id)),
      ),
    [payments, filters, searchText],
  );

  // The Total column accumulates across everything the filters show, in display
  // order, so the last row's running total equals the total below the table —
  // under a filter that's the total for the slice being shown, which is the
  // figure the download and the printed report carry too. Paging doesn't
  // restart it: row 26 still counts rows 1–25 before it, and only the last
  // page ends on the grand total. Kept in cents so a long ledger can't drift
  // a penny.
  let runningCents = 0;
  const savedRows = filtered.map((payment) => {
    runningCents += amountToCents(payment.amount);
    return { payment, runningTotal: runningCents / 100 };
  });
  const shownTotal = runningCents / 100;
  // The whole ledger's total, so a filtered view can say what it's a slice of.
  const allTotal = sumPaymentCents(payments) / 100;
  const filtering = isFiltering(filters);

  // The page on screen. "All" is one page holding the lot; the count is clamped
  // to at least one so an empty ledger still has a page to show its empty row
  // on. Both are derived rather than stored, so removing the last payment on a
  // page — or narrowing the filters to a handful of rows — can't strand the
  // view past the end of the ledger.
  const rowsPerPage =
    pageSize === ALL_ROWS ? Math.max(filtered.length, 1) : pageSize;
  const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const currentPage =
    typeof page === "number"
      ? clampPage(page, pageCount)
      : anchoredPage(page.anchor, filtered, rowsPerPage, pageCount);

  const start = (currentPage - 1) * rowsPerPage;
  const pageRows = savedRows.slice(start, start + rowsPerPage);
  const paginating = filtered.length > PAGER_MIN_ROWS;

  const scrollRef = useRef<HTMLDivElement>(null);

  function addDraft(initial?: DraftInitial) {
    setDrafts((cur) => [...cur, { id: nextDraftId.current++, initial }]);
    // Drafts render under the last row on screen, which is only where the
    // ledger actually ends on the final page — and where the saved payment
    // will appear once it's in. Jump there so the row doesn't look like it
    // was inserted into the middle of somebody else's month.
    setPage(pageCount);
  }

  function removeDraft(id: number) {
    setDrafts((cur) => cur.filter((d) => d.id !== id));
  }

  // A payment saved while the ledger is filtered often falls outside what's
  // being shown — today's date against a range set up for a download, a check
  // while the Type filter says Cash — and a row that vanishes the instant it
  // saves reads as a failure. Dropping the filters puts it back on screen, and
  // anchoring the page on the date it was saved under follows it to whichever
  // page it lands on.
  function handleSaved(id: number, paidOn: string) {
    removeDraft(id);
    setFilters(NO_PAYMENT_FILTERS);
    setPage({ anchor: paidOn });
  }

  // Picking a player from the search bar seeds a pre-filled draft row so only
  // the payment type and amount are left to enter.
  function handlePick(match: PlayerMatch) {
    addDraft({
      division: match.team.division,
      teamId: String(match.team.id),
      playerId: String(match.player.id),
    });
  }

  // Narrowing the ledger renumbers its pages, so start again from the first —
  // page 4 of the old list rarely means anything in the new one.
  function changeFilters(next: Filters) {
    setFilters(next);
    setPage(1);
  }

  function goToPage(next: number) {
    setPage(next);
    // A full page is taller than most screens, so paging from the controls
    // beneath it would otherwise leave you looking at the new page's last rows.
    scrollRef.current?.scrollIntoView({ block: "start" });
  }

  // Resize around the row you're looking at rather than throwing you back to
  // the top of a long ledger.
  function changePageSize(size: number) {
    setPageSize(size);
    setPage(size === ALL_ROWS ? 1 : Math.floor(start / size) + 1);
  }

  const hasTeams = teams.length > 0;

  // The summary beside "Add Payment". While the pager is up it already says how
  // many rows are on screen out of how many, so this line carries only the
  // money — repeating the counts a few pixels below them just reads as noise.
  const countLine = paginating
    ? filtering
      ? `${formatMoney(shownTotal)} of ${formatMoney(allTotal)} received`
      : `${formatMoney(allTotal)} received`
    : filtering
      ? `${filtered.length} of ${payments.length} payments · ${formatMoney(
          shownTotal,
        )} of ${formatMoney(allTotal)} received`
      : `${payments.length} ${
          payments.length === 1 ? "payment" : "payments"
        } · ${formatMoney(allTotal)} received`;

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Payment Tracker</h1>
        <p>
          Log each payment against a player: pick the division, team, and player,
          choose Check or Cash, and enter the amount. The Total column
          accumulates every payment received. Narrow the ledger with the filters
          below — a CSV, Excel or PDF download carries everything they show, not
          just the page on screen.
        </p>
      </div>

      {!hasTeams ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            💳
          </div>
          <p className="empty-title">No teams yet</p>
          <p className="empty-sub">
            Head to the{" "}
            <Link className="inline-link" href="/teams">
              Teams
            </Link>{" "}
            tab to create a team and add players, then come back here to record
            payments.
          </p>
        </div>
      ) : (
        <>
          <PaymentSearch
            teams={teams}
            players={players}
            onPick={handlePick}
          />

          {payments.length > 0 ? (
            <PaymentFilters
              payments={payments}
              filters={filters}
              onChange={changeFilters}
              shownCount={filtered.length}
            />
          ) : null}

          <div className="pay-scroll" ref={scrollRef}>
            <table className="pay-table">
              <colgroup>
                <col className="pc-date" />
                <col className="pc-div" />
                <col className="pc-team" />
                <col className="pc-player" />
                <col className="pc-type" />
                <col className="pc-check" />
                <col className="pc-amount" />
                <col className="pc-total" />
                <col className="pc-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Division</th>
                  <th>Team Name</th>
                  <th>Player Name</th>
                  <th>Payment Type</th>
                  <th>Check #</th>
                  <th className="pay-num">Amount</th>
                  <th className="pay-num">Total</th>
                  <th className="col-actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && drafts.length === 0 ? (
                  <tr>
                    <td colSpan={COL_COUNT} className="pay-empty">
                      {filtering ? (
                        <>
                          No payments match these filters.{" "}
                          <button
                            type="button"
                            className="dir-clear-all"
                            onClick={() => changeFilters(NO_PAYMENT_FILTERS)}
                          >
                            Clear filters
                          </button>
                        </>
                      ) : (
                        "No payments recorded yet — click “Add Payment” to log one."
                      )}
                    </td>
                  </tr>
                ) : null}

                {pageRows.map(({ payment, runningTotal }) => (
                  <tr key={payment.id}>
                    <td className="pay-nowrap">{formatDate(payment.paid_on)}</td>
                    <td className="pay-trunc" title={divisionLabel(payment.division)}>
                      {divisionLabel(payment.division)}
                    </td>
                    <td className="pay-trunc" title={payment.team_name}>
                      {payment.team_name}
                    </td>
                    <td className="col-name pay-trunc" title={payment.player_name}>
                      {payment.player_name}
                    </td>
                    <td>
                      <span
                        className={`pay-type pay-type-${payment.payment_type}`}
                      >
                        {paymentTypeLabel(payment.payment_type)}
                      </span>
                    </td>
                    <td className="pay-check">
                      {payment.check_number ? (
                        payment.check_number
                      ) : (
                        <span className="pay-dash" aria-hidden="true">
                          —
                        </span>
                      )}
                    </td>
                    <td className="pay-num">{formatMoney(payment.amount)}</td>
                    <td className="pay-num pay-running">
                      {formatMoney(runningTotal)}
                    </td>
                    <td className="col-actions">
                      <ConfirmButton
                        action={deletePaymentAction}
                        hidden={{ paymentId: payment.id }}
                        confirmText={`Remove this ${formatMoney(
                          payment.amount,
                        )} payment for ${payment.player_name}?`}
                        className="row-delete"
                      >
                        Remove
                      </ConfirmButton>
                    </td>
                  </tr>
                ))}

                {/* Drafts follow whichever page you're on rather than living on
                    one of them: paging away from a half-typed row shouldn't
                    throw the typing away. */}
                {drafts.map((draft) => (
                  <PaymentDraftRow
                    key={draft.id}
                    id={draft.id}
                    teams={teams}
                    players={players}
                    initial={draft.initial}
                    onRemove={removeDraft}
                    onSaved={handleSaved}
                  />
                ))}
              </tbody>
              <tfoot>
                {/* The total for everything the filters show, not just this
                    page — a grand total that shrank as you paged would read as
                    money going missing. */}
                <tr className="pay-total-row">
                  <td colSpan={7} className="pay-total-label">
                    {filtering
                      ? "Total for these filters"
                      : "Total payments received"}
                  </td>
                  <td className="pay-num pay-grand">{formatMoney(shownTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {paginating ? (
            <PaymentPager
              page={currentPage}
              pageCount={pageCount}
              pageSize={pageSize}
              from={start + 1}
              to={start + pageRows.length}
              total={filtered.length}
              onPage={goToPage}
              onPageSize={changePageSize}
            />
          ) : null}

          <div className="pay-actions">
            <button
              type="button"
              className="btn-add-payment"
              onClick={() => addDraft()}
            >
              <span aria-hidden="true">+</span> Add Payment
            </button>
            <span className="pay-count">{countLine}</span>
          </div>
        </>
      )}
    </section>
  );
}
