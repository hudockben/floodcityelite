// ---------------------------------------------------------------------------
// Teams tab — the field (depth chart) itself
//
// No "use client": these are pure presentational components, so the same code
// renders inside the client modal (field-view.tsx) and on the server-rendered
// print sheet (print/field/page.tsx). Colors and sizes come from CSS, which is
// what lets the print sheet restyle the identical markup for paper.
// ---------------------------------------------------------------------------

import {
  depthLevel,
  shortName,
  FIELD_ASPECT,
  FIELD_VIEWBOX,
  type DepthLevel,
  type FieldChart,
  type SpotEntry,
} from "./field-positions";

// Names shown inside a position card before it collapses to "+N more" (the
// card's tooltip always lists everyone). Kept low enough that a stacked spot
// can't grow tall enough to swallow the card next to it.
const MAX_NAMES = 4;

/** The diamond, with a card on each of the nine spots. */
export function FieldDiagram({ chart }: { chart: FieldChart }) {
  return (
    <div className="fv-field-scroll">
      <div className="fv-field" style={{ aspectRatio: FIELD_ASPECT }}>
        <FieldGraphic />
        {chart.spots.map(({ spot, entries }) => (
          <PositionPod
            key={spot.key}
            label={spot.key}
            name={spot.name}
            entries={entries}
            x={spot.x}
            y={spot.y}
          />
        ))}
      </div>
    </div>
  );
}

/** The heavy/thin read, shown above the field so it lands first. */
export function FieldDepthSummary({ chart }: { chart: FieldChart }) {
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

export function FieldLegend() {
  return (
    <p className="fv-legend">
      <span className="fv-key fv-key-primary" aria-hidden="true" /> Primary
      position
      <span className="fv-key fv-key-backup" aria-hidden="true" /> Secondary
      position
    </p>
  );
}

/** Positions with no single spot on the diagram, plus players with none listed. */
export function FieldExtras({ chart }: { chart: FieldChart }) {
  if (chart.offField.length === 0 && chart.unlisted.length === 0) return null;

  return (
    <section className="fv-extras">
      <h3 className="fv-extras-title">Not on the diamond</h3>
      <ul className="fv-extras-list">
        {chart.offField.map((group) => (
          <li key={group.group}>
            <span
              className="fv-extras-label"
              // Free text we couldn't place is shown as typed and marked, so a
              // misspelling reads as "fix the roster", not "we know about this
              // position".
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

// The diamond itself. Drawn in the same box the position cards are placed
// against (see FIELD_ASPECT), so the two stay aligned at any size.
// Purely decorative — every name is in the cards above it. Fills and strokes
// are CSS classes, not attributes, so the print sheet can swap the dark-theme
// greens for paper without a second copy of this drawing.
function FieldGraphic() {
  return (
    <svg
      className="fv-svg"
      viewBox={FIELD_VIEWBOX}
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
        className="fv-grass"
        d="M 200 318 L 14 132 A 263 263 0 0 1 386 132 Z"
      />

      {/* Infield skin, trimmed to fair territory. */}
      <circle className="fv-dirt" cx="200" cy="242" r="118" clipPath="url(#fv-fair)" />

      {/* Grass inside the base paths. */}
      <polygon className="fv-grass-in" points="200,300 258,242 200,184 142,242" />

      {/* Base paths + foul lines. */}
      <polygon className="fv-chalk" points="200,318 276,242 200,166 124,242" />
      <path className="fv-chalk" d="M 200 318 L 14 132 M 200 318 L 386 132" />

      {/* Mound and bases. */}
      <circle className="fv-mound" cx="200" cy="242" r="15" />
      <g className="fv-base">
        <rect x="271" y="237" width="10" height="10" transform="rotate(45 276 242)" />
        <rect x="195" y="161" width="10" height="10" transform="rotate(45 200 166)" />
        <rect x="119" y="237" width="10" height="10" transform="rotate(45 124 242)" />
        <polygon points="193,312 207,312 207,319 200,325 193,319" />
      </g>
    </svg>
  );
}
