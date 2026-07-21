"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import ConfirmButton from "../teams/confirm-button";
import { DIVISIONS } from "../teams/divisions";
import { deletePaymentAction } from "./actions";
import PaymentDraftRow from "./payment-draft-row";
import {
  formatDate,
  formatMoney,
  paymentTypeLabel,
  type PaymentRow,
  type PlayerOption,
  type TeamOption,
} from "./payments";

// Date, Division, Team, Player, Type, Amount, Total, Actions.
const COL_COUNT = 8;

function divisionLabel(slug: string): string {
  return DIVISIONS.find((d) => d.slug === slug)?.label ?? slug;
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
  // Draft (unsaved) rows added by "Add Payment", tracked by a stable key.
  const [drafts, setDrafts] = useState<number[]>([]);
  const nextDraftId = useRef(1);

  function addDraft() {
    setDrafts((cur) => [...cur, nextDraftId.current++]);
  }

  function removeDraft(id: number) {
    setDrafts((cur) => cur.filter((d) => d !== id));
  }

  // The Total column accumulates across saved payments in display order, so the
  // last row's running total equals the grand total received.
  let running = 0;
  const savedRows = payments.map((payment) => {
    running += Number(payment.amount) || 0;
    return { payment, runningTotal: running };
  });
  const grandTotal = running;

  const hasTeams = teams.length > 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Payment Tracker</h1>
        <p>
          Log each payment against a player: pick the division, team, and player,
          choose Check or Cash, and enter the amount. The Total column
          accumulates every payment received.
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
          <div className="pay-scroll">
            <table className="pay-table">
              <colgroup>
                <col className="pc-date" />
                <col className="pc-div" />
                <col className="pc-team" />
                <col className="pc-player" />
                <col className="pc-type" />
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
                      No payments recorded yet — click “Add Payment” to log one.
                    </td>
                  </tr>
                ) : null}

                {savedRows.map(({ payment, runningTotal }) => (
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

                {drafts.map((id) => (
                  <PaymentDraftRow
                    key={id}
                    id={id}
                    teams={teams}
                    players={players}
                    onRemove={removeDraft}
                    onSaved={removeDraft}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="pay-total-row">
                  <td colSpan={6} className="pay-total-label">
                    Total payments received
                  </td>
                  <td className="pay-num pay-grand">{formatMoney(grandTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="pay-actions">
            <button
              type="button"
              className="btn-add-payment"
              onClick={addDraft}
            >
              <span aria-hidden="true">+</span> Add Payment
            </button>
            <span className="pay-count">
              {payments.length}{" "}
              {payments.length === 1 ? "payment" : "payments"} ·{" "}
              {formatMoney(grandTotal)} received
            </span>
          </div>
        </>
      )}
    </section>
  );
}
