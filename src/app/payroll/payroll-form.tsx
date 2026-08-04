"use client";

import { useActionState, useEffect, useRef } from "react";
import { submitPayrollAction, type PayrollFormState } from "./actions";
import type { Division } from "@/app/(app)/teams/divisions";

const initialState: PayrollFormState = {};

// The public employee payroll form. On success it shows a confirmation banner
// and resets so the employee (or the next one) can log another entry.
export default function PayrollForm({ divisions }: { divisions: Division[] }) {
  const [state, formAction, pending] = useActionState(
    submitPayrollAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="form">
      {state?.ok ? (
        <p className="success" role="status">
          Thanks — your hours were submitted. You can log another entry below.
        </p>
      ) : null}

      <div className="field">
        <label htmlFor="employee_name">Full name *</label>
        <input
          id="employee_name"
          name="employee_name"
          type="text"
          autoComplete="name"
          placeholder="Your full name"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="role">Role</label>
        <input
          id="role"
          name="role"
          type="text"
          autoComplete="organization-title"
          placeholder="e.g. Coach, Instructor, Umpire"
        />
      </div>

      <div className="field">
        <label htmlFor="division">Division</label>
        <select id="division" name="division" defaultValue="">
          <option value="">Not division-specific</option>
          {divisions.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="work_date">Date worked *</label>
        <input id="work_date" name="work_date" type="date" required />
      </div>

      <div className="field">
        <label htmlFor="hours">Hours worked *</label>
        <input
          id="hours"
          name="hours"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.25"
          placeholder="e.g. 4.5"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="notes">Notes</label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          placeholder="Anything the office should know (optional)"
        />
      </div>

      {state?.error ? (
        <p className="error" role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Submitting…" : "Submit payroll"}
      </button>
    </form>
  );
}
