import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import ConfirmButton from "../teams/confirm-button";
import { divisionLabel } from "../teams/divisions";
import {
  ensurePayrollSchema,
  listPayrollSubmissions,
  formatPayrollDate,
  formatHours,
  type PayrollSubmissionRow,
} from "@/lib/payroll";
import { deletePayrollSubmissionAction } from "./actions";
import PayrollSubtabs from "./payroll-subtabs";

export const dynamic = "force-dynamic";

export default async function PayrollAdminPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let submissions: PayrollSubmissionRow[] = [];
  let loadError = false;

  try {
    // Create the table on first use so the tab works even if the database
    // predates this feature. Idempotent and memoized.
    await ensurePayrollSchema();
    submissions = await listPayrollSubmissions(session.companyId);
  } catch (err) {
    console.error("Payroll load error:", err);
    loadError = true;
  }

  const totalHours = submissions.reduce(
    (sum, s) => sum + (Number(s.hours) || 0),
    0,
  );

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Payroll</h1>
        <p>
          Hours submitted by employees through the public payroll form. Delete a
          row once it&apos;s been processed.
        </p>
      </div>

      <PayrollSubtabs />

      {loadError ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            ⚠️
          </div>
          <p className="empty-title">Couldn&apos;t load payroll</p>
          <p className="empty-sub">
            The payroll table may still be getting set up. Refresh in a moment —
            if this keeps happening, run <code>npm run db:setup</code> against
            the database.
          </p>
        </div>
      ) : submissions.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            🕒
          </div>
          <p className="empty-title">No submissions yet</p>
          <p className="empty-sub">
            Employees log their hours from the <strong>Payroll</strong> card on
            the sign-in screen. Entries show up here.
          </p>
        </div>
      ) : (
        <>
          <p className="muted-note payroll-summary">
            <strong>{submissions.length}</strong>{" "}
            {submissions.length === 1 ? "submission" : "submissions"} ·{" "}
            <strong>{formatHours(totalHours)}</strong> total hours
          </p>

          <div className="roster-scroll">
            <table className="roster">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Role</th>
                  <th scope="col">Division</th>
                  <th scope="col">Date worked</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Notes</th>
                  <th scope="col">Submitted</th>
                  <th scope="col" className="col-actions">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="col-name">{s.employee_name}</td>
                    <td>{s.role ?? <span className="cell-empty">—</span>}</td>
                    <td>
                      {s.division ? (
                        divisionLabel(s.division)
                      ) : (
                        <span className="cell-empty">—</span>
                      )}
                    </td>
                    <td>{formatPayrollDate(s.work_date)}</td>
                    <td>{formatHours(s.hours)}</td>
                    <td>{s.notes ?? <span className="cell-empty">—</span>}</td>
                    <td className="exp-date">
                      {formatPayrollDate(s.created_at.slice(0, 10))}
                    </td>
                    <td className="col-actions">
                      <ConfirmButton
                        action={deletePayrollSubmissionAction}
                        hidden={{ id: s.id }}
                        confirmText={`Delete ${s.employee_name}'s payroll entry for ${formatPayrollDate(
                          s.work_date,
                        )}?`}
                        className="row-delete"
                      >
                        Delete
                      </ConfirmButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
