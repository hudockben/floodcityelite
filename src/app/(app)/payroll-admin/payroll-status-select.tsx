"use client";

import { useOptimistic, useTransition } from "react";
import { updatePayrollStatusAction } from "./actions";
// From lib/payroll-status, not lib/payroll: the latter imports the database
// client, which a client component would then ship to the browser.
import { PAYROLL_STATUSES, type PayrollStatus } from "@/lib/payroll-status";

// The inline approval dropdown shown in each Submissions row — this is the
// admin approving/denying the logged time.
//
// It calls the server action directly (not via a <form action>): a form action
// would make React 19 reset the form once it resolved, snapping this controlled
// <select> back to its first option while state still held the chosen value.
// useOptimistic shows the picked status instantly for colour feedback, then
// settles on the confirmed server value after the page revalidates.
export default function PayrollStatusSelect({
  id,
  value,
}: {
  id: number;
  value: PayrollStatus;
}) {
  const [status, setStatus] = useOptimistic<PayrollStatus>(value);
  const [, startTransition] = useTransition();

  return (
    <select
      className={`status-select payroll-status-${status}`}
      value={status}
      aria-label="Approval status"
      onChange={(e) => {
        const next = e.currentTarget.value as PayrollStatus;
        startTransition(async () => {
          setStatus(next);
          await updatePayrollStatusAction({ id, status: next });
        });
      }}
    >
      {PAYROLL_STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
