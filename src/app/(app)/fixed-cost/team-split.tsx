import Link from "next/link";
import { formatCents } from "../budgets/budget";
import { DIVISIONS } from "../teams/divisions";
import type { FixedCostTeam } from "./basis";
import {
  SPLIT_METHODS,
  tuitionShareCents,
  type SplitMethod,
} from "./fixed-costs";

// Team by team, both ways of splitting the year's total: what each team's
// players carry, and what of their tuition is left to reach the team budget.
// Tuition varies by age and by season, so the two splits land differently on
// every team — this is where that difference is read off, side by side, before
// (and after) picking one. The column in use is the one the Budgets tab runs on.

type Cell = {
  /** Fixed cost per player, in cents. */
  fixedCents: number;
  /** Tuition less the fixed cost, in cents — what reaches the team per player. */
  keepsCents: number;
};

function cellFor(tuitionCents: number, fixedCents: number): Cell {
  return { fixedCents, keepsCents: tuitionCents - fixedCents };
}

/** "keeps $48.32 (5%)" — or why there's nothing to say yet. */
function Keeps({ tuitionCents, cell }: { tuitionCents: number; cell: Cell }) {
  if (tuitionCents <= 0) {
    return <span className="fx-split-sub">no tuition yet</span>;
  }
  const pct = Math.round((cell.keepsCents / tuitionCents) * 100);
  return (
    <span className={`fx-split-sub${cell.keepsCents < 0 ? " fx-split-neg" : ""}`}>
      keeps {formatCents(cell.keepsCents)} ({pct}%)
    </span>
  );
}

export default function TeamSplit({
  teams,
  method,
  totalCents,
  perPlayerCents,
  tuitionBaseCents,
}: {
  teams: FixedCostTeam[];
  /** The split the Budgets tab is using. */
  method: SplitMethod;
  totalCents: number;
  /** Equal per player: the year's figure. */
  perPlayerCents: number;
  /** Share of tuition: what the total is spread over. */
  tuitionBaseCents: number;
}) {
  const rows = teams.map((t) => ({
    team: t,
    equal: cellFor(t.tuitionCents, perPlayerCents),
    share: cellFor(
      t.tuitionCents,
      tuitionShareCents(t.tuitionCents, totalCents, tuitionBaseCents),
    ),
  }));

  // What each split actually takes off team budgets: paying players × fixed
  // cost per player, for every team that doesn't set its portion by hand (its
  // tuition never has the fixed cost taken off).
  let equalChargedCents = 0;
  let shareChargedCents = 0;
  for (const r of rows) {
    if (r.team.manualPortion) continue;
    equalChargedCents += r.team.payingCount * r.equal.fixedCents;
    shareChargedCents += r.team.payingCount * r.share.fixedCents;
  }
  const manualCount = teams.filter((t) => t.manualPortion).length;

  // Every division in tab order, then any value the list doesn't know (so a
  // team is never silently dropped from the breakdown).
  const known = new Set<string>(DIVISIONS.map((d) => d.slug));
  const groups = [
    ...DIVISIONS.map((d) => ({
      key: d.slug as string,
      label: d.label,
      rows: rows.filter((r) => r.team.division === d.slug),
    })),
    {
      key: "other",
      label: "Other",
      rows: rows.filter((r) => !known.has(r.team.division)),
    },
  ].filter((g) => g.rows.length > 0);

  const activeClass = (m: SplitMethod) =>
    m === method ? " fx-split-active" : "";
  const labelFor = (m: SplitMethod) =>
    SPLIT_METHODS.find((s) => s.value === m)?.label ?? m;

  const charged = (cents: number) => (
    <>
      {formatCents(cents)}
      <span className="fx-split-sub">
        {totalCents > 0
          ? `${Math.round((cents / totalCents) * 100)}% of ${formatCents(totalCents)}`
          : "no fixed cost yet"}
      </span>
    </>
  );

  return (
    <>
      <div className="fx-split-scroll">
        <table className="fx-split">
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col" className="fx-split-num">
                Paying
              </th>
              <th scope="col" className="fx-split-num">
                Tuition
              </th>
              {(["per_player", "tuition"] as const).map((m) => (
                <th
                  key={m}
                  scope="col"
                  className={`fx-split-num${activeClass(m)}`}
                >
                  {labelFor(m)}
                  {m === method ? (
                    <span className="fx-split-inuse">in use</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>

          {groups.map((g) => (
            <tbody key={g.key}>
              <tr className="fx-split-division">
                <th scope="colgroup" colSpan={5}>
                  {g.label}
                  <span className="fx-split-division-count">
                    {g.rows.length} {g.rows.length === 1 ? "team" : "teams"}
                  </span>
                </th>
              </tr>
              {g.rows.map(({ team, equal, share }) => (
                <tr key={team.id}>
                  <th scope="row" className="fx-split-team">
                    {team.name}
                    {team.manualPortion ? (
                      <span className="fx-split-sub">
                        portion set by hand on Budgets
                      </span>
                    ) : null}
                  </th>
                  <td className="fx-split-num">{team.payingCount}</td>
                  <td className="fx-split-num">
                    {team.tuitionCents > 0 ? (
                      formatCents(team.tuitionCents)
                    ) : (
                      <span className="fx-split-muted">—</span>
                    )}
                  </td>
                  <td className={`fx-split-num${activeClass("per_player")}`}>
                    {formatCents(equal.fixedCents)}
                    <Keeps tuitionCents={team.tuitionCents} cell={equal} />
                  </td>
                  <td className={`fx-split-num${activeClass("tuition")}`}>
                    {team.tuitionCents > 0 ? (
                      formatCents(share.fixedCents)
                    ) : (
                      <span className="fx-split-muted">—</span>
                    )}
                    <Keeps tuitionCents={team.tuitionCents} cell={share} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}

          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Charged to team budgets
              </th>
              <td className={`fx-split-num${activeClass("per_player")}`}>
                {charged(equalChargedCents)}
              </td>
              <td className={`fx-split-num${activeClass("tuition")}`}>
                {charged(shareChargedCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {manualCount > 0 ? (
        <p className="fx-split-foot">
          {manualCount} {manualCount === 1 ? "team sets its" : "teams set their"}{" "}
          portion to team budget by hand on the{" "}
          <Link className="inline-link" href="/budgets">
            Budgets
          </Link>{" "}
          tab, so no fixed cost comes off {manualCount === 1 ? "its" : "their"}{" "}
          tuition either way. {manualCount === 1 ? "It's" : "They're"} left out
          of the charged totals.
        </p>
      ) : null}
    </>
  );
}
