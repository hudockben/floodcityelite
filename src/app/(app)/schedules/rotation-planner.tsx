"use client";

import { useState } from "react";
import { planRotation, type PlayerAttendance } from "./events";

// Small helper for "1 tournament" / "2 tournaments".
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The per-team playing-time planner. It answers two questions a coach juggling
// a deep roster asks:
//
//   1. "How many tournaments do I need so everyone plays a fair share?" — pure
//      math from the roster size, how many players travel each weekend, and the
//      per-player target: ceil(rosterSize * target / perEvent).
//   2. "Given what I've actually scheduled and the groups I've set, is anyone
//      falling behind?" — a live readout of each player's appearances so far.
export default function RotationPlanner({
  rosterSize,
  scheduledEvents,
  players,
}: {
  rosterSize: number;
  scheduledEvents: number;
  players: PlayerAttendance[];
}) {
  // Seed the calculator from what we know: the real roster, taking the whole
  // roster by default (bench none), targeting the number already scheduled.
  const [rosterInput, setRosterInput] = useState(String(rosterSize));
  const [perEventInput, setPerEventInput] = useState(String(rosterSize));
  const [targetInput, setTargetInput] = useState(
    String(scheduledEvents > 0 ? scheduledEvents : 4),
  );

  const num = (s: string) => {
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const N = num(rosterInput);
  const S = num(perEventInput);
  const T = num(targetInput);
  const plan = planRotation(N, S, T);

  const gap = plan.tournamentsNeeded - scheduledEvents;

  // Live fairness: how many of the team's scheduled events each player is
  // attending, lowest first, flagging anyone under the target.
  const ranked = [...players].sort(
    (a, b) => a.attending - b.attending || a.player_name.localeCompare(b.player_name),
  );
  const shortCount = players.filter((p) => p.attending < T).length;

  return (
    <div className="planner">
      <div className="planner-head">
        <h3 className="planner-title">Playing-time planner</h3>
        <p className="planner-sub">
          Work out how many tournaments cover a fair rotation, and see who&apos;s
          behind.
        </p>
      </div>

      <div className="planner-inputs">
        <label className="planner-field">
          <span>Players on roster</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={rosterInput}
            onChange={(e) => setRosterInput(e.target.value)}
          />
        </label>
        <label className="planner-field">
          <span>Take each tournament</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={perEventInput}
            onChange={(e) => setPerEventInput(e.target.value)}
          />
        </label>
        <label className="planner-field">
          <span>Target per player</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={targetInput}
            onChange={(e) => setTargetInput(e.target.value)}
          />
        </label>
      </div>

      {plan.valid ? (
        <div className="planner-result">
          <div className="planner-number">
            <span className="planner-number-value">
              {plan.tournamentsNeeded}
            </span>
            <span className="planner-number-label">
              {plan.tournamentsNeeded === 1 ? "tournament" : "tournaments"} to
              schedule
            </span>
          </div>
          <div className="planner-explain">
            <p>
              Taking <strong>{plan.perEvent}</strong> of{" "}
              <strong>{plan.rosterSize}</strong> each time, everyone plays at
              least <strong>{plan.minPlays}</strong>
              {plan.playersAtMax > 0 ? (
                <>
                  {" "}
                  — {plural(plan.playersAtMax, "player")} play{" "}
                  {plan.minPlays + 1}
                </>
              ) : (
                <> — an even split</>
              )}
              . {plan.benchPerEvent > 0
                ? `${plural(plan.benchPerEvent, "player")} rest each tournament.`
                : "Nobody sits."}
            </p>
            <p
              className={
                gap > 0 ? "planner-gap short" : "planner-gap ok"
              }
            >
              {scheduledEvents === 0
                ? `None scheduled yet — add ${plural(
                    plan.tournamentsNeeded,
                    "tournament",
                  )}.`
                : gap > 0
                  ? `You've scheduled ${scheduledEvents} — add ${plural(
                      gap,
                      "more",
                    )} to hit the target.`
                  : `You've scheduled ${scheduledEvents}, enough to cover it.`}
            </p>
          </div>
        </div>
      ) : (
        <p className="planner-invalid">
          Enter a roster size, how many players travel, and a target number of
          tournaments to see the plan.
        </p>
      )}

      <div className="planner-fairness">
        <div className="planner-fairness-head">
          <h4>Playing time so far</h4>
          {scheduledEvents > 0 ? (
            <span
              className={`planner-fairness-summary ${
                shortCount > 0 ? "short" : "ok"
              }`}
            >
              {scheduledEvents < T
                ? `Only ${plural(
                    scheduledEvents,
                    "tournament",
                  )} scheduled — not enough to reach ${T} yet`
                : shortCount === 0
                  ? `Every player is on track for ${T}`
                  : `${shortCount} below ${plural(T, "tournament")}`}
            </span>
          ) : null}
        </div>

        {players.length === 0 ? (
          <p className="planner-note">Add players to this team to track this.</p>
        ) : scheduledEvents === 0 ? (
          <p className="planner-note">
            Once you add tournaments and set each one&apos;s group, every
            player&apos;s appearances show here.
          </p>
        ) : (
          <ul className="planner-players">
            {ranked.map((p) => {
              const short = p.attending < T;
              return (
                <li
                  key={p.id}
                  className={`planner-player ${short ? "short" : ""}`}
                >
                  <span className="planner-player-name">{p.player_name}</span>
                  <span className="planner-player-count">
                    {p.attending}
                    <span className="planner-player-of">
                      /{scheduledEvents}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
