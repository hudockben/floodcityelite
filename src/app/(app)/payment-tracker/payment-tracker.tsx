"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import ConfirmButton from "../teams/confirm-button";
import { divisionLabel, type Division } from "../teams/divisions";
import { deletePaymentAction } from "./actions";
import PaymentDraftRow, { type DraftInitial } from "./payment-draft-row";
import PaymentFilters from "./payment-filters";
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

// Date, Division, Team, Player, Type, Check #, Amount, Total, Actions.
const COL_COUNT = 9;

export default function PaymentTracker({
  teams,
  players,
  payments,
  divisions,
}: {
  teams: TeamOption[];
  players: PlayerOption[];
  payments: PaymentRow[];
  /** The company's divisions, for the Division dropdown, filter, and labels. */
  divisions: Division[];
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

  function addDraft(initial?: DraftInitial) {
    setDrafts((cur) => [...cur, { id: nextDraftId.current++, initial }]);
  }

  function removeDraft(id: number) {
    setDrafts((cur) => cur.filter((d) => d.id !== id));
  }

  // A payment saved while the ledger is filtered often falls outside what's
  // being shown — today's date against a range set up for a download, a check
  // while the Type filter says Cash — and a row that vanishes the instant it
  // saves reads as a failure. Dropping the filters puts it back on screen.
  function handleSaved(id: number) {
    removeDraft(id);
    setFilters(NO_PAYMENT_FILTERS);
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

  // Everything on a payment, lowercased, memoized so the search box doesn't
  // rebuild every haystack on each keystroke.
  const searchText = useMemo(
    () => new Map(payments.map((p) => [p.id, paymentSearchText(p, divisions)])),
    [payments, divisions],
  );

  const filtered = useMemo(
    () =>
      payments.filter((p) =>
        matchesPaymentFilters(p, filters, divisions, searchText.get(p.id)),
      ),
    [payments, filters, searchText, divisions],
  );

  // The Total column accumulates across the payments on screen in display
  // order, so the last row's running total equals the total below the table —
  // under a filter that's the total for the slice being shown, which is the
  // figure the download and the printed report carry too. Kept in cents so a
  // long ledger can't drift a penny.
  let runningCents = 0;
  const savedRows = filtered.map((payment) => {
    runningCents += amountToCents(payment.amount);
    return { payment, runningTotal: runningCents / 100 };
  });
  const shownTotal = runningCents / 100;
  // The whole ledger's total, so a filtered view can say what it's a slice of.
  const allTotal = sumPaymentCents(payments) / 100;
  const filtering = isFiltering(filters);

  const hasTeams = teams.length > 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Payment Tracker</h1>
        <p>
          Log each payment against a player: pick the division, team, and player,
          choose Check or Cash, and enter the amount. The Total column
          accumulates every payment received. Narrow the ledger with the filters
          below — a CSV, Excel or PDF download carries exactly what they show.
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
            divisions={divisions}
            onPick={handlePick}
          />

          {payments.length > 0 ? (
            <PaymentFilters
              payments={payments}
              divisions={divisions}
              filters={filters}
              onChange={setFilters}
              shownCount={filtered.length}
            />
          ) : null}

          <div className="pay-scroll">
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
                {savedRows.length === 0 && drafts.length === 0 ? (
                  <tr>
                    <td colSpan={COL_COUNT} className="pay-empty">
                      {filtering ? (
                        <>
                          No payments match these filters.{" "}
                          <button
                            type="button"
                            className="dir-clear-all"
                            onClick={() => setFilters(NO_PAYMENT_FILTERS)}
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

                {savedRows.map(({ payment, runningTotal }) => (
                  <tr key={payment.id}>
                    <td className="pay-nowrap">{formatDate(payment.paid_on)}</td>
                    <td
                      className="pay-trunc"
                      title={divisionLabel(payment.division, divisions)}
                    >
                      {divisionLabel(payment.division, divisions)}
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

                {drafts.map((draft) => (
                  <PaymentDraftRow
                    key={draft.id}
                    id={draft.id}
                    teams={teams}
                    players={players}
                    divisions={divisions}
                    initial={draft.initial}
                    onRemove={removeDraft}
                    onSaved={handleSaved}
                  />
                ))}
              </tbody>
              <tfoot>
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

          <div className="pay-actions">
            <button
              type="button"
              className="btn-add-payment"
              onClick={() => addDraft()}
            >
              <span aria-hidden="true">+</span> Add Payment
            </button>
            <span className="pay-count">
              {filtering ? (
                <>
                  {filtered.length} of {payments.length} payments ·{" "}
                  {formatMoney(shownTotal)} of {formatMoney(allTotal)} received
                </>
              ) : (
                <>
                  {payments.length}{" "}
                  {payments.length === 1 ? "payment" : "payments"} ·{" "}
                  {formatMoney(allTotal)} received
                </>
              )}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
