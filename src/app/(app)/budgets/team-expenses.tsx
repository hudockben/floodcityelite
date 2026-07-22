"use client";

import { useActionState, useEffect, useRef } from "react";
import { addExpenseAction, type FormState } from "./actions";
import ExpenseRow from "./expense-row";
import {
  DEFAULT_EXPENSE_STATUS,
  EXPENSE_STATUSES,
  formatCents,
  summarizeExpenses,
  type ExpenseRow as ExpenseRowData,
} from "./budget";

const initialState: FormState = {};

// The expenses panel shown alongside each team's budget sheet. Coaches log
// ad-hoc costs (hotel, gas, gear…) here; a Paid expense is deducted from the
// team's current balance, a Refund is credited back, and a Not Paid expense is
// tracked without changing the balance. Adding, editing, or restatusing a row
// runs a server action that revalidates the page, so the balance on the left
// updates in step.
export default function TeamExpenses({
  teamId,
  division,
  expenses,
}: {
  teamId: number;
  division: string;
  expenses: ExpenseRowData[];
}) {
  const [state, formAction, pending] = useActionState(
    addExpenseAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs after a successful add so the next expense starts blank.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  const totals = summarizeExpenses(expenses);

  return (
    <div className="team-expenses">
      <div className="expenses-head">
        <h3 className="expenses-title">Team Expenses</h3>
        <p className="expenses-sub">
          Log coaching hotels, gas, gear and other costs. Paid expenses come off
          the current balance; a refund is credited back.
        </p>
      </div>

      {/* Add an expense */}
      <form ref={formRef} action={formAction} className="expense-add-form">
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="division" value={division} />

        <div className="expense-add-grid">
          <div className="field">
            <label htmlFor={`add-exp-${teamId}-date`}>Date</label>
            <input
              id={`add-exp-${teamId}-date`}
              name="expense_date"
              type="date"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor={`add-exp-${teamId}-vendor`}>Vendor</label>
            <input
              id={`add-exp-${teamId}-vendor`}
              name="vendor"
              type="text"
              placeholder="e.g. Hampton Inn"
              autoComplete="off"
            />
          </div>

          <div className="field">
            <label htmlFor={`add-exp-${teamId}-amount`}>Total Cost *</label>
            <input
              id={`add-exp-${teamId}-amount`}
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
            <label htmlFor={`add-exp-${teamId}-status`}>Status</label>
            <select
              id={`add-exp-${teamId}-status`}
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
          No expenses logged yet — add the first one above.
        </p>
      ) : (
        <>
          <div className="expenses-scroll">
            <table className="expenses-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th className="exp-amount">Total Cost</th>
                  <th>Status</th>
                  <th className="col-actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    division={division}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <dl className="expenses-totals">
            <div className="et-row">
              <dt>Paid (deducted)</dt>
              <dd className="et-deduct">
                {totals.paidCents > 0 ? "−" : ""}
                {formatCents(totals.paidCents)}
              </dd>
            </div>
            <div className="et-row">
              <dt>Refunds (credited back)</dt>
              <dd className="et-credit">
                {totals.refundCents > 0 ? "+" : ""}
                {formatCents(totals.refundCents)}
              </dd>
            </div>
            {totals.notPaidCents > 0 ? (
              <div className="et-row">
                <dt>Not paid (tracked only)</dt>
                <dd className="et-muted">{formatCents(totals.notPaidCents)}</dd>
              </div>
            ) : null}
            <div className="et-row et-net">
              <dt>Net off budget</dt>
              <dd
                className={totals.netCents < 0 ? "et-credit" : "et-deduct-strong"}
              >
                {totals.netCents > 0 ? "−" : totals.netCents < 0 ? "+" : ""}
                {formatCents(Math.abs(totals.netCents))}
              </dd>
            </div>
          </dl>
        </>
      )}
    </div>
  );
}
