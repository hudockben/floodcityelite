import Link from "next/link";
import {
  amountToCents,
  formatCents,
  formatDate,
  sumFundraisedCents,
  type FundraiserCreditRow,
} from "./budget";

// Read-only list of a team's Fundraiser Tracker entries, shown in the Budgets
// tab's right-hand column above the scheduled tournaments. Their total is the
// credit the budget sheet adds to the current balance, so the money a team
// raises is itemized in the same place it lifts the balance. Logging and
// deleting entries still lives on the Fundraiser Tracker tab — this view never
// mutates anything.
export default function TeamFundraisers({
  fundraisers,
}: {
  fundraisers: FundraiserCreditRow[];
}) {
  const totalCents = sumFundraisedCents(fundraisers);

  return (
    <div className="team-fundraisers">
      <div className="expenses-head">
        <h3 className="expenses-title">Fundraising Raised</h3>
        <p className="expenses-sub">
          Every entry logged against this team on the{" "}
          <Link href="/fundraiser-tracker">Fundraiser Tracker</Link> tab — by a
          player or by the whole team. Their total is credited to the current
          balance below. Log or remove entries there.
        </p>
      </div>

      {fundraisers.length === 0 ? (
        <p className="expenses-empty">
          Nothing raised for this team yet — log it on the{" "}
          <Link href="/fundraiser-tracker">Fundraiser Tracker tab</Link> and it
          lifts the balance here.
        </p>
      ) : (
        <div className="expenses-scroll">
          <table className="expenses-table fundraisers-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Fundraiser</th>
                <th>Raised by</th>
                <th className="exp-amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              {fundraisers.map((f) => (
                <tr key={f.id}>
                  <td className="exp-date">{formatDate(f.raised_on)}</td>
                  <td className="fund-name">{f.fundraiser_name}</td>
                  <td className="fund-who">
                    {/* A whole-team entry has no player; say so rather than
                        leaving the cell blank, since the two kinds of entry
                        count the same toward the total. */}
                    {f.player_name ?? (
                      <span className="fund-who-team">Whole team</span>
                    )}
                  </td>
                  <td className="exp-amount">
                    {formatCents(amountToCents(f.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="tour-total-row">
                <td colSpan={3} className="tour-total-label">
                  Total raised
                </td>
                <td className="exp-amount fund-total-value">
                  {totalCents > 0 ? "+" : ""}
                  {formatCents(totalCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
