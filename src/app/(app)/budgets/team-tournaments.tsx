import Link from "next/link";
import { eventCostCounts, statusLabel } from "../schedules/events";
import {
  amountToCents,
  formatCents,
  formatDateRange,
  type TournamentRow,
} from "./budget";

// Read-only list of a team's Schedules-tab tournaments, shown under the Team
// Expenses column on the Budgets tab. Their combined cost is the "scheduled
// cost" the budget sheet already subtracts from the current balance, so seeing
// them itemized here completes the picture without a trip to the Schedules tab.
// Editing still lives on the Schedules tab — this view never mutates anything.
export default function TeamTournaments({
  tournaments,
  division,
}: {
  tournaments: TournamentRow[];
  division: string;
}) {
  const scheduleHref = `/schedules?division=${division}`;
  // Refunded tournaments are credited back, so they drop out of the scheduled
  // cost that comes off the balance (they still appear in the list, marked
  // "Refund", with their cost struck through).
  const totalCents = tournaments.reduce(
    (sum, t) => sum + (eventCostCounts(t.status) ? amountToCents(t.cost) : 0),
    0,
  );

  return (
    <div className="team-tournaments">
      <div className="expenses-head">
        <h3 className="expenses-title">Scheduled Tournaments</h3>
        <p className="expenses-sub">
          Pulled straight from this team&apos;s{" "}
          <Link href={scheduleHref}>Schedules</Link> tab — their total is the
          scheduled cost that comes off the current balance. Add or edit
          tournaments there.
        </p>
      </div>

      {tournaments.length === 0 ? (
        <p className="expenses-empty">
          No tournaments scheduled yet — add them on the{" "}
          <Link href={scheduleHref}>Schedules tab</Link>.
        </p>
      ) : (
        <div className="expenses-scroll">
          <table className="expenses-table tournaments-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Tournament</th>
                <th className="exp-amount">Cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => {
                // Host and location are supporting detail under the name; skip
                // whichever is blank so the sub-line never shows stray dots.
                const meta = [t.event_host, t.location]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <tr key={t.id}>
                    <td className="exp-date">
                      {formatDateRange(t.event_date, t.event_end_date)}
                    </td>
                    <td className="tour-name">
                      <span className="tour-name-main">{t.event_name}</span>
                      {meta ? <span className="tour-name-meta">{meta}</span> : null}
                    </td>
                    <td className="exp-amount">
                      {t.cost == null || t.cost === "" ? (
                        <span className="cell-empty">—</span>
                      ) : eventCostCounts(t.status) ? (
                        formatCents(amountToCents(t.cost))
                      ) : (
                        <span
                          className="cost-refunded"
                          title="Refunded — credited back to the balance"
                        >
                          {formatCents(amountToCents(t.cost))}
                        </span>
                      )}
                    </td>
                    <td className="tour-status-cell">
                      <span className={`tour-status status-${t.status}`}>
                        {statusLabel(t.status)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="tour-total-row">
                <td colSpan={2} className="tour-total-label">
                  Total scheduled cost
                </td>
                <td className="exp-amount tour-total-value">
                  {totalCents > 0 ? "−" : ""}
                  {formatCents(totalCents)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
