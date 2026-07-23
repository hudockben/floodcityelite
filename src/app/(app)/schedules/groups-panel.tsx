"use client";

import Link from "next/link";
import { groupsLabel } from "./events";

// A roster player with their resolved state for one event, as shown in the
// Groups panel. `isException` means their attending state deviates from what
// the event's group selection dictates (a per-player override).
export type GroupPlayerView = {
  id: number;
  player_name: string;
  primary_position: string | null;
  roster_group: number | null;
  attending: boolean;
  isException: boolean;
};

// The Groups panel that expands under a schedule row. It picks which standing
// roster groups travel to the tournament (the fast, position-balanced way) and
// still lets the coach tap individual players for one-off exceptions.
// Presentational only — the state and the server calls live in EventRow so the
// count on the "Groups" button stays in sync with the toggles here.
export default function GroupsPanel({
  players,
  groupCount,
  groupSizes,
  selectedGroups,
  division,
  onToggleGroup,
  onToggle,
  onSetAll,
}: {
  players: GroupPlayerView[];
  groupCount: number;
  groupSizes: Map<number, number>;
  selectedGroups: Set<number>;
  division: string;
  onToggleGroup: (group: number) => void;
  onToggle: (playerId: number) => void;
  onSetAll: (attending: boolean) => void;
}) {
  if (players.length === 0) {
    return (
      <div className="groups-panel">
        <p className="groups-empty">
          No players on this team yet. Add the roster on the{" "}
          <Link href={`/teams?division=${division}`}>Teams tab</Link>, then come
          back to pick who&apos;s attending.
        </p>
      </div>
    );
  }

  const attendingCount = players.filter((p) => p.attending).length;
  const benchCount = players.length - attendingCount;
  const allIn = benchCount === 0 && selectedGroups.size === 0;
  const allOut = attendingCount === 0;

  const groupNumbers = Array.from({ length: groupCount }, (_, i) => i + 1);
  const selectedList = [...selectedGroups].sort((a, b) => a - b);
  // Ungrouped players when a group selection is active: they sit unless tapped.
  const ungroupedSitting =
    selectedGroups.size > 0
      ? players.filter((p) => p.roster_group == null && !p.attending).length
      : 0;

  return (
    <div className="groups-panel">
      {groupCount > 0 ? (
        <div className="egroups">
          <div className="egroups-head">
            <span className="egroups-title">Playing this tournament</span>
            <span className="egroups-picked">
              {selectedList.length > 0
                ? groupsLabel(selectedList)
                : "No groups picked"}
            </span>
          </div>
          <div className="egroup-chips">
            {groupNumbers.map((g) => {
              const on = selectedGroups.has(g);
              const size = groupSizes.get(g) ?? 0;
              return (
                <button
                  key={g}
                  type="button"
                  className={`egroup-chip${on ? " is-on" : ""}`}
                  aria-pressed={on}
                  onClick={() => onToggleGroup(g)}
                >
                  <span className="egroup-chip-name">Group {g}</span>
                  <span className="egroup-chip-count">{size}</span>
                </button>
              );
            })}
          </div>
          <p className="egroups-hint">
            Pick which groups travel — players in the selected groups play, the
            rest sit. Tap a player below for a one-off exception.
            {ungroupedSitting > 0
              ? ` ${ungroupedSitting} ungrouped ${
                  ungroupedSitting === 1 ? "player is" : "players are"
                } sitting.`
              : ""}
          </p>
        </div>
      ) : (
        <p className="egroups-nudge">
          Tip: set up <strong>Roster groups</strong> above to pick whole groups
          (catchers, pitchers and all) at once. For now, tap players to set who
          attends.
        </p>
      )}

      <div className="groups-head">
        <div className="groups-counts">
          <span className="groups-count-main">
            {attendingCount} of {players.length} attending
          </span>
          {benchCount > 0 ? (
            <span className="groups-count-bench">{benchCount} sitting</span>
          ) : null}
        </div>
        <div className="groups-bulk">
          <button
            type="button"
            className="groups-bulk-btn"
            onClick={() => onSetAll(true)}
            disabled={allIn}
          >
            Whole roster
          </button>
          <button
            type="button"
            className="groups-bulk-btn"
            onClick={() => onSetAll(false)}
            disabled={allOut}
          >
            Sit all
          </button>
        </div>
      </div>

      <p className="groups-hint">
        Tap a player to move them between attending and sitting for this
        tournament.
      </p>

      <ul className="groups-list">
        {players.map((p) => {
          const attending = p.attending;
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`group-player ${attending ? "is-in" : "is-out"}${
                  p.isException ? " is-exception" : ""
                }`}
                aria-pressed={attending}
                onClick={() => onToggle(p.id)}
                title={
                  p.isException
                    ? attending
                      ? "Added for this event (not in a selected group)"
                      : "Sitting this event (in a selected group)"
                    : undefined
                }
              >
                <span className="group-player-mark" aria-hidden="true">
                  {attending ? "✓" : "–"}
                </span>
                <span className="group-player-name">{p.player_name}</span>
                {p.roster_group != null ? (
                  <span className="group-player-grp">G{p.roster_group}</span>
                ) : null}
                {p.primary_position ? (
                  <span className="group-player-pos">{p.primary_position}</span>
                ) : null}
                <span className="group-player-state">
                  {attending ? "Attending" : "Sitting"}
                  {p.isException ? " ·" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
