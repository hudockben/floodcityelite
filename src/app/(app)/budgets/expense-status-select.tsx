"use client";

import { useEffect, useState } from "react";
import { updateExpenseStatusAction } from "./actions";
import { EXPENSE_STATUSES, type ExpenseStatus } from "./budget";

// The inline Paid/Not Paid/Refund dropdown shown in each expense row. Changing
// it submits the (void) server action immediately; local state gives instant
// colour feedback while the page revalidates and the balance updates.
export default function ExpenseStatusSelect({
  expenseId,
  value,
}: {
  expenseId: number;
  value: ExpenseStatus;
}) {
  const [status, setStatus] = useState<ExpenseStatus>(value);

  // Keep the pill in sync if the server value changes underneath us (e.g. after
  // a revalidation triggered by editing the row).
  useEffect(() => {
    setStatus(value);
  }, [value]);

  return (
    <form action={updateExpenseStatusAction} className="status-form">
      <input type="hidden" name="expenseId" value={expenseId} />
      <select
        name="status"
        className={`status-select expense-status-${status}`}
        value={status}
        aria-label="Expense status"
        onChange={(e) => {
          setStatus(e.currentTarget.value as ExpenseStatus);
          e.currentTarget.form?.requestSubmit();
        }}
      >
        {EXPENSE_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </form>
  );
}
