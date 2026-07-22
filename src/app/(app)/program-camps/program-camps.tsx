"use client";

import { useMemo, useRef, useState } from "react";
import ConfirmButton from "../teams/confirm-button";
import {
  deleteCampAction,
  deleteCampPaymentAction,
  deleteCampPlayerAction,
} from "./actions";
import AddCampPlayerForm from "./add-camp-player-form";
import CampPaymentDraftRow from "./camp-payment-draft-row";
import CreateCamp from "./create-camp";
import {
  formatDate,
  formatMoney,
  paymentTypeLabel,
  type CampOption,
  type CampPaymentRow,
  type CampPlayerRow,
} from "./camps";

// A draft (unsaved) payment row. `playerId` is set when the row is seeded from
// a roster row so its Player starts filled in.
type Draft = { id: number; playerId?: string };

// Roster columns: Player, Parent, Contact, Location, Paid, Actions.
const ROSTER_COL_COUNT = 6;
// Payment columns: Date, Player, Type, Check #, Amount, Total, Actions.
const PAY_COL_COUNT = 7;

function Dash() {
  return (
    <span className="pay-dash" aria-hidden="true">
      —
    </span>
  );
}

export default function ProgramCamps({
  camps,
  players,
  payments,
}: {
  camps: CampOption[];
  players: CampPlayerRow[];
  payments: CampPaymentRow[];
}) {
  // Which camp's roster + payments are shown below. Defaults to the first camp;
  // if the selection no longer exists (e.g. the camp was deleted), fall back to
  // the first camp too.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selectedCamp =
    camps.find((c) => c.id === selectedId) ?? camps[0] ?? null;

  // Draft (unsaved) payment rows for the selected camp, each with a stable key.
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const nextDraftId = useRef(1);

  // Reset open payment drafts whenever the shown camp changes — whether the user
  // picked a different card or the selected camp was deleted and the selection
  // fell back to another camp. Draft rows reference the shown camp's roster, so
  // this guarantees a draft never saves a payment against a player from a
  // different camp. (Adjusting state during render per the React docs; the ref
  // guard keeps it from looping.)
  const shownCampId = selectedCamp?.id ?? null;
  const prevCampId = useRef(shownCampId);
  if (prevCampId.current !== shownCampId) {
    prevCampId.current = shownCampId;
    if (drafts.length > 0) setDrafts([]);
  }

  function selectCamp(id: number) {
    setSelectedId(id);
  }

  function addDraft(playerId?: string) {
    setDrafts((cur) => [...cur, { id: nextDraftId.current++, playerId }]);
  }

  function removeDraft(id: number) {
    setDrafts((cur) => cur.filter((d) => d.id !== id));
  }

  // Total collected per camp and roster size per camp, for the camp cards.
  const { collectedByCamp, countByCamp, paidByPlayer } = useMemo(() => {
    const collected = new Map<number, number>();
    const paid = new Map<number, number>();
    for (const p of payments) {
      const amt = Number(p.amount) || 0;
      collected.set(p.camp_id, (collected.get(p.camp_id) ?? 0) + amt);
      paid.set(p.camp_player_id, (paid.get(p.camp_player_id) ?? 0) + amt);
    }
    const count = new Map<number, number>();
    for (const pl of players) {
      count.set(pl.camp_id, (count.get(pl.camp_id) ?? 0) + 1);
    }
    return { collectedByCamp: collected, countByCamp: count, paidByPlayer: paid };
  }, [payments, players]);

  const campId = selectedCamp?.id ?? null;
  const campPlayers = campId
    ? players.filter((p) => p.camp_id === campId)
    : [];
  const campPayments = campId
    ? payments.filter((p) => p.camp_id === campId)
    : [];

  // The Total column accumulates across the selected camp's payments in display
  // order, so the last row's running total equals the camp's grand total.
  let running = 0;
  const savedRows = campPayments.map((payment) => {
    running += Number(payment.amount) || 0;
    return { payment, runningTotal: running };
  });
  const grandTotal = running;

  const hasCamps = camps.length > 0;
  const hasPlayers = campPlayers.length > 0;

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Program/Camps</h1>
          <p>
            Create a camp, add players with their parent&apos;s name, contact,
            and location, then track each payment they make — the Total column
            accumulates every payment received, just like the Payment Tracker.
          </p>
        </div>
      </section>

      {/* Step 1 — create and pick a camp */}
      <section className="panel">
        <div className="panel-head">
          <h2 className="step-title">
            <span className="step-num">1</span> Camps
          </h2>
          <p>
            Name a camp and optionally add a location and date. Select a camp to
            manage its roster and payments below.
          </p>
        </div>

        <CreateCamp />

        {camps.length === 0 ? (
          <p className="muted-note">
            No camps yet — create one above to get started.
          </p>
        ) : (
          <ul className="camp-list">
            {camps.map((camp) => {
              const active = camp.id === selectedCamp?.id;
              const collected = collectedByCamp.get(camp.id) ?? 0;
              const count = countByCamp.get(camp.id) ?? 0;
              return (
                <li
                  key={camp.id}
                  className={`camp-item${active ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="camp-item-select"
                    aria-pressed={active}
                    onClick={() => selectCamp(camp.id)}
                  >
                    <span className="camp-item-name">{camp.name}</span>
                    {camp.location || camp.event_date ? (
                      <span className="camp-item-meta">
                        {[
                          camp.location,
                          camp.event_date ? formatDate(camp.event_date) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                    <span className="camp-item-stats">
                      <span className="camp-collected">
                        {formatMoney(collected)}
                      </span>
                      <span className="camp-count">
                        {count} {count === 1 ? "player" : "players"}
                      </span>
                    </span>
                  </button>
                  <ConfirmButton
                    action={deleteCampAction}
                    hidden={{ campId: camp.id }}
                    confirmText={`Delete "${camp.name}" and all of its players and payments?`}
                    className="row-delete camp-item-delete"
                  >
                    Remove
                  </ConfirmButton>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Step 2 — the selected camp's roster */}
      {hasCamps && selectedCamp ? (
        <section className="panel">
          <div className="panel-head">
            <h2 className="step-title">
              <span className="step-num">2</span> Players
              <span className="step-context">· {selectedCamp.name}</span>
            </h2>
            <p>
              Add each player to <strong>{selectedCamp.name}</strong> with their
              parent&apos;s name, a parent contact, and a location.
            </p>
          </div>

          {/* Re-mount the form when the camp changes so its hidden campId and
              any half-typed values reset cleanly. */}
          <AddCampPlayerForm key={selectedCamp.id} campId={selectedCamp.id} />

          <div className="pay-scroll">
            <table className="pay-table camp-roster-table">
              <colgroup>
                <col className="crn-name" />
                <col className="crn-parent" />
                <col className="crn-contact" />
                <col className="crn-location" />
                <col className="crn-paid" />
                <col className="crn-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Player Name</th>
                  <th>Parent Name</th>
                  <th>Parent Contact</th>
                  <th>Location</th>
                  <th className="pay-num">Paid</th>
                  <th className="col-actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {campPlayers.length === 0 ? (
                  <tr>
                    <td colSpan={ROSTER_COL_COUNT} className="pay-empty">
                      No players yet — add one above to start this camp&apos;s
                      roster.
                    </td>
                  </tr>
                ) : (
                  campPlayers.map((player) => (
                    <tr key={player.id}>
                      <td className="col-name pay-trunc" title={player.player_name}>
                        {player.player_name}
                      </td>
                      <td
                        className="pay-trunc"
                        title={player.parent_name ?? undefined}
                      >
                        {player.parent_name || <Dash />}
                      </td>
                      <td
                        className="pay-trunc"
                        title={player.parent_contact ?? undefined}
                      >
                        {player.parent_contact || <Dash />}
                      </td>
                      <td
                        className="pay-trunc"
                        title={player.location ?? undefined}
                      >
                        {player.location || <Dash />}
                      </td>
                      <td className="pay-num pay-running">
                        {formatMoney(paidByPlayer.get(player.id) ?? 0)}
                      </td>
                      <td className="col-actions">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="camp-add-pay"
                            onClick={() => addDraft(String(player.id))}
                          >
                            Add payment
                          </button>
                          <ConfirmButton
                            action={deleteCampPlayerAction}
                            hidden={{ playerId: player.id }}
                            confirmText={`Remove ${player.player_name} from ${selectedCamp.name}? This also removes their payments.`}
                            className="row-delete"
                          >
                            Remove
                          </ConfirmButton>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Step 3 — payments for the selected camp */}
      {hasCamps && selectedCamp ? (
        <section className="panel">
          <div className="panel-head">
            <h2 className="step-title">
              <span className="step-num">3</span> Payments
              <span className="step-context">· {selectedCamp.name}</span>
            </h2>
            <p>
              Log each payment against a player: pick the player, choose Check or
              Cash, and enter the amount. The Total column accumulates every
              payment received for this camp.
            </p>
          </div>

          <div className="pay-scroll">
            <table className="pay-table camp-pay-table">
              <colgroup>
                <col className="cpn-date" />
                <col className="cpn-player" />
                <col className="cpn-type" />
                <col className="cpn-check" />
                <col className="cpn-amount" />
                <col className="cpn-total" />
                <col className="cpn-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th>Date</th>
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
                    <td colSpan={PAY_COL_COUNT} className="pay-empty">
                      No payments recorded yet — click “Add Payment” to log one.
                    </td>
                  </tr>
                ) : null}

                {savedRows.map(({ payment, runningTotal }) => (
                  <tr key={payment.id}>
                    <td className="pay-nowrap">{formatDate(payment.paid_on)}</td>
                    <td className="col-name pay-trunc" title={payment.player_name}>
                      {payment.player_name}
                    </td>
                    <td>
                      <span className={`pay-type pay-type-${payment.payment_type}`}>
                        {paymentTypeLabel(payment.payment_type)}
                      </span>
                    </td>
                    <td className="pay-check">
                      {payment.check_number ? payment.check_number : <Dash />}
                    </td>
                    <td className="pay-num">{formatMoney(payment.amount)}</td>
                    <td className="pay-num pay-running">
                      {formatMoney(runningTotal)}
                    </td>
                    <td className="col-actions">
                      <ConfirmButton
                        action={deleteCampPaymentAction}
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
                  <CampPaymentDraftRow
                    key={draft.id}
                    id={draft.id}
                    players={campPlayers}
                    initialPlayerId={draft.playerId}
                    onRemove={removeDraft}
                    onSaved={removeDraft}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="pay-total-row">
                  <td colSpan={5} className="pay-total-label">
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
              onClick={() => addDraft()}
              disabled={!hasPlayers}
            >
              <span aria-hidden="true">+</span> Add Payment
            </button>
            {hasPlayers ? (
              <span className="pay-count">
                {campPayments.length}{" "}
                {campPayments.length === 1 ? "payment" : "payments"} ·{" "}
                {formatMoney(grandTotal)} received
              </span>
            ) : (
              <span className="pay-count">
                Add a player above before logging payments.
              </span>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
