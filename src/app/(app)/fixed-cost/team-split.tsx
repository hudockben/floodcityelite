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
//
// A team whose portion to team budget is set by hand on the Budgets tab takes
// neither split: the override pins what reaches the team, and whatever's left of
// its tuition after it is what the team actually puts toward the fixed cost.
// Its row still shows what each split *would* give, so the override can be
// weighed against clearing it, but the covered totals count what it really
// covers.

type Cell = {
  /** Fixed cost per player, in cents. */
  fixedCents: number;
  /** Tuition less the fixed cost, in cents — what reaches the team per player. */
  keepsCents: number;
};

function cellFor(tuitionCents: number, fixedCents: number): Cell {
  return { fixedCents, keepsCents: tuitionCents - fixedCents };
}

/**
 * What a team whose portion is set by hand actually puts toward the fixed cost
 * per player, in cents: its tuition less that portion. The override pins it, so
 * it's the same under both splits — and negative when the portion is more than
 * the tuition, which costs the program money on every player. Null when no
 * tuition is entered to measure the portion against.
 */
function handSetCoverCents(team: FixedCostTeam): number | null {
  if (team.portionOverrideCents == null || team.tuitionCents <= 0) return null;
  return team.tuitionCents - team.portionOverrideCents;
}

/** "keeps $48.32 (5%)" — or why there's nothing to say yet. */
function Keeps({
  tuitionCents,
  cell,
  handSet,
}: {
  tuitionCents: number;
  cell: Cell;
  /** The team's portion is set by hand, so this split is only what it'd be. */
  handSet: boolean;
}) {
  if (tuitionCents <= 0) {
    return <span className="fx-split-sub">no tuition yet</span>;
  }
  const pct = Math.round((cell.keepsCents / tuitionCents) * 100);
  return (
    <span className={`fx-split-sub${cell.keepsCents < 0 ? " fx-split-neg" : ""}`}>
      {handSet ? "would keep" : "keeps"} {formatCents(cell.keepsCents)} ({pct}%)
    </span>
  );
}

/** Under a hand-set team's name: what it keeps, and what that leaves. */
function HandSetNote({ team }: { team: FixedCostTeam }) {
  const cover = handSetCoverCents(team);
  return (
    <span className={`fx-split-sub${cover != null && cover < 0 ? " fx-split-neg" : ""}`}>
      set by hand on Budgets: keeps {formatCents(team.portionOverrideCents ?? 0)}
      {cover == null
        ? " · no tuition entered"
        : cover >= 0
          ? `, ${formatCents(cover)} to fixed cost`
          : `, ${formatCents(-cover)} more than its tuition`}
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
    handSet: t.portionOverrideCents != null,
    equal: cellFor(t.tuitionCents, perPlayerCents),
    share: cellFor(
      t.tuitionCents,
      tuitionShareCents(t.tuitionCents, totalCents, tuitionBaseCents),
    ),
  }));

  // How much of the year's total the teams cover under each split: paying
  // players × fixed cost per player. A hand-set team counts at what it actually
  // puts toward the fixed cost — tuition less its hand-set portion — the same
  // under both splits, since the override pins it. Without that it would read
  // as covering nothing, when everything its portion doesn't take still goes to
  // the program.
  let equalCoveredCents = 0;
  let shareCoveredCents = 0;
  for (const r of rows) {
    if (r.handSet) {
      const covered = r.team.payingCount * (handSetCoverCents(r.team) ?? 0);
      equalCoveredCents += covered;
      shareCoveredCents += covered;
    } else {
      equalCoveredCents += r.team.payingCount * r.equal.fixedCents;
      shareCoveredCents += r.team.payingCount * r.share.fixedCents;
    }
  }
  const handSetCount = rows.filter((r) => r.handSet).length;

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

  const covered = (cents: number) => (
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
              {g.rows.map(({ team, handSet, equal, share }) => {
                // A hand-set team's split figures are only what they'd be.
                const would = handSet ? " fx-split-would" : "";
                return (
                  <tr key={team.id}>
                    <th scope="row" className="fx-split-team">
                      {team.name}
                      {handSet ? <HandSetNote team={team} /> : null}
                    </th>
                    <td className="fx-split-num">{team.payingCount}</td>
                    <td className="fx-split-num">
                      {team.tuitionCents > 0 ? (
                        formatCents(team.tuitionCents)
                      ) : (
                        <span className="fx-split-muted">—</span>
                      )}
                    </td>
                    <td
                      className={`fx-split-num${activeClass("per_player")}${would}`}
                    >
                      {formatCents(equal.fixedCents)}
                      <Keeps
                        tuitionCents={team.tuitionCents}
                        cell={equal}
                        handSet={handSet}
                      />
                    </td>
                    <td
                      className={`fx-split-num${activeClass("tuition")}${would}`}
                    >
                      {team.tuitionCents > 0 ? (
                        formatCents(share.fixedCents)
                      ) : (
                        <span className="fx-split-muted">—</span>
                      )}
                      <Keeps
                        tuitionCents={team.tuitionCents}
                        cell={share}
                        handSet={handSet}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}

          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Fixed cost covered
              </th>
              <td className={`fx-split-num${activeClass("per_player")}`}>
                {covered(equalCoveredCents)}
              </td>
              <td className={`fx-split-num${activeClass("tuition")}`}>
                {covered(shareCoveredCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {handSetCount > 0 ? (
        <p className="fx-split-foot">
          {handSetCount === 1
            ? "1 team sets its"
            : `${handSetCount} teams set their`}{" "}
          portion to team budget by hand on the{" "}
          <Link className="inline-link" href="/budgets">
            Budgets
          </Link>{" "}
          tab. {handSetCount === 1 ? "Its row shows" : "Their rows show"} what
          each split would give if the portion were cleared; the covered totals
          count what {handSetCount === 1 ? "it actually puts" : "they actually put"}{" "}
          toward the fixed cost — tuition less the hand-set portion — the same
          under both splits.
        </p>
      ) : null}
    </>
  );
}
