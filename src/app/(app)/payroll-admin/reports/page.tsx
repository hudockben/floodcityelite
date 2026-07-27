import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { DIVISIONS, divisionLabel, isDivisionSlug } from "../../teams/divisions";
import {
  ensurePayrollSchema,
  listPayrollSubmissionsFiltered,
  formatPayrollDate,
  formatHours,
  type PayrollSubmissionRow,
} from "@/lib/payroll";
import PayrollSubtabs from "../payroll-subtabs";

export const dynamic = "force-dynamic";

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Accept a "YYYY-MM-DD" query value, else treat as no bound.
function isoDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// The division filter is "all" (default), "none" (unassigned), or a slug.
function divisionMode(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (s === "none" || isDivisionSlug(s)) return s;
  return "all";
}

function divisionModeLabel(mode: string): string {
  if (mode === "all") return "All divisions";
  if (mode === "none") return "Unassigned";
  return divisionLabel(mode);
}

function rangeLabel(from: string | null, to: string | null): string {
  if (from && to) return `${formatPayrollDate(from)} – ${formatPayrollDate(to)}`;
  if (from) return `From ${formatPayrollDate(from)}`;
  if (to) return `Through ${formatPayrollDate(to)}`;
  return "All dates";
}

export default async function PayrollReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string | string[];
    to?: string | string[];
    division?: string | string[];
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const from = isoDate(firstParam(params.from));
  const to = isoDate(firstParam(params.to));
  const mode = divisionMode(firstParam(params.division));

  let rows: PayrollSubmissionRow[] = [];
  let loadError = false;

  try {
    await ensurePayrollSchema();
    rows = await listPayrollSubmissionsFiltered(session.companyId, {
      from,
      to,
      divisionMode: mode,
    });
  } catch (err) {
    console.error("Payroll reports load error:", err);
    loadError = true;
  }

  const totalHours = rows.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);

  // Roll up hours per employee — the figure payroll actually needs.
  const byEmployee = new Map<
    string,
    { name: string; entries: number; hours: number }
  >();
  for (const r of rows) {
    const e = byEmployee.get(r.employee_name) ?? {
      name: r.employee_name,
      entries: 0,
      hours: 0,
    };
    e.entries += 1;
    e.hours += Number(r.hours) || 0;
    byEmployee.set(r.employee_name, e);
  }
  const employees = [...byEmployee.values()].sort((a, b) => b.hours - a.hours);

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Payroll</h1>
        <p>
          Filter submissions by date range and division to total up hours for a
          pay period.
        </p>
      </div>

      <PayrollSubtabs />

      {/* Filters — a plain GET form so the range is shareable/bookmarkable. */}
      <form className="payroll-filters" method="get">
        <div className="field">
          <label htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="division">Division</label>
          <select id="division" name="division" defaultValue={mode}>
            <option value="all">All divisions</option>
            {DIVISIONS.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.label}
              </option>
            ))}
            <option value="none">Unassigned</option>
          </select>
        </div>
        <div className="payroll-filters-actions">
          <button type="submit" className="btn payroll-filters-btn">
            Apply
          </button>
          <Link href="/payroll-admin/reports" className="filter-clear">
            Clear
          </Link>
        </div>
      </form>

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
      ) : (
        <>
          <p className="muted-note payroll-report-scope">
            {rangeLabel(from, to)} · {divisionModeLabel(mode)}
          </p>

          <div className="meta payroll-report-tiles">
            <div className="item">
              <div className="k">Submissions</div>
              <div className="v">{rows.length}</div>
            </div>
            <div className="item">
              <div className="k">Employees</div>
              <div className="v">{employees.length}</div>
            </div>
            <div className="item">
              <div className="k">Total hours</div>
              <div className="v">{formatHours(totalHours)}</div>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="empty">
              <div className="empty-icon" aria-hidden="true">
                🔍
              </div>
              <p className="empty-title">No submissions match</p>
              <p className="empty-sub">
                Try widening the date range or choosing a different division.
              </p>
            </div>
          ) : (
            <>
              {/* Hours per employee — the pay-period roll-up. */}
              <h2 className="payroll-report-heading">Hours by employee</h2>
              <div className="roster-scroll">
                <table className="roster">
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col">Entries</th>
                      <th scope="col">Total hours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {employees.map((e) => (
                      <tr key={e.name}>
                        <td className="col-name">{e.name}</td>
                        <td>{e.entries}</td>
                        <td>{formatHours(e.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* The matching submissions in detail. */}
              <h2 className="payroll-report-heading">Matching submissions</h2>
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
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="col-name">{r.employee_name}</td>
                        <td>{r.role ?? <span className="cell-empty">—</span>}</td>
                        <td>
                          {r.division ? (
                            divisionLabel(r.division)
                          ) : (
                            <span className="cell-empty">—</span>
                          )}
                        </td>
                        <td>{formatPayrollDate(r.work_date)}</td>
                        <td>{formatHours(r.hours)}</td>
                        <td>
                          {r.notes ?? <span className="cell-empty">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
