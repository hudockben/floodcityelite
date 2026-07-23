"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { setPlayerGroupAction, setTeamGroupCountAction } from "./actions";
import { MAX_ROSTER_GROUPS, type GroupPlayer } from "./events";

// Positions a complete weekend roster really needs one of in every group. Used
// to flag a group that's short a catcher or a pitcher so the coach can pair
// players up sensibly.
const KEY_POSITIONS: { code: string; label: string }[] = [
  { code: "C", label: "catcher" },
  { code: "P", label: "pitcher" },
];

// Does any of these players list the given position as their primary? Matches
// on the leading letters so "P", "RHP", "LHP" all count as pitchers, and "C",
// "CF" are told apart (a center fielder is not a catcher).
function hasPosition(players: GroupPlayer[], code: string): boolean {
  return players.some((p) => {
    const pos = (p.primary_position ?? "").trim().toUpperCase();
    if (code === "P") return pos === "P" || pos.endsWith("HP"); // P, RHP, LHP
    return pos === code;
  });
}

// The per-team "Roster groups" editor. A coach splits the roster into standing,
// position-balanced groups (Group 1, Group 2, …); each event then travels a
// combination of them. Assignments persist on the player, so they're reused
// across every tournament. This panel only sets up the groups — which ones play
// a given event is picked per event in that event's Groups panel.
export default function RosterGroups({
  teamId,
  players,
  groupCount,
}: {
  teamId: number;
  players: GroupPlayer[];
  groupCount: number;
}) {
  // Optimistic local copies so the grid reacts instantly; the server actions
  // revalidate in the background and we revert on failure.
  const [count, setCount] = useState(groupCount);
  const [groups, setGroups] = useState<Map<number, number | null>>(
    () => new Map(players.map((p) => [p.id, p.roster_group ?? null])),
  );

  // A player list per group (1..count) plus the "unassigned" bucket, kept in the
  // roster order the server already sorted by.
  const byGroup = useMemo(() => {
    const map = new Map<number | null, GroupPlayer[]>();
    for (const p of players) {
      const g = groups.get(p.id) ?? null;
      const key = g != null && g >= 1 && g <= count ? g : null;
      const list = map.get(key);
      if (list) list.push(p);
      else map.set(key, [p]);
    }
    return map;
  }, [players, groups, count]);

  function changeCount(next: number) {
    const clamped = Math.max(0, Math.min(MAX_ROSTER_GROUPS, next));
    if (clamped === count) return;
    const prevCount = count;
    const prevGroups = groups;
    setCount(clamped);
    if (clamped < prevCount) {
      // Retire the removed groups locally too (the server does the same).
      setGroups((prev) => {
        const m = new Map(prev);
        for (const [id, g] of m) if (g != null && g > clamped) m.set(id, null);
        return m;
      });
    }
    setTeamGroupCountAction({ teamId, count: clamped }).catch(() => {
      setCount(prevCount);
      setGroups(prevGroups);
    });
  }

  function assign(playerId: number, group: number | null) {
    const prev = groups;
    setGroups((p) => new Map(p).set(playerId, group));
    setPlayerGroupAction({ playerId, group }).catch(() => setGroups(prev));
  }

  const groupNumbers = Array.from({ length: count }, (_, i) => i + 1);
  const unassigned = byGroup.get(null) ?? [];
  const assignedCount = players.length - unassigned.length;

  return (
    <details className="rgroups">
      <summary className="rgroups-summary">
        <span className="tg-caret" aria-hidden="true" />
        <span className="rgroups-title">Roster groups</span>
        <span className="rgroups-sub">
          {count === 0
            ? "Not set up"
            : `${count} groups · ${assignedCount}/${players.length} assigned`}
        </span>
      </summary>

      <div className="rgroups-body">
        <p className="rgroups-intro">
          Split the roster into standing groups so position needs — a catcher
          and a pitcher in each — travel together. Each tournament then takes a
          combination of groups (Groups 1 &amp; 2 one weekend, 1 &amp; 3 the
          next), which you pick in that event&apos;s <strong>Groups</strong>{" "}
          panel.
        </p>

        {players.length === 0 ? (
          <p className="rgroups-empty">
            Add players to this team on the Teams tab first, then come back to
            group them.
          </p>
        ) : (
          <>
            <div className="rgroups-count">
              <span className="rgroups-count-label">Number of groups</span>
              <div className="rgroups-stepper" role="group" aria-label="Number of groups">
                <button
                  type="button"
                  className="rgroups-step"
                  onClick={() => changeCount(count - 1)}
                  disabled={count <= 0}
                  aria-label="Fewer groups"
                >
                  –
                </button>
                <span className="rgroups-count-value">{count}</span>
                <button
                  type="button"
                  className="rgroups-step"
                  onClick={() => changeCount(count + 1)}
                  disabled={count >= MAX_ROSTER_GROUPS}
                  aria-label="More groups"
                >
                  +
                </button>
              </div>
              {count === 0 ? (
                <span className="rgroups-count-hint">
                  e.g. split {players.length} players into{" "}
                  {Math.max(2, Math.ceil(players.length / 6))} groups
                </span>
              ) : null}
            </div>

            {count === 0 ? null : (
              <>
                {/* Per-group summary: who's in each group and whether it's
                    missing a catcher or pitcher. */}
                <div className="rgroups-summaries">
                  {groupNumbers.map((g) => {
                    const members = byGroup.get(g) ?? [];
                    const missing = KEY_POSITIONS.filter(
                      (kp) => !hasPosition(members, kp.code),
                    );
                    return (
                      <div key={g} className="rgroup-card">
                        <div className="rgroup-card-head">
                          <span className="rgroup-chip">Group {g}</span>
                          <span className="rgroup-card-count">
                            {members.length}{" "}
                            {members.length === 1 ? "player" : "players"}
                          </span>
                        </div>
                        {members.length === 0 ? (
                          <p className="rgroup-card-empty">No players yet.</p>
                        ) : (
                          <p className="rgroup-card-names">
                            {members
                              .map(
                                (m) =>
                                  m.player_name +
                                  (m.primary_position
                                    ? ` (${m.primary_position})`
                                    : ""),
                              )
                              .join(", ")}
                          </p>
                        )}
                        {members.length > 0 && missing.length > 0 ? (
                          <p className="rgroup-card-warn">
                            No {missing.map((mp) => mp.label).join(" or ")}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                {/* Assignment grid: one row per player with a group picker. */}
                <ul className="rgroups-list">
                  {players.map((p) => {
                    const current = groups.get(p.id) ?? null;
                    return (
                      <li key={p.id} className="rgroups-row">
                        <span className="rgroups-player">
                          <span className="rgroups-player-name">
                            {p.player_name}
                          </span>
                          {p.primary_position ? (
                            <span className="rgroups-player-pos">
                              {p.primary_position}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className="rgroups-picker"
                          role="group"
                          aria-label={`Group for ${p.player_name}`}
                        >
                          <button
                            type="button"
                            className={`rgroups-opt${current == null ? " is-on" : ""}`}
                            aria-pressed={current == null}
                            onClick={() => assign(p.id, null)}
                          >
                            —
                          </button>
                          {groupNumbers.map((g) => (
                            <button
                              key={g}
                              type="button"
                              className={`rgroups-opt${current === g ? " is-on" : ""}`}
                              aria-pressed={current === g}
                              onClick={() => assign(p.id, g)}
                            >
                              {g}
                            </button>
                          ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <p className="rgroups-foot">
                  Tip: keep the groups roughly even and make sure each has a
                  catcher and a pitcher.{" "}
                  <Link href="/teams">Edit positions on the Teams tab</Link>.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
