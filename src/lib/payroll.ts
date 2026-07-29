// ---------------------------------------------------------------------------
// Payroll — shared schema, data access, types, and formatters
//
// Two sides use this module:
//   • the public employee form at /payroll (no login) submits an entry;
//   • the admin "Payroll" tab reads them back — the Submissions subtab lists
//     and approves them, the Reports subtab filters and totals them.
//
// A *payroll submission* is a single employee's logged hours for a day: their
// name, an optional role, an optional division, the date worked, the hours, and
// optional notes. It carries an approval *status* (pending → approved/denied)
// the admin sets.
//
// Plain server-side module (uses the Neon client). Imported by both the public
// server action and the protected admin pages/actions.
// ---------------------------------------------------------------------------

import { sql } from "@/lib/db";

// Employees submit against the Flood City Elite company (the login company code
// is always "fce"). The public form has no session, so it resolves the company
// by this code.
export const PAYROLL_COMPANY_CODE = "fce";

// The approval status lives in lib/payroll-status.ts — plain data with no
// database import, so a client component can have the options without pulling
// the Neon driver into the browser bundle. Re-exported here so server callers
// can keep importing everything payroll from one place.
export {
  DEFAULT_PAYROLL_STATUS,
  PAYROLL_STATUSES,
  isPayrollStatus,
  payrollStatusLabel,
} from "./payroll-status";
export type { PayrollStatus } from "./payroll-status";

import type { PayrollStatus } from "./payroll-status";

// A saved payroll submission. `hours` arrives from Postgres NUMERIC as a string
// (e.g. "4.50"); `work_date` is a "YYYY-MM-DD" string.
export type PayrollSubmissionRow = {
  id: number;
  employee_name: string;
  role: string | null;
  division: string | null; // a teams division slug, or null when unassigned
  work_date: string; // YYYY-MM-DD
  hours: string;
  status: PayrollStatus;
  notes: string | null;
  created_at: string;
};

// The fields the public form collects. Validation happens in the form's action;
// this module just persists what it's given. Status isn't set here — new
// submissions default to "pending" at the database.
export type PayrollSubmissionInput = {
  companyId: number;
  employeeName: string;
  role: string | null;
  division: string | null;
  workDate: string; // YYYY-MM-DD
  hours: string; // fixed-2 decimal string, e.g. "4.50"
  notes: string | null;
};

// Filters for the admin Reports subtab. `from`/`to` bound the work date
// (inclusive; null means unbounded). `divisionMode` is "all" (no division
// filter), "none" (only unassigned rows), or a specific division slug.
// `statusMode` is "all" or a specific approval status.
export type PayrollReportFilters = {
  from: string | null; // YYYY-MM-DD or null
  to: string | null; // YYYY-MM-DD or null
  divisionMode: string; // "all" | "none" | division slug
  statusMode: string; // "all" | payroll status
};

// Ensure the `payroll_submissions` table exists before it's read or written.
// Like the other tabs' schema helpers this lets the feature work on a database
// that predates it without a separate migration step. The DDL mirrors
// db/schema.sql and db/setup.mjs and is idempotent.
//
// Memoized per server instance: the DDL runs once per cold start. If it fails
// (e.g. a transient connection error) the memo is cleared so a later request
// can retry.
let ensured: Promise<void> | null = null;

export function ensurePayrollSchema(): Promise<void> {
  if (!ensured) {
    ensured = provision().catch((err) => {
      ensured = null;
      throw err;
    });
  }
  return ensured;
}

async function provision(): Promise<void> {
  const db = sql();

  // A payroll submission is one employee's logged hours for a day. Only the
  // employee name, work date, and hours are required; role, division, and notes
  // are optional. `division` is a teams division slug (or null) so the Reports
  // subtab can group and filter by division; `status` is the admin's approval
  // decision (defaults to pending). Belongs to a company so the tab can scope
  // them.
  await db`
    CREATE TABLE IF NOT EXISTS payroll_submissions (
      id             SERIAL        PRIMARY KEY,
      company_id     INTEGER       NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      employee_name  VARCHAR(160)  NOT NULL,
      role           VARCHAR(120),
      division       VARCHAR(32),
      work_date      DATE          NOT NULL,
      hours          NUMERIC(6,2)  NOT NULL DEFAULT 0,
      status         VARCHAR(16)   NOT NULL DEFAULT 'pending',
      notes          TEXT,
      created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
    )
  `;

  // Add `division` and `status` to databases whose payroll_submissions table
  // predates them (earlier versions of this feature). Nullable division; status
  // backfills existing rows to 'pending'.
  await db`ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS division VARCHAR(32)`;
  await db`ALTER TABLE payroll_submissions ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'pending'`;

  await db`CREATE INDEX IF NOT EXISTS idx_payroll_submissions_company_id ON payroll_submissions (company_id)`;
}

// Resolve the company id employees submit against (code: "fce"). Returns null
// when the company row doesn't exist yet (before db:setup has been run).
export async function getPayrollCompanyId(): Promise<number | null> {
  const rows = await sql()`
    SELECT id FROM companies WHERE code = ${PAYROLL_COMPANY_CODE} LIMIT 1
  `;
  return rows.length > 0 ? (rows[0].id as number) : null;
}

// Persist a new submission. The caller validates the input first. Status is
// omitted so it defaults to "pending".
export async function insertPayrollSubmission(
  input: PayrollSubmissionInput,
): Promise<void> {
  await sql()`
    INSERT INTO payroll_submissions (company_id, employee_name, role, division, work_date, hours, notes)
    VALUES (
      ${input.companyId},
      ${input.employeeName},
      ${input.role},
      ${input.division},
      ${input.workDate},
      ${input.hours},
      ${input.notes}
    )
  `;
}

// All submissions for a company, newest work date first. Used by the admin
// Submissions subtab.
export async function listPayrollSubmissions(
  companyId: number,
): Promise<PayrollSubmissionRow[]> {
  const rows = await sql()`
    SELECT
      id,
      employee_name,
      role,
      division,
      work_date::text AS work_date,
      hours::text     AS hours,
      status,
      notes,
      created_at::text AS created_at
    FROM payroll_submissions
    WHERE company_id = ${companyId}
    ORDER BY work_date DESC, id DESC
  `;
  return rows as PayrollSubmissionRow[];
}

// Submissions for a company narrowed by the Reports subtab filters. A null
// date bound is left open; divisionMode "all" applies no division filter,
// "none" keeps only unassigned rows, and a slug keeps that division; statusMode
// "all" applies no status filter. The date/division/status params are cast so a
// null or "all" value short-circuits its clause.
export async function listPayrollSubmissionsFiltered(
  companyId: number,
  { from, to, divisionMode, statusMode }: PayrollReportFilters,
): Promise<PayrollSubmissionRow[]> {
  const rows = await sql()`
    SELECT
      id,
      employee_name,
      role,
      division,
      work_date::text AS work_date,
      hours::text     AS hours,
      status,
      notes,
      created_at::text AS created_at
    FROM payroll_submissions
    WHERE company_id = ${companyId}
      AND (${from}::date IS NULL OR work_date >= ${from}::date)
      AND (${to}::date   IS NULL OR work_date <= ${to}::date)
      AND (
        ${divisionMode}::text = 'all'
        OR (${divisionMode}::text = 'none' AND division IS NULL)
        OR division = ${divisionMode}::text
      )
      AND (${statusMode}::text = 'all' OR status = ${statusMode}::text)
    ORDER BY work_date DESC, id DESC
  `;
  return rows as PayrollSubmissionRow[];
}

// Set a submission's approval status (the admin approving/denying the time),
// scoped to the company so one company can't touch another's rows.
export async function updatePayrollStatus(
  companyId: number,
  id: number,
  status: PayrollStatus,
): Promise<void> {
  await sql()`
    UPDATE payroll_submissions
    SET status = ${status}
    WHERE id = ${id} AND company_id = ${companyId}
  `;
}

// Delete a submission, scoped to the company so one company can't clear
// another's rows.
export async function deletePayrollSubmission(
  companyId: number,
  id: number,
): Promise<void> {
  await sql()`
    DELETE FROM payroll_submissions
    WHERE id = ${id} AND company_id = ${companyId}
  `;
}

// --- formatters ------------------------------------------------------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format a "YYYY-MM-DD" date without going through a Date object, which would
// otherwise shift the day across time zones.
export function formatPayrollDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  const monthIndex = Number(m) - 1;
  if (!y || !MONTHS[monthIndex] || !d) return iso;
  return `${MONTHS[monthIndex]} ${Number(d)}, ${y}`;
}

// Format an hours value (string or number) trimming a trailing ".00" / ".50" →
// "4" / "4.5". Falls back to "0" for anything non-numeric.
export function formatHours(value: string | number): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(n);
}
