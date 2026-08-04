"use client";

import { useMemo, useRef, useState } from "react";
import ExportButtons from "../export-buttons";
import ConfirmButton from "../teams/confirm-button";
import {
  deleteCampAction,
  deleteCampPaymentAction,
  deleteCampPlayerAction,
} from "./actions";
import AddCampPlayerForm from "./add-camp-player-form";
import CampExpenses from "./camp-expenses";
import CampPaymentDraftRow from "./camp-payment-draft-row";
import CreateCamp from "./create-camp";
import {
  amountToCents,
  formatCents,
  formatDate,
  formatMoney,
  paymentTypeLabel,
  summarizeExpenses,
  type CampExpenseRow,
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
  expenses,
}: {
  camps: CampOption[];
  players: CampPlayerRow[];
  payments: CampPaymentRow[];
  expenses: CampExpenseRow[];
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

  // Per-camp roll-ups for the camp cards: what came in, what the camp cost, and
  // its roster size — plus what each player has paid, for the roster table.
  // Money is accumulated in integer cents so a camp that exactly broke even
  // reads "$0.00" rather than a float-drifted "−$0.00".
  const { collectedByCamp, expenseNetByCamp, countByCamp, paidByPlayer } =
    useMemo(() => {
      const collected = new Map<number, number>();
      const paid = new Map<number, number>();
      for (const p of payments) {
        const cents = amountToCents(p.amount);
        collected.set(p.camp_id, (collected.get(p.camp_id) ?? 0) + cents);
        paid.set(p.camp_player_id, (paid.get(p.camp_player_id) ?? 0) + cents);
      }
      // Only paid expenses (less refunds) move a camp's net; a Not Paid one is
      // tracked without changing it — same rule as the Budgets tab, applied by
      // the same helper.
      const byCamp = new Map<number, CampExpenseRow[]>();
      for (const e of expenses) {
        const list = byCamp.get(e.camp_id);
        if (list) list.push(e);
        else byCamp.set(e.camp_id, [e]);
      }
      const expenseNet = new Map<number, number>();
      for (const [id, rows] of byCamp) {
        expenseNet.set(id, summarizeExpenses(rows).netCents);
      }
      const count = new Map<number, number>();
      for (const pl of players) {
        count.set(pl.camp_id, (count.get(pl.camp_id) ?? 0) + 1);
      }
      return {
        collectedByCamp: collected,
        expenseNetByCamp: expenseNet,
        countByCamp: count,
        paidByPlayer: paid,
      };
    }, [payments, players, expenses]);

  const campId = selectedCamp?.id ?? null;
  const campPlayers = campId
    ? players.filter((p) => p.camp_id === campId)
    : [];
  const campPayments = campId
    ? payments.filter((p) => p.camp_id === campId)
    : [];
  const campExpenses = campId
    ? expenses.filter((e) => e.camp_id === campId)
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

  // Download links for the shown camp's three tables. The route re-reads the
  // camp from the database, so a file always holds the rows the tab is showing.
  const sheetHref =
    (sheet: "roster" | "payments" | "expenses") =>
    (format: "csv" | "xlsx") =>
      `/program-camps/export?camp=${campId}&sheet=${sheet}&format=${format}`;
  // One printable report covers the whole camp — roster, payments, and expenses
  // on a single document — so the ⬇ PDF button offers the same report wherever
  // it sits, and says so in its accessible label.
  const printHref = `/program-camps/print?camp=${campId}`;
  const printLabel = selectedCamp
    ? `Open a printable PDF report for ${selectedCamp.name}`
    : undefined;

  return (
    <div className="teams">
      <section className="panel">
        <div className="panel-head">
          <h1>Program/Camps</h1>
          <p>
            Create a camp, add players with their parent&apos;s name, contact,
            and location, then track each payment they make — the Total column
            accumulates every payment received, just like the Payment Tracker.
            Log what the camp cost to put on under Expenses and the tab reports
            the camp&apos;s net. Each section below downloads as CSV or Excel,
            and ⬇ PDF prints the whole camp — roster, payments and expenses —
            as one report.
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
              const spent = expenseNetByCamp.get(camp.id) ?? 0;
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
                        {formatCents(collected)}
                      </span>
                      <span className="camp-count">
                        {count} {count === 1 ? "player" : "players"}
                      </span>
                    </span>
                    {/* Only worth a line once the camp has cost something —
                        otherwise the net is just the collected figure again.
                        A negative `spent` means refunds outran paid expenses,
                        so it reads as money back rather than an expense. */}
                    {spent !== 0 ? (
                      <span className="camp-item-net">
                        {spent > 0
                          ? `${formatCents(spent)} expenses`
                          : `${formatCents(-spent)} refunded`}{" "}
                        ·{" "}
                        <strong
                          className={
                            collected - spent < 0 ? "camp-net-down" : "camp-net-up"
                          }
                        >
                          {collected - spent < 0 ? "−" : ""}
                          {formatCents(Math.abs(collected - spent))} net
                        </strong>
                      </span>
                    ) : null}
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
          <div className="panel-head panel-head-row">
            <div>
              <h2 className="step-title">
                <span className="step-num">2</span> Players
                <span className="step-context">· {selectedCamp.name}</span>
              </h2>
              <p>
                Add each player to <strong>{selectedCamp.name}</strong> with
                their parent&apos;s name, a parent contact, and a location.
              </p>
            </div>
            <ExportButtons
              href={sheetHref("roster")}
              pdfHref={printHref}
              pdfLabel={printLabel}
              count={campPlayers.length}
              nounPlural="players"
            />
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
                        {formatCents(paidByPlayer.get(player.id) ?? 0)}
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
          <div className="panel-head panel-head-row">
            <div>
              <h2 className="step-title">
                <span className="step-num">3</span> Payments
                <span className="step-context">· {selectedCamp.name}</span>
              </h2>
              <p>
                Log each payment against a player: pick the player, choose Check
                or Cash, and enter the amount. The Total column accumulates
                every payment received for this camp.
              </p>
            </div>
            <ExportButtons
              href={sheetHref("payments")}
              pdfHref={printHref}
              pdfLabel={printLabel}
              count={campPayments.length}
              nounPlural="payments"
            />
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

      {/* Step 4 — what the camp cost to put on */}
      {hasCamps && selectedCamp ? (
        <section className="panel">
          <div className="panel-head panel-head-row">
            <div>
              <h2 className="step-title">
                <span className="step-num">4</span> Expenses
                <span className="step-context">· {selectedCamp.name}</span>
              </h2>
              <p>
                Log what running <strong>{selectedCamp.name}</strong> cost —
                umpire fees for a showcase, field rental, gear. A paid expense
                comes off what the camp collected, a refund is credited back,
                and a not-paid one is tracked without moving the net.
              </p>
            </div>
            <ExportButtons
              href={sheetHref("expenses")}
              pdfHref={printHref}
              pdfLabel={printLabel}
              count={campExpenses.length}
              nounPlural="expenses"
            />
          </div>

          {/* Re-mount when the camp changes so the add form's hidden campId and
              any half-typed values reset cleanly. */}
          <CampExpenses
            key={selectedCamp.id}
            campId={selectedCamp.id}
            campName={selectedCamp.name}
            expenses={campExpenses}
            collectedCents={collectedByCamp.get(selectedCamp.id) ?? 0}
          />
        </section>
      ) : null}
    </div>
  );
}
