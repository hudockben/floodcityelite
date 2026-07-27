import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { DIVISIONS, divisionLabel, isDivisionSlug } from "../../teams/divisions";
import {
  ensurePayrollSchema,
  listPayrollSubmissionsFiltered,
  formatPayrollDate,
  formatHours,
  payrollStatusLabel,
  isPayrollStatus,
  PAYROLL_STATUSES,
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

// The status filter is "all" (default) or a specific approval status.
function statusMode(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  return isPayrollStatus(s) ? s : "all";
}

function divisionModeLabel(mode: string): string {
  if (mode === "all") return "All divisions";
  if (mode === "none") return "Unassigned";
  return divisionLabel(mode);
}

function statusModeLabel(mode: string): string {
  return mode === "all" ? "All statuses" : payrollStatusLabel(mode);
}

function rangeLabel(from: string | null, to: string | null): string {
  if (from && to) return `${formatPayrollDate(from)} – ${formatPayrollDate(to)}`;
  if (from) return `From ${formatPayrollDate(from)}`;
  if (to) return `Through ${formatPayrollDate(to)}`;
  return "All dates";
}

// Order divisions by the selector order, with Unassigned (null) last and any
// unrecognized slug just before it.
function divisionRank(key: string | null): number {
  if (key === null) return DIVISIONS.length + 1;
  const i = DIVISIONS.findIndex((d) => d.slug === key);
  return i === -1 ? DIVISIONS.length : i;
}

export default async function PayrollReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string | string[];
    to?: string | string[];
    division?: string | string[];
    status?: string | string[];
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const params = await searchParams;
  const from = isoDate(firstParam(params.from));
  const to = isoDate(firstParam(params.to));
  const mode = divisionMode(firstParam(params.division));
  const sMode = statusMode(firstParam(params.status));

  let rows: PayrollSubmissionRow[] = [];
  let loadError = false;

  try {
    await ensurePayrollSchema();
    rows = await listPayrollSubmissionsFiltered(session.companyId, {
      from,
      to,
      divisionMode: mode,
      statusMode: sMode,
    });
  } catch (err) {
    console.error("Payroll reports load error:", err);
    loadError = true;
  }

  const totalHours = rows.reduce((sum, r) => sum + (Number(r.hours) || 0), 0);
  const distinctEmployees = new Set(rows.map((r) => r.employee_name)).size;

  // Employee hours grouped by division — the pay-period roll-up, subtly split
  // by division. An employee with hours in two divisions appears under each.
  const empByDivision = new Map<
    string | null,
    Map<string, { name: string; entries: number; hours: number }>
  >();
  for (const r of rows) {
    const key = r.division ?? null;
    let emap = empByDivision.get(key);
    if (!emap) {
      emap = new Map();
      empByDivision.set(key, emap);
    }
    const e = emap.get(r.employee_name) ?? {
      name: r.employee_name,
      entries: 0,
      hours: 0,
    };
    e.entries += 1;
    e.hours += Number(r.hours) || 0;
    emap.set(r.employee_name, e);
  }
  const employeeGroups = [...empByDivision.entries()]
    .sort((a, b) => divisionRank(a[0]) - divisionRank(b[0]))
    .map(([key, emap]) => {
      const emps = [...emap.values()].sort((a, b) => b.hours - a.hours);
      return {
        key,
        label: key ? divisionLabel(key) : "Unassigned",
        hours: emps.reduce((s, e) => s + e.hours, 0),
        emps,
      };
    });

  // The raw submissions grouped by division for the detail table.
  const byDivision = new Map<string | null, PayrollSubmissionRow[]>();
  for (const r of rows) {
    const key = r.division ?? null;
    const list = byDivision.get(key);
    if (list) list.push(r);
    else byDivision.set(key, [r]);
  }
  const submissionGroups = [...byDivision.entries()]
    .sort((a, b) => divisionRank(a[0]) - divisionRank(b[0]))
    .map(([key, items]) => ({
      key,
      label: key ? divisionLabel(key) : "Unassigned",
      hours: items.reduce((s, r) => s + (Number(r.hours) || 0), 0),
      items,
    }));

  return (
    <section className="panel">
      <div className="panel-head">
        <h1>Payroll</h1>
        <p>
          Filter submissions by date range, division, and approval status to
          total up hours for a pay period.
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
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={sMode}>
            <option value="all">All statuses</option>
            {PAYROLL_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
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
            {rangeLabel(from, to)} · {divisionModeLabel(mode)} ·{" "}
            {statusModeLabel(sMode)}
          </p>

          <div className="meta payroll-report-tiles">
            <div className="item">
              <div className="k">Submissions</div>
              <div className="v">{rows.length}</div>
            </div>
            <div className="item">
              <div className="k">Employees</div>
              <div className="v">{distinctEmployees}</div>
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
                Try widening the date range or changing the division/status.
              </p>
            </div>
          ) : (
            <>
              {/* Hours per employee, subtly split by division. */}
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
                  {employeeGroups.map((g) => (
                    <tbody key={g.key ?? "unassigned"}>
                      <tr className="rg-row">
                        <th colSpan={3} scope="colgroup" className="rg-cell">
                          <span className="rg-name">{g.label}</span>
                          <span className="rg-meta">
                            {formatHours(g.hours)} hrs
                          </span>
                        </th>
                      </tr>
                      {g.emps.map((e) => (
                        <tr key={e.name}>
                          <td className="col-name">{e.name}</td>
                          <td>{e.entries}</td>
                          <td>{formatHours(e.hours)}</td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>

              {/* The matching submissions in detail, grouped by division. */}
              <h2 className="payroll-report-heading">Matching submissions</h2>
              <div className="roster-scroll">
                <table className="roster">
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col">Role</th>
                      <th scope="col">Date worked</th>
                      <th scope="col">Hours</th>
                      <th scope="col">Status</th>
                      <th scope="col">Notes</th>
                    </tr>
                  </thead>
                  {submissionGroups.map((g) => (
                    <tbody key={g.key ?? "unassigned"}>
                      <tr className="rg-row">
                        <th colSpan={6} scope="colgroup" className="rg-cell">
                          <span className="rg-name">{g.label}</span>
                          <span className="rg-meta">
                            {g.items.length}{" "}
                            {g.items.length === 1 ? "entry" : "entries"} ·{" "}
                            {formatHours(g.hours)} hrs
                          </span>
                        </th>
                      </tr>
                      {g.items.map((r) => (
                        <tr key={r.id}>
                          <td className="col-name">{r.employee_name}</td>
                          <td>
                            {r.role ?? <span className="cell-empty">—</span>}
                          </td>
                          <td>{formatPayrollDate(r.work_date)}</td>
                          <td>{formatHours(r.hours)}</td>
                          <td>
                            <span
                              className={`payroll-status-pill payroll-status-${r.status}`}
                            >
                              {payrollStatusLabel(r.status)}
                            </span>
                          </td>
                          <td>
                            {r.notes ?? <span className="cell-empty">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
