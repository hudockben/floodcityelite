import { rosterStatus } from "./divisions";

/**
 * "Returning" / "New" pill for a roster row, from the acceptance form's
 * "Did you play in 2026?" answer.
 *
 * A player added by hand on the Teams tab or through a bulk upload has no
 * submission behind them, so nobody ever answered the question — that shows as
 * an em dash rather than being guessed at as "new".
 */
export default function RosterStatusBadge({
  playedLastSeason,
}: {
  playedLastSeason: boolean | null;
}) {
  const status = rosterStatus(playedLastSeason);

  if (status == null) {
    return (
      <span className="cell-empty" title="No acceptance form on file for this player">
        —
      </span>
    );
  }

  return (
    <span
      className={`rs-badge rs-${status}`}
      title={
        status === "returning"
          ? "Played last season — from the acceptance form"
          : "New to the program — from the acceptance form"
      }
    >
      {status === "returning" ? "Returning" : "New"}
    </span>
  );
}
