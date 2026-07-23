"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  bulkUploadRosterAction,
  type BulkUploadResult,
  type BulkUploadState,
} from "./actions";
import { sportLabel, type DivisionSlug } from "./divisions";

const initialState: BulkUploadState = {};

type TeamOption = { id: number; name: string; sport: string };

// Headers offered by the downloadable template. The "team" column routes each
// row to a team by name when auto-assign is used. Everything else maps onto the
// roster fields the Teams tab already uses; extra columns a club export might
// carry (season, gender, grade, address, a second parent, …) are ignored.
const TEMPLATE_HEADERS = [
  "team",
  "player_first",
  "player_last",
  "birth_date",
  "grad_year",
  "height",
  "weight",
  "primary_position",
  "secondary_position",
  "high_school",
  "parent1_name",
  "parent1_email",
  "parent1_mobile",
  "closest_facility",
];
const TEMPLATE_SAMPLE = [
  "10U Carolina",
  "Aryanna",
  "Young",
  "2/20/2016",
  "",
  "",
  "",
  "SS",
  "2B",
  "",
  "Lindsey Jacobs",
  "ljacobs05@example.com",
  "814-418-4111",
  "Johnstown",
];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadTemplate() {
  const csv =
    TEMPLATE_HEADERS.map(csvCell).join(",") +
    "\n" +
    TEMPLATE_SAMPLE.map(csvCell).join(",") +
    "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "roster-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function NameList({
  label,
  names,
  total,
}: {
  label: string;
  names: string[];
  total: number;
}) {
  if (total === 0) return null;
  // The action caps how many names it returns; show the true total in the label
  // and note how many were omitted so the count never contradicts the stat row.
  const hidden = total - names.length;
  return (
    <details className="bulk-namelist">
      <summary>
        {label} ({total})
      </summary>
      <ul>
        {names.map((n, i) => (
          <li key={`${n}-${i}`}>{n}</li>
        ))}
        {hidden > 0 ? (
          <li className="bulk-namelist-more">…and {hidden} more</li>
        ) : null}
      </ul>
    </details>
  );
}

function ResultSummary({ result }: { result: BulkUploadResult }) {
  const {
    mode,
    added,
    duplicates,
    noName,
    unmatchedTeamRows,
    blankTeamRows,
    perTeam,
    unmatchedTeams,
    addedNames,
    duplicateNames,
    ignoredColumns,
    warnings,
  } = result;

  const teamsWithAdds = perTeam.filter((t) => t.added > 0);
  // In auto-assign the destination team can be in a different division than the
  // one being viewed, so name it in the headline (the roster below is
  // division-scoped and won't show those players).
  const soleTeam = teamsWithAdds.length === 1 ? teamsWithAdds[0] : null;
  const soleTeamLabel =
    soleTeam &&
    (mode === "auto" && soleTeam.division
      ? `${soleTeam.teamName} · ${soleTeam.division}`
      : soleTeam.teamName);
  const headline =
    added === 0
      ? "No new players were added."
      : soleTeam
        ? `Added ${added} ${added === 1 ? "player" : "players"} to ${soleTeamLabel}.`
        : `Added ${added} players across ${teamsWithAdds.length} teams.`;

  return (
    <div className={`bulk-result${added > 0 ? " ok" : " neutral"}`} role="status">
      <p className="bulk-result-headline">
        <span aria-hidden="true">{added > 0 ? "✓ " : "• "}</span>
        {headline}
      </p>

      <ul className="bulk-result-stats">
        <li>
          <strong>{added}</strong> added
        </li>
        {duplicates > 0 ? (
          <li>
            <strong>{duplicates}</strong> skipped as duplicate
            {duplicates === 1 ? "" : "s"}
          </li>
        ) : null}
        {unmatchedTeamRows > 0 ? (
          <li>
            <strong>{unmatchedTeamRows}</strong> skipped — team not found
          </li>
        ) : null}
        {blankTeamRows > 0 ? (
          <li>
            <strong>{blankTeamRows}</strong> skipped — no team listed
          </li>
        ) : null}
        {noName > 0 ? (
          <li>
            <strong>{noName}</strong> skipped — no player name
          </li>
        ) : null}
      </ul>

      {blankTeamRows > 0 ? (
        <p className="bulk-result-note">
          {blankTeamRows} {blankTeamRows === 1 ? "player" : "players"} had no team
          in the file — add a team name in the <code>team</code> column, or choose a
          specific team above instead of auto-assign.
        </p>
      ) : null}

      {perTeam.length > 1 ? (
        <table className="bulk-perteam">
          <thead>
            <tr>
              <th>Team</th>
              <th>Added</th>
              <th>Skipped</th>
            </tr>
          </thead>
          <tbody>
            {perTeam.map((t) => (
              <tr key={`${t.teamName}-${t.division}`}>
                <td>
                  {t.teamName}
                  {t.division ? (
                    <span className="bulk-perteam-div">{t.division}</span>
                  ) : null}
                </td>
                <td>{t.added}</td>
                <td>{t.duplicates || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {unmatchedTeams.length > 0 ? (
        <div className="bulk-unmatched">
          <p className="bulk-result-note">
            These team names weren&apos;t found among your teams, so their players
            were skipped:
          </p>
          <ul>
            {unmatchedTeams.map((u) => (
              <li key={u.name}>
                <strong>{u.name}</strong> — {u.rows}{" "}
                {u.rows === 1 ? "player" : "players"}
              </li>
            ))}
          </ul>
          <p className="muted-note">
            Create a team with a matching name (or fix the spelling in the file),
            then re-upload.
          </p>
        </div>
      ) : null}

      <NameList label="Show added" names={addedNames} total={added} />
      <NameList
        label="Show skipped duplicates"
        names={duplicateNames}
        total={duplicates}
      />

      {ignoredColumns.length > 0 ? (
        <p className="bulk-result-note">
          Ignored {ignoredColumns.length} column
          {ignoredColumns.length === 1 ? "" : "s"} we don&apos;t track:{" "}
          {ignoredColumns.join(", ")}.
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <details className="bulk-namelist bulk-warnings">
          <summary>Show warnings ({warnings.length})</summary>
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export default function BulkUploadForm({
  division,
  teams,
  companyHasTeams,
}: {
  division: DivisionSlug;
  teams: TeamOption[];
  /** Whether the company has any team (in any division) — auto-assign is
   *  company-wide, so the form is useful even when this division has none. */
  companyHasTeams: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    bulkUploadRosterAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState("");

  // Clear the file input after a successful import so the next upload starts
  // fresh (the result summary stays visible above the form).
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setFileName("");
    }
  }, [state]);

  // Show the form whenever the company has any team — auto-assign matches by
  // name across all divisions, so it's useful even from a division with none.
  if (teams.length === 0 && !companyHasTeams) return null;
  const noTeamsInDivision = teams.length === 0;

  return (
    <details className="bulk-upload">
      <summary className="bulk-upload-summary">
        <span className="tg-caret" aria-hidden="true" />
        <span className="bulk-upload-title">Bulk upload a roster (CSV or Excel)</span>
      </summary>

      <div className="bulk-upload-body">
        <p className="muted-note">
          Add whole rosters at once from a spreadsheet. Leave the menu on{" "}
          <strong>auto-assign</strong> and each row is sent to the team named in its{" "}
          <code>team</code> column — so one file can fill in every team. (Or pick a
          single team to drop every row there.) Columns are matched to the roster
          fields automatically, and anyone already on a team&apos;s roster is skipped,
          so re-uploading an updated file never creates duplicates.
        </p>

        <form ref={formRef} action={formAction} className="bulk-upload-form">
          <input type="hidden" name="division" value={division} />

          <div className="player-grid">
            <div className="field">
              <label htmlFor="bulk-team">Assign players to</label>
              <select id="bulk-team" name="teamId" defaultValue="auto" required>
                <option value="auto">
                  Auto-assign by each row&apos;s “team” column
                </option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    Just this team: {t.name} · {sportLabel(t.sport)}
                  </option>
                ))}
              </select>
              {noTeamsInDivision ? (
                <span className="bulk-file-name">
                  This division has no teams yet — auto-assign will route rows to
                  your teams in other divisions by name.
                </span>
              ) : null}
            </div>

            <div className="field">
              <label htmlFor="bulk-file">CSV or Excel file *</label>
              <input
                id="bulk-file"
                name="file"
                type="file"
                required
                accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
              {fileName ? (
                <span className="bulk-file-name">{fileName}</span>
              ) : null}
            </div>
          </div>

          <div className="player-form-actions">
            <button type="submit" className="btn" disabled={pending}>
              {pending ? "Importing…" : "Upload & import"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={downloadTemplate}
            >
              ⬇ Download CSV template
            </button>
            {state?.error ? (
              <p className="error player-form-msg" role="alert">
                {state.error}
              </p>
            ) : null}
          </div>
        </form>

        {state?.ok && state.result ? (
          <ResultSummary result={state.result} />
        ) : null}

        <details className="bulk-upload-help">
          <summary>Which columns can I include?</summary>
          <div className="bulk-help-body">
            <p>
              For auto-assign, include a <code>team</code> column whose value matches
              a team name exactly (spacing and capitalization don&apos;t matter). Each
              player needs a name — use a single <code>player_name</code> column, or
              separate <code>player_first</code> and <code>player_last</code> columns.
              These optional columns are recognized (common spellings and{" "}
              <code>parent1_*</code>/<code>parent2_*</code> variants work too):
            </p>
            <ul>
              <li>
                <code>birth_date</code> / <code>dob</code>
              </li>
              <li>
                <code>grad_year</code>
              </li>
              <li>
                <code>height</code>, <code>weight</code>
              </li>
              <li>
                <code>primary_position</code>, <code>secondary_position</code> (or{" "}
                <code>position</code>)
              </li>
              <li>
                <code>high_school</code>
              </li>
              <li>
                <code>parent1_name</code>, <code>parent1_email</code>,{" "}
                <code>parent1_mobile</code>
              </li>
              <li>
                <code>closest_facility</code>
              </li>
            </ul>
            <p className="muted-note">
              Any other columns (season, sport, gender, grade, address, …) are ignored.
            </p>
          </div>
        </details>
      </div>
    </details>
  );
}
