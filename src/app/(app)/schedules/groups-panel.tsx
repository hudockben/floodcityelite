"use client";

import Link from "next/link";
import type { GroupPlayer } from "./events";

// The Groups panel that expands under a schedule row. It lists the team's
// roster and lets the coach set who's attending that tournament. Presentational
// only — the attendance state and the server calls live in EventRow so the
// count on the "Groups" button stays in sync with the toggles here.
export default function GroupsPanel({
  players,
  benched,
  division,
  onToggle,
  onSetAll,
}: {
  players: GroupPlayer[];
  benched: Set<number>;
  division: string;
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

  const attendingCount = players.length - benched.size;
  const allIn = benched.size === 0;
  const allOut = benched.size === players.length;

  return (
    <div className="groups-panel">
      <div className="groups-head">
        <div className="groups-counts">
          <span className="groups-count-main">
            {attendingCount} of {players.length} attending
          </span>
          {benched.size > 0 ? (
            <span className="groups-count-bench">
              {benched.size} sitting
            </span>
          ) : null}
        </div>
        <div className="groups-bulk">
          <button
            type="button"
            className="groups-bulk-btn"
            onClick={() => onSetAll(true)}
            disabled={allIn}
          >
            All in
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
          const attending = !benched.has(p.id);
          return (
            <li key={p.id}>
              <button
                type="button"
                className={`group-player ${attending ? "is-in" : "is-out"}`}
                aria-pressed={attending}
                onClick={() => onToggle(p.id)}
              >
                <span className="group-player-mark" aria-hidden="true">
                  {attending ? "✓" : "–"}
                </span>
                <span className="group-player-name">{p.player_name}</span>
                {p.primary_position ? (
                  <span className="group-player-pos">{p.primary_position}</span>
                ) : null}
                <span className="group-player-state">
                  {attending ? "Attending" : "Sitting"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
