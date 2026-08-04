"use client";

import { useActionState, useEffect, useRef } from "react";
import { addCampExpenseAction, type FormState } from "./actions";
import CampExpenseRow from "./camp-expense-row";
import {
  DEFAULT_EXPENSE_STATUS,
  EXPENSE_STATUSES,
  formatCents,
  summarizeExpenses,
  type CampExpenseRow as CampExpenseRowData,
} from "./camps";

const initialState: FormState = {};

// The expenses panel for the selected camp — what putting the camp on cost
// (umpire fees for a showcase, field rental, gear). A Paid expense comes off
// what the camp collected, a Refund is credited back, and a Not Paid one is
// tracked without moving the net. Adding, editing, or restatusing a row runs a
// server action that revalidates the page, so the camp cards above and the net
// below update in step.
//
// Deliberately reuses the Budgets tab's expense classes and statuses: an
// expense should look and behave the same wherever it's logged.
export default function CampExpenses({
  campId,
  campName,
  expenses,
  collectedCents,
}: {
  campId: number;
  campName: string;
  expenses: CampExpenseRowData[];
  /** What this camp has taken in, in integer cents, for the net line. */
  collectedCents: number;
}) {
  const [state, formAction, pending] = useActionState(
    addCampExpenseAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs after a successful add so the next expense starts blank.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const totals = summarizeExpenses(expenses);
  const netCents = collectedCents - totals.netCents;

  return (
    <div className="camp-expenses">
      {/* Add an expense. Re-mounting on camp change is handled by the caller's
          key, so the hidden campId always matches the camp on screen. */}
      <form ref={formRef} action={formAction} className="expense-add-form">
        <input type="hidden" name="campId" value={campId} />

        <div className="expense-add-grid">
          <div className="field">
            <label htmlFor={`add-camp-exp-${campId}-date`}>Date</label>
            <input
              id={`add-camp-exp-${campId}-date`}
              name="expense_date"
              type="date"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor={`add-camp-exp-${campId}-vendor`}>Expense</label>
            <input
              id={`add-camp-exp-${campId}-vendor`}
              name="vendor"
              type="text"
              placeholder="e.g. Umpire fees"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor={`add-camp-exp-${campId}-amount`}>Total Cost *</label>
            <input
              id={`add-camp-exp-${campId}-amount`}
              name="amount"
              type="number"
              min={0}
              step="0.01"
              placeholder="0.00"
              required
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor={`add-camp-exp-${campId}-status`}>Status</label>
            <select
              id={`add-camp-exp-${campId}-status`}
              name="status"
              defaultValue={DEFAULT_EXPENSE_STATUS}
            >
              {EXPENSE_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="expense-add-actions">
          <button type="submit" className="btn expense-add-btn" disabled={pending}>
            {pending ? "Adding…" : "Add expense"}
          </button>
          {state?.error ? (
            <p className="error expense-form-msg" role="alert">
              {state.error}
            </p>
          ) : null}
        </div>
      </form>

      {/* Logged expenses */}
      {expenses.length === 0 ? (
        <p className="expenses-empty">
          No expenses logged for {campName} yet — add the first one above.
        </p>
      ) : (
        <div className="expenses-scroll">
          <table className="expenses-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Expense</th>
                <th className="exp-amount">Total Cost</th>
                <th>Status</th>
                <th className="col-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((expense) => (
                <CampExpenseRow key={expense.id} expense={expense} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom line: what came in, what went out, what's left. Shown even with
          no expenses so the camp's net is always on screen. */}
      <dl className="expenses-totals camp-expenses-totals">
        <div className="et-row">
          <dt>Payments received</dt>
          <dd className="et-credit">{formatCents(collectedCents)}</dd>
        </div>
        <div className="et-row">
          <dt>Paid (deducted)</dt>
          <dd className="et-deduct">
            {totals.paidCents > 0 ? "−" : ""}
            {formatCents(totals.paidCents)}
          </dd>
        </div>
        {totals.refundCents > 0 ? (
          <div className="et-row">
            <dt>Refunds (credited back)</dt>
            <dd className="et-credit">+{formatCents(totals.refundCents)}</dd>
          </div>
        ) : null}
        {totals.notPaidCents > 0 ? (
          <div className="et-row">
            <dt>Not paid (tracked only)</dt>
            <dd className="et-muted">{formatCents(totals.notPaidCents)}</dd>
          </div>
        ) : null}
        <div className="et-row et-net">
          <dt>Net for {campName}</dt>
          <dd className={netCents < 0 ? "et-deduct-strong" : "et-credit"}>
            {netCents < 0 ? "−" : ""}
            {formatCents(Math.abs(netCents))}
          </dd>
        </div>
      </dl>
    </div>
  );
}
