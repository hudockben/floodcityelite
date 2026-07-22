"use client";

import { useActionState, useEffect, useState } from "react";
import {
  deleteExpenseAction,
  updateExpenseAction,
  type FormState,
} from "./actions";
import ConfirmButton from "../teams/confirm-button";
import ExpenseStatusSelect from "./expense-status-select";
import {
  EXPENSE_STATUSES,
  amountToCents,
  formatCents,
  formatDate,
  type ExpenseRow as ExpenseRowData,
} from "./budget";

const initialState: FormState = {};

export default function ExpenseRow({
  expense,
  division,
}: {
  expense: ExpenseRowData;
  division: string;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(
    updateExpenseAction,
    initialState,
  );

  // Collapse the editor once a save succeeds; fresh values arrive via
  // revalidation so the display row shows the update.
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  const label = expense.vendor ?? "this expense";

  if (editing) {
    return (
      <tr className="expense-edit-row">
        <td colSpan={5}>
          <form action={formAction} className="expense-edit-form">
            <input type="hidden" name="expenseId" value={expense.id} />
            <input type="hidden" name="division" value={division} />

            <div className="expense-edit-grid">
              <div className="field">
                <label htmlFor={`exp-${expense.id}-date`}>Date</label>
                <input
                  id={`exp-${expense.id}-date`}
                  name="expense_date"
                  type="date"
                  defaultValue={expense.expense_date ?? ""}
                  autoComplete="off"
                />
              </div>

              <div className="field">
                <label htmlFor={`exp-${expense.id}-vendor`}>Vendor</label>
                <input
                  id={`exp-${expense.id}-vendor`}
                  name="vendor"
                  type="text"
                  defaultValue={expense.vendor ?? ""}
                  placeholder="e.g. Hampton Inn"
                  autoComplete="off"
                />
              </div>

              <div className="field">
                <label htmlFor={`exp-${expense.id}-amount`}>Total Cost *</label>
                <input
                  id={`exp-${expense.id}-amount`}
                  name="amount"
                  type="number"
                  min={0}
                  step="0.01"
                  defaultValue={expense.amount ?? ""}
                  required
                  autoComplete="off"
                />
              </div>

              <div className="field">
                <label htmlFor={`exp-${expense.id}-status`}>Status</label>
                <select
                  id={`exp-${expense.id}-status`}
                  name="status"
                  defaultValue={expense.status}
                >
                  {EXPENSE_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="expense-edit-actions">
              <button type="submit" className="btn" disabled={pending}>
                {pending ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditing(false)}
                disabled={pending}
              >
                Cancel
              </button>
              {state?.error ? (
                <p className="error expense-form-msg" role="alert">
                  {state.error}
                </p>
              ) : null}
            </div>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="exp-date">{formatDate(expense.expense_date)}</td>
      <td className="exp-vendor">
        {expense.vendor ? expense.vendor : <span className="cell-empty">—</span>}
      </td>
      <td className="exp-amount">{formatCents(amountToCents(expense.amount))}</td>
      <td className="exp-status">
        <ExpenseStatusSelect expenseId={expense.id} value={expense.status} />
      </td>
      <td className="col-actions">
        <div className="row-actions">
          <button
            type="button"
            className="row-edit"
            onClick={() => setEditing(true)}
          >
            Edit
          </button>
          <ConfirmButton
            action={deleteExpenseAction}
            hidden={{ expenseId: expense.id, division }}
            confirmText={`Remove ${label} from this team's expenses?`}
            className="row-delete"
          >
            Remove
          </ConfirmButton>
        </div>
      </td>
    </tr>
  );
}
