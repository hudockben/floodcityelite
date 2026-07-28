import { createSeasonAction } from "./actions";
import { type DivisionSlug } from "./divisions";

// The "New season" control on the Teams tab. Starting a new season creates the
// next year's (empty) run of this division and switches to it — new season
// means fresh rosters, so nothing is copied unless "Copy team names" is ticked,
// which clones just the team names forward with empty rosters so the coach
// doesn't retype them. Posts to the createSeasonAction server action, which
// redirects to the new season.
export default function NewSeasonForm({
  division,
  sourceSeasonId,
  nextYear,
}: {
  division: DivisionSlug;
  sourceSeasonId: number;
  nextYear: number;
}) {
  return (
    <details className="new-season">
      <summary className="new-season-summary">
        <span aria-hidden="true">＋</span> Start new season
      </summary>
      <form action={createSeasonAction} className="new-season-form">
        <input type="hidden" name="division" value={division} />
        <input type="hidden" name="source_season_id" value={sourceSeasonId} />

        <label className="new-season-field">
          <span>Year</span>
          <input
            type="number"
            name="year"
            defaultValue={nextYear}
            min={2000}
            max={2100}
            required
          />
        </label>

        <label className="new-season-copy">
          <input type="checkbox" name="copy_teams" value="true" />
          <span>Copy team names forward (empty rosters)</span>
        </label>

        <button type="submit" className="btn-secondary new-season-submit">
          Create season
        </button>
      </form>
    </details>
  );
}
