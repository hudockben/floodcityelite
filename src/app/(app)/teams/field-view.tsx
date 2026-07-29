"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  buildFieldChart,
  depthLevel,
  type DepthLevel,
  type FieldChart,
  shortName,
  type FieldPlayer,
  type SpotEntry,
} from "./field-positions";
import { sportLabel } from "./divisions";

// Names shown inside a position card before it collapses to "+N more" (the
// card's tooltip always lists everyone). Kept low enough that a stacked spot
// can't grow tall enough to swallow the card next to it.
const MAX_NAMES = 4;

// "View Field" — a quick-look depth chart. Each roster position is mapped onto
// the diamond so a coach can see at a glance which spots are stacked and which
// have nobody behind them. Primary positions are solid, secondary positions are
// outlined, and anything that isn't one of the nine fielding spots (DH,
// utility, or free text we can't place) is listed under the field rather than
// dropped.
export default function FieldView({
  teamName,
  sport,
  players,
}: {
  teamName: string;
  sport: string;
  players: FieldPlayer[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="tg-field-btn"
        // The button lives inside the team's <summary>, so swallow the click —
        // otherwise opening the field view would also expand/collapse the team.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-haspopup="dialog"
      >
        <span aria-hidden="true">⚾</span> View Field
      </button>

      {open ? (
        <FieldDialog
          teamName={teamName}
          sport={sport}
          players={players}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function FieldDialog({
  teamName,
  sport,
  players,
  onClose,
}: {
  teamName: string;
  sport: string;
  players: FieldPlayer[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const chart = useMemo(() => buildFieldChart(players), [players]);

  // Open as a modal on mount so the dialog gets the top layer, focus trapping,
  // and Escape-to-close for free. onClose (fired by Escape too) clears state.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // Rendered into <body>: the trigger sits inside a <summary>, and a dialog
  // nested there would bubble its clicks and keystrokes back into the
  // disclosure widget.
  return createPortal(
    <dialog
      ref={ref}
      className="fv-dialog"
      aria-labelledby="fv-title"
      onClose={onClose}
      // Click on the backdrop (the dialog element itself, outside the card).
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="fv-card">
        <header className="fv-head">
          <div>
            <h2 id="fv-title" className="fv-title">
              {teamName}
            </h2>
            <p className="fv-sub">
              {sportLabel(sport)} field · {players.length}{" "}
              {players.length === 1 ? "player" : "players"}
            </p>
          </div>
          <button type="button" className="fv-close" onClick={onClose}>
            Close
          </button>
        </header>

        <DepthSummary chart={chart} />

        <div className="fv-field-scroll">
          <div className="fv-field">
            <FieldGraphic />
            {chart.spots.map(({ spot, entries }) => (
              <PositionPod key={spot.key} label={spot.key} name={spot.name} entries={entries} x={spot.x} y={spot.y} />
            ))}
          </div>
        </div>

        <p className="fv-legend">
          <span className="fv-key fv-key-primary" aria-hidden="true" /> Primary
          position
          <span className="fv-key fv-key-backup" aria-hidden="true" /> Secondary
          position
        </p>

        {chart.offField.length > 0 || chart.unlisted.length > 0 ? (
          <section className="fv-extras">
            <h3 className="fv-extras-title">Not on the diamond</h3>
            <ul className="fv-extras-list">
              {chart.offField.map((group) => (
                <li key={group.group}>
                  <span
                    className="fv-extras-label"
                    // Free text we couldn't place is shown as typed and marked,
                    // so a misspelling reads as "fix the roster", not "we know
                    // about this position".
                    data-unknown={group.group.startsWith("?") ? "" : undefined}
                    title={
                      group.group.startsWith("?")
                        ? "Not a position we recognize — shown as typed on the roster"
                        : undefined
                    }
                  >
                    {group.label}
                  </span>
                  <span className="fv-extras-names">
                    {group.entries.map((entry, i) => (
                      <span
                        key={`${entry.player.id}-${entry.role}`}
                        className={entry.role === "secondary" ? "is-backup" : undefined}
                      >
                        {i > 0 ? ", " : ""}
                        {entry.player.player_name}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
              {chart.unlisted.length > 0 ? (
                <li>
                  <span className="fv-extras-label">No position listed</span>
                  <span className="fv-extras-names">
                    {chart.unlisted.map((p) => p.player_name).join(", ")}
                  </span>
                </li>
              ) : null}
            </ul>
          </section>
        ) : null}
      </div>
    </dialog>,
    document.body,
  );
}

// The uncovered / backup-only / stacked read, above the field so it is the
// first thing seen.
function DepthSummary({ chart }: { chart: FieldChart }) {
  const byLevel = (level: DepthLevel) =>
    chart.spots
      .filter((s) => depthLevel(s.entries) === level)
      .map((s) => s.spot.key);

  const uncovered = byLevel("none");
  const backupOnly = byLevel("backup");
  const deep = byLevel("deep");

  if (!uncovered.length && !backupOnly.length && !deep.length) {
    return (
      <p className="fv-summary">
        <span className="fv-flag fv-flag-ok">Every spot covered</span>
      </p>
    );
  }

  return (
    <p className="fv-summary">
      {uncovered.length ? (
        <span className="fv-flag fv-flag-none">
          Nobody at {uncovered.join(", ")}
        </span>
      ) : null}
      {backupOnly.length ? (
        <span className="fv-flag fv-flag-backup">
          Backups only at {backupOnly.join(", ")}
        </span>
      ) : null}
      {deep.length ? (
        <span className="fv-flag fv-flag-deep">Stacked at {deep.join(", ")}</span>
      ) : null}
    </p>
  );
}

function PositionPod({
  label,
  name,
  entries,
  x,
  y,
}: {
  label: string;
  name: string;
  entries: SpotEntry[];
  x: number;
  y: number;
}) {
  const shown = entries.slice(0, MAX_NAMES);
  const hidden = entries.length - shown.length;
  const roster = entries
    .map((e) => `${e.player.player_name}${e.role === "secondary" ? " (2nd)" : ""}`)
    .join(", ");

  return (
    <div
      className="fv-pod"
      data-depth={depthLevel(entries)}
      style={{ left: `${x}%`, top: `${y}%` }}
      title={roster ? `${name} — ${roster}` : `${name} — nobody listed`}
    >
      <div className="fv-pod-head">
        <span className="fv-pod-pos">{label}</span>
        <span className="fv-pod-count">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <p className="fv-pod-empty">open</p>
      ) : (
        <ul className="fv-pod-names">
          {shown.map((entry) => (
            <li
              key={`${entry.player.id}-${entry.role}`}
              className={entry.role === "secondary" ? "is-backup" : undefined}
            >
              {entry.player.jersey_number ? (
                <span className="fv-pod-num">#{entry.player.jersey_number}</span>
              ) : null}
              {shortName(entry.player.player_name)}
            </li>
          ))}
          {hidden > 0 ? <li className="fv-pod-more">+{hidden} more</li> : null}
        </ul>
      )}
    </div>
  );
}

// The diamond itself. Drawn in the same 400×380 box the position cards are
// placed against (see FIELD_ASPECT), so the two stay aligned at any size.
// Purely decorative — every name is in the cards above it.
function FieldGraphic() {
  return (
    <svg
      className="fv-svg"
      viewBox="0 0 400 380"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id="fv-fair">
          <path d="M 200 318 L 14 132 A 263 263 0 0 1 386 132 Z" />
        </clipPath>
      </defs>

      {/* Outfield grass, bounded by the foul lines and the fence. */}
      <path
        d="M 200 318 L 14 132 A 263 263 0 0 1 386 132 Z"
        fill="#123829"
        stroke="rgba(148, 187, 233, 0.28)"
        strokeWidth="1.5"
      />

      {/* Infield skin, trimmed to fair territory. */}
      <circle cx="200" cy="242" r="118" fill="#493725" clipPath="url(#fv-fair)" />

      {/* Grass inside the base paths. */}
      <polygon points="200,300 258,242 200,184 142,242" fill="#16432f" />

      {/* Base paths + foul lines. */}
      <polygon
        points="200,318 276,242 200,166 124,242"
        fill="none"
        stroke="rgba(238, 244, 251, 0.4)"
        strokeWidth="2"
      />
      <path
        d="M 200 318 L 14 132 M 200 318 L 386 132"
        stroke="rgba(238, 244, 251, 0.35)"
        strokeWidth="1.5"
      />

      {/* Mound and bases. */}
      <circle cx="200" cy="242" r="15" fill="#5b452f" />
      <g fill="#e6edf7">
        <rect x="271" y="237" width="10" height="10" transform="rotate(45 276 242)" />
        <rect x="195" y="161" width="10" height="10" transform="rotate(45 200 166)" />
        <rect x="119" y="237" width="10" height="10" transform="rotate(45 124 242)" />
        <polygon points="193,312 207,312 207,319 200,325 193,319" />
      </g>
    </svg>
  );
}
