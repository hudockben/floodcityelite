"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FieldDepthSummary,
  FieldDiagram,
  FieldExtras,
  FieldLegend,
} from "./field-diagram";
import { buildFieldChart, type FieldPlayer } from "./field-positions";
import { sportLabel } from "./divisions";

// "View Field" — a quick-look depth chart. Each roster position is mapped onto
// the diamond so a coach can see at a glance which spots are stacked and which
// have nobody behind them. Primary positions are solid, secondary positions are
// outlined, and anything that isn't one of the nine fielding spots (DH,
// utility, or free text we can't place) is listed under the field rather than
// dropped. The same chart prints from `printHref`.
export default function FieldView({
  teamName,
  sport,
  players,
  printHref,
}: {
  teamName: string;
  sport: string;
  players: FieldPlayer[];
  printHref: string;
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
          printHref={printHref}
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
  printHref,
  onClose,
}: {
  teamName: string;
  sport: string;
  players: FieldPlayer[];
  printHref: string;
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
          <div className="fv-actions">
            {/* A new tab, like the roster print links: the print sheet renders
                the same chart on paper and opens the browser print dialog. */}
            <a
              className="fv-print"
              href={printHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              🖨 Print / Save PDF
            </a>
            <button type="button" className="fv-close" onClick={onClose}>
              Close
            </button>
          </div>
        </header>

        <FieldDepthSummary chart={chart} />
        <FieldDiagram chart={chart} />
        <FieldLegend />
        <FieldExtras chart={chart} />
      </div>
    </dialog>,
    document.body,
  );
}
