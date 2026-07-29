import { rosterStatus } from "./divisions";

/**
 * "Returning" / "New" pill for a roster row.
 *
 * The value is the coach's own setting when they've made one, otherwise the
 * acceptance form's "Did you play in 2026?" answer. A player added by hand or
 * bulk-uploaded has neither until someone sets it, so the cell reads as an em
 * dash rather than being guessed at as "new". The tooltip says which of the two
 * a pill is coming from.
 */
export default function RosterStatusBadge({
  playedLastSeason,
  override,
}: {
  playedLastSeason: boolean | null;
  override: boolean | null;
}) {
  const status = rosterStatus(playedLastSeason, override);

  if (status == null) {
    return (
      <span
        className="cell-empty"
        title="Not set — no acceptance form on file. Use Edit to set it."
      >
        —
      </span>
    );
  }

  const source =
    override != null ? "set on the roster" : "from the acceptance form";

  return (
    <span
      className={`rs-badge rs-${status}`}
      title={
        status === "returning"
          ? `Played last season — ${source}`
          : `New to the program — ${source}`
      }
    >
      {status === "returning" ? "Returning" : "New"}
    </span>
  );
}
