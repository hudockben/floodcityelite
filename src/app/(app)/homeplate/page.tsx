import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { DIVISIONS, sportLabel, type DivisionSlug, type Sport } from "../teams/divisions";
import { ensurePaymentsSchema } from "../payment-tracker/schema";
import { ensureSchedulesSchema } from "../schedules/schema";
import { ensureBudgetsSchema } from "../budgets/schema";
import { statusLabel, type EventStatus } from "../schedules/events";
import {
  formatMoney,
  formatDate,
  paymentTypeLabel,
  type PaymentType,
} from "../payment-tracker/payments";
import {
  resolvePayingCount,
  startingBalance,
  currentBalance,
} from "../budgets/budget";

export const dynamic = "force-dynamic";

// How far ahead "upcoming week/weekend" reaches, in days (today + the next 7,
// so the coming weekend is always covered).
const UPCOMING_DAYS = 8;
const MAX_UPCOMING = 8;
const MAX_PAYMENTS = 6;
const MAX_BUDGETS = 6;
// A team's budget is flagged once at least this share of its starting balance
// has been committed (scheduled costs + net expenses) — i.e. it is about to be
// met or has already gone over.
const AT_RISK_FRACTION = 0.8;

// ---- query result shapes --------------------------------------------------

type UpcomingEventRow = {
  id: number;
  event_host: string | null;
  event_date: string; // YYYY-MM-DD (never null — filtered in the query)
  event_end_date: string | null; // YYYY-MM-DD, or null for a single-day event
  event_name: string;
  location: string | null;
  cost: string | null;
  status: EventStatus;
  team_name: string;
  sport: Sport;
};

type RecentPaymentRow = {
  id: number;
  paid_on: string; // YYYY-MM-DD
  payment_type: PaymentType;
  amount: string;
  player_name: string;
  team_name: string;
};

type BudgetRow = {
  id: number;
  name: string;
  division: DivisionSlug;
  sport: Sport;
  player_count: number;
  portion_to_team_budget: number | null;
  paying_players: number | null;
  scheduled_cost: number;
  expense_net: number;
};

// A team whose budget is at/over its limit, with the numbers already computed.
type BudgetAtRisk = {
  id: number;
  name: string;
  division: DivisionSlug;
  sport: Sport;
  starting: number;
  balance: number;
  usedPct: number;
};

// ---- date helpers (server-only render, so a Date is safe here) -------------

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Split "YYYY-MM-DD" into a short month + day for the calendar chip.
function dateParts(iso: string): { month: string; day: string; weekday: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return { month: "", day: "", weekday: "" };
  const month = MONTHS[Number(m[2]) - 1] ?? "";
  const day = String(Number(m[3]));
  // Build the day-of-week from UTC parts so it never shifts with the server
  // time zone (the stored value is a plain calendar date).
  const weekday = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()] ?? "";
  return { month, day, weekday };
}

// Compact date range for a multi-day tournament, e.g. "Jul 21 – 23" (same
// month), "Jul 30 – Aug 2" (same year), or "Dec 30, 2026 – Jan 2, 2027"
// (spanning years). Returns null when there's no later end date, so single-day
// events fall back to just the weekday.
function dateRangeText(start: string, end: string | null): string | null {
  if (!end || end <= start) return null;
  const s = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  const e = /^(\d{4})-(\d{2})-(\d{2})/.exec(end);
  if (!s || !e) return null;
  const sMon = MONTHS[Number(s[2]) - 1] ?? "";
  const eMon = MONTHS[Number(e[2]) - 1] ?? "";
  const sDay = String(Number(s[3]));
  const eDay = String(Number(e[3]));
  if (s[1] === e[1] && s[2] === e[2]) return `${sMon} ${sDay} – ${eDay}`;
  if (s[1] === e[1]) return `${sMon} ${sDay} – ${eMon} ${eDay}`;
  return `${sMon} ${sDay}, ${s[1]} – ${eMon} ${eDay}, ${e[1]}`;
}

function divisionLabel(slug: DivisionSlug): string {
  return DIVISIONS.find((d) => d.slug === slug)?.label ?? slug;
}

export default async function HomeplatePage() {
  const session = await getSession();
  if (!session) redirect("/");

  const name = session.fullName || session.username || "";

  let events: UpcomingEventRow[] = [];
  let payments: RecentPaymentRow[] = [];
  let budgetRows: BudgetRow[] = [];
  let loadError = false;

  try {
    // Make sure every table these sections read exists — the tabs each do this
    // on first use, and the helpers are idempotent and memoized.
    await Promise.all([
      ensureSchedulesSchema(),
      ensurePaymentsSchema(),
      ensureBudgetsSchema(),
    ]);

    const [eventRows, paymentRows, budgetResult] = await Promise.all([
      sql()`
        SELECT
          e.id,
          e.event_host,
          e.event_date::text AS event_date,
          e.event_end_date::text AS event_end_date,
          e.event_name,
          e.location,
          e.cost::text AS cost,
          e.status,
          t.name  AS team_name,
          t.sport AS sport
        FROM schedule_events e
        JOIN teams t ON t.id = e.team_id
        WHERE t.company_id = ${session.companyId}
          AND e.event_date IS NOT NULL
          AND e.event_date >= CURRENT_DATE
          AND e.event_date < CURRENT_DATE + ${UPCOMING_DAYS}::int
        ORDER BY e.event_date, t.name, e.id
        LIMIT ${MAX_UPCOMING + 1}
      `,
      sql()`
        SELECT
          pay.id,
          pay.paid_on::text AS paid_on,
          pay.payment_type,
          pay.amount::text  AS amount,
          pl.player_name,
          t.name            AS team_name
        FROM payments pay
        JOIN players pl ON pl.id = pay.player_id
        JOIN teams t    ON t.id = pl.team_id
        WHERE t.company_id = ${session.companyId}
        ORDER BY pay.paid_on DESC, pay.id DESC
        LIMIT ${MAX_PAYMENTS}
      `,
      sql()`
        SELECT
          t.id,
          t.name,
          t.division,
          t.sport,
          (SELECT count(*) FROM players p WHERE p.team_id = t.id)::int AS player_count,
          b.portion_to_team_budget::float8 AS portion_to_team_budget,
          b.paying_players                 AS paying_players,
          (SELECT COALESCE(SUM(e.cost), 0) FROM schedule_events e WHERE e.team_id = t.id)::float8
                                           AS scheduled_cost,
          (SELECT COALESCE(SUM(
             CASE x.status
               WHEN 'paid'   THEN x.amount
               WHEN 'refund' THEN -x.amount
               ELSE 0
             END), 0) FROM team_expenses x WHERE x.team_id = t.id)::float8
                                           AS expense_net
        FROM teams t
        LEFT JOIN team_budgets b ON b.team_id = t.id
        WHERE t.company_id = ${session.companyId}
      `,
    ]);

    events = eventRows as UpcomingEventRow[];
    payments = paymentRows as RecentPaymentRow[];
    budgetRows = budgetResult as BudgetRow[];
  } catch (err) {
    console.error("Homeplate load error:", err);
    loadError = true;
  }

  const moreEvents = events.length > MAX_UPCOMING;
  const upcoming = moreEvents ? events.slice(0, MAX_UPCOMING) : events;

  // Compute each team's current balance the same way the Budgets tab does, then
  // keep only the teams that have a real budget and are near or over it.
  const budgetsAtRisk: BudgetAtRisk[] = budgetRows
    .map((r) => {
      const payingCount = resolvePayingCount(r.paying_players ?? null, r.player_count);
      const starting = startingBalance(payingCount, r.portion_to_team_budget ?? 0);
      const balance = currentBalance(starting, r.scheduled_cost ?? 0, r.expense_net ?? 0);
      const usedPct = starting > 0 ? (starting - balance) / starting : 0;
      return {
        id: r.id,
        name: r.name,
        division: r.division,
        sport: r.sport,
        starting,
        balance,
        usedPct,
      };
    })
    .filter((r) => r.starting > 0 && r.usedPct >= AT_RISK_FRACTION)
    .sort((a, b) => a.balance - b.balance) // most over first
    .slice(0, MAX_BUDGETS);

  return (
    <div className="home">
      <section className="panel hp-welcome">
        <div className="panel-head">
          <h1>Welcome{name ? `, ${name}` : ""}.</h1>
          <p>
            {session.companyName} home base — what&apos;s coming up, and what to
            keep an eye on.
          </p>
        </div>
      </section>

      {loadError ? (
        <section className="panel">
          <div className="empty">
            <div className="empty-icon" aria-hidden="true">
              ⚠️
            </div>
            <p className="empty-title">Couldn&apos;t load your dashboard</p>
            <p className="empty-sub">
              The tables may still be getting set up. Refresh in a moment — if
              this keeps happening, run <code>npm run db:setup</code> against the
              database.
            </p>
          </div>
        </section>
      ) : (
        <>
          {/* ---- Upcoming tournaments (this week / weekend) ---- */}
          <section className="panel">
            <div className="hp-head">
              <div>
                <h2 className="step-title">🗓️ Upcoming tournaments</h2>
                <p className="hp-sub">This week and the coming weekend.</p>
              </div>
              <Link className="hp-viewall" href="/schedules">
                Schedules →
              </Link>
            </div>

            {upcoming.length === 0 ? (
              <div className="hp-empty">
                Nothing on the calendar for the next week. Add tournaments on the{" "}
                <Link href="/schedules">Schedules</Link> tab.
              </div>
            ) : (
              <ul className="hp-list">
                {upcoming.map((e) => {
                  const { month, day, weekday } = dateParts(e.event_date);
                  // Show the full span for multi-day tournaments; otherwise the
                  // start weekday, as before.
                  const range = dateRangeText(e.event_date, e.event_end_date);
                  const meta = [range ?? weekday, e.event_host, e.location]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <li key={e.id} className="hp-row">
                      <div className="hp-datechip" aria-hidden="true">
                        <span className="m">{month}</span>
                        <span className="d">{day}</span>
                      </div>
                      <div className="hp-row-main">
                        <div className="hp-row-title">{e.event_name}</div>
                        <div className="hp-row-sub">
                          <span className="hp-team">{e.team_name}</span>
                          {meta ? <span className="hp-dot">·</span> : null}
                          {meta}
                        </div>
                      </div>
                      <div className="hp-row-side">
                        {e.cost ? (
                          <div className="hp-amount">{formatMoney(e.cost)}</div>
                        ) : null}
                        <span className={`hp-pill hp-pill-${e.status}`}>
                          {statusLabel(e.status)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {moreEvents ? (
              <p className="hp-more">
                <Link href="/schedules">See the full schedule →</Link>
              </p>
            ) : null}
          </section>

          <div className="hp-grid">
            {/* ---- Recent payments ---- */}
            <section className="panel">
              <div className="hp-head">
                <div>
                  <h2 className="step-title">💳 Recent payments</h2>
                  <p className="hp-sub">The latest dues and invoices logged.</p>
                </div>
                <Link className="hp-viewall" href="/payment-tracker">
                  Payment Tracker →
                </Link>
              </div>

              {payments.length === 0 ? (
                <div className="hp-empty">
                  No payments logged yet. Record them on the{" "}
                  <Link href="/payment-tracker">Payment Tracker</Link> tab.
                </div>
              ) : (
                <ul className="hp-list">
                  {payments.map((p) => (
                    <li key={p.id} className="hp-row">
                      <div className="hp-row-main">
                        <div className="hp-row-title">{p.player_name}</div>
                        <div className="hp-row-sub">
                          <span className="hp-team">{p.team_name}</span>
                          <span className="hp-dot">·</span>
                          {formatDate(p.paid_on)}
                          <span className="hp-dot">·</span>
                          {paymentTypeLabel(p.payment_type)}
                        </div>
                      </div>
                      <div className="hp-row-side">
                        <div className="hp-amount hp-amount-pos">
                          {formatMoney(p.amount)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---- Budgets to watch ---- */}
            <section className="panel">
              <div className="hp-head">
                <div>
                  <h2 className="step-title">📊 Budgets to watch</h2>
                  <p className="hp-sub">Teams about to hit or exceed budget.</p>
                </div>
                <Link className="hp-viewall" href="/budgets">
                  Budgets →
                </Link>
              </div>

              {budgetsAtRisk.length === 0 ? (
                <div className="hp-empty">
                  Every team is comfortably within budget. Set budgets on the{" "}
                  <Link href="/budgets">Budgets</Link> tab.
                </div>
              ) : (
                <ul className="hp-list">
                  {budgetsAtRisk.map((b) => {
                    const over = b.balance < 0;
                    const pct = Math.max(0, Math.min(100, Math.round(b.usedPct * 100)));
                    const meterClass = over ? "over" : "warn";
                    return (
                      <li key={b.id} className="hp-row hp-row-budget">
                        <div className="hp-row-main">
                          <div className="hp-row-title">
                            {b.name}
                            <span className={`sport-badge sport-${b.sport}`}>
                              {sportLabel(b.sport)}
                            </span>
                          </div>
                          <div className="hp-row-sub">
                            {divisionLabel(b.division)}
                            <span className="hp-dot">·</span>
                            {pct}% of {formatMoney(b.starting)} used
                          </div>
                          <div className={`hp-meter ${meterClass}`}>
                            <span style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="hp-row-side">
                          {over ? (
                            <>
                              <div className="hp-amount hp-amount-neg">
                                {formatMoney(Math.abs(b.balance))}
                              </div>
                              <span className="hp-pill hp-pill-over">Over budget</span>
                            </>
                          ) : (
                            <>
                              <div className="hp-amount">{formatMoney(b.balance)}</div>
                              <span className="hp-pill hp-pill-warn">left</span>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
