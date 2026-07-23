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

// Headers offered by the downloadable template. These map onto the roster
// fields the Teams tab already uses; a club's own export can also include extra
// columns (season, gender, grade, address, a second parent, …) — those are
// simply ignored on import.
const TEMPLATE_HEADERS = [
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

function NameList({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;
  return (
    <details className="bulk-namelist">
      <summary>{label}</summary>
      <ul>
        {names.map((n, i) => (
          <li key={`${n}-${i}`}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

function ResultSummary({ result }: { result: BulkUploadResult }) {
  const {
    teamName,
    added,
    duplicatesExisting,
    duplicatesInFile,
    noName,
    addedNames,
    duplicateNames,
    ignoredColumns,
    warnings,
  } = result;
  const duplicates = duplicatesExisting + duplicatesInFile;
  const headline =
    added > 0
      ? `Added ${added} ${added === 1 ? "player" : "players"} to ${teamName}.`
      : `No new players were added to ${teamName}.`;

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
            {duplicatesExisting > 0 && duplicatesInFile > 0
              ? ` (${duplicatesExisting} already on the roster, ${duplicatesInFile} repeated in the file)`
              : duplicatesExisting > 0
                ? " (already on the roster)"
                : " (repeated in the file)"}
          </li>
        ) : null}
        {noName > 0 ? (
          <li>
            <strong>{noName}</strong> skipped — no player name
          </li>
        ) : null}
      </ul>

      <NameList label={`Show added (${addedNames.length})`} names={addedNames} />
      <NameList
        label={`Show skipped duplicates (${duplicateNames.length})`}
        names={duplicateNames}
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
}: {
  division: DivisionSlug;
  teams: TeamOption[];
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

  if (teams.length === 0) return null;

  return (
    <details className="bulk-upload">
      <summary className="bulk-upload-summary">
        <span className="tg-caret" aria-hidden="true" />
        <span className="bulk-upload-title">Bulk upload a roster (CSV or Excel)</span>
      </summary>

      <div className="bulk-upload-body">
        <p className="muted-note">
          Add a whole roster at once from a spreadsheet. Columns are matched to the
          roster fields automatically — first &amp; last name become the player name,
          birth date and parent contact map across too. Anyone already on the selected
          team&apos;s roster is skipped, so re-uploading an updated file never creates
          duplicates.
        </p>

        <form ref={formRef} action={formAction} className="bulk-upload-form">
          <input type="hidden" name="division" value={division} />

          <div className="player-grid">
            <div className="field">
              <label htmlFor="bulk-team">Import into team *</label>
              <select id="bulk-team" name="teamId" defaultValue="" required>
                <option value="" disabled>
                  Choose a team…
                </option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {sportLabel(t.sport)}
                  </option>
                ))}
              </select>
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
              Only a name is required. Use a single <code>player_name</code> column,
              or separate <code>player_first</code> and <code>player_last</code>{" "}
              columns. These optional columns are recognized (common spellings and
              <code> parent1_*</code>/<code>parent2_*</code> variants work too):
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
