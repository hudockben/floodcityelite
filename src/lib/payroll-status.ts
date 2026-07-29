// ---------------------------------------------------------------------------
// Payroll — approval status
//
// Split out of lib/payroll.ts so the client can have it without the database.
// lib/payroll.ts imports the Neon client, and the Submissions tab's inline
// status dropdown is a client component: importing the status options from
// there pulled the whole DB module — driver and query functions — into the
// browser bundle. These values are plain data, so they live in a module with no
// server-side imports; lib/payroll.ts re-exports them, leaving server callers
// unchanged.
// ---------------------------------------------------------------------------

// Approval status of a submission. Employees submit as "pending"; an admin
// approves or denies the time on the Submissions subtab.
export type PayrollStatus = "pending" | "approved" | "denied";

export const PAYROLL_STATUSES: { value: PayrollStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
];

export const DEFAULT_PAYROLL_STATUS: PayrollStatus = "pending";

export function isPayrollStatus(value: string): value is PayrollStatus {
  return PAYROLL_STATUSES.some((s) => s.value === value);
}

export function payrollStatusLabel(value: string): string {
  return PAYROLL_STATUSES.find((s) => s.value === value)?.label ?? value;
}
