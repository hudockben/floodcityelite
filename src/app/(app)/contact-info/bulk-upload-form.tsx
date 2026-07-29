"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import BulkImportSummary from "../bulk-import-summary";
import type { BulkImportState } from "../bulk-import";
import { sportLabel, type Sport } from "../teams/divisions";
import { bulkUploadCoachesAction } from "./actions";
import { COACH_TEMPLATE_HEADERS } from "./coach-export";

const initialState: BulkImportState = {};

// One example row under the template's headers, so the shape of a filled-in
// file is obvious. Order matches COACH_TEMPLATE_HEADERS.
const TEMPLATE_SAMPLE = [
  "Baseball",
  "Penn State University",
  "Coach Miller",
  "Recruiting Coordinator",
  "NCAA D1",
  "Big Ten",
  "(814) 555-0134",
  "miller@psu.edu",
  "gopsusports.com",
  "State College",
  "PA",
  "Met at the June showcase",
];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadTemplate() {
  const csv =
    COACH_TEMPLATE_HEADERS.map(csvCell).join(",") +
    "\n" +
    TEMPLATE_SAMPLE.map(csvCell).join(",") +
    "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "college-contacts-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BulkUploadForm({ sport }: { sport: Sport }) {
  const [state, formAction, pending] = useActionState(
    bulkUploadCoachesAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState("");

  // Clear the file input after a successful import so the next upload starts
  // fresh (the result summary stays visible below the form).
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      setFileName("");
    }
  }, [state]);

  return (
    <details className="bulk-upload">
      <summary className="bulk-upload-summary">
        <span className="tg-caret" aria-hidden="true" />
        <span className="bulk-upload-title">
          Bulk upload contacts (CSV or Excel)
        </span>
      </summary>

      <div className="bulk-upload-body">
        <p className="muted-note">
          Add a whole list of colleges at once from a spreadsheet — a camp
          contact sheet, a recruiting service export, or your own file. Columns
          are matched to the contact fields automatically, and any school
          already on the list is skipped, so re-uploading an updated file never
          creates duplicates. Rows land on the{" "}
          <strong>{sportLabel(sport)}</strong> list unless the file has a{" "}
          <code>sport</code> column saying otherwise.
        </p>

        <form ref={formRef} action={formAction} className="bulk-upload-form">
          <input type="hidden" name="sport" value={sport} />

          <div className="player-grid">
            <div className="field">
              <label htmlFor="coach-bulk-file">CSV or Excel file *</label>
              <input
                id="coach-bulk-file"
                name="file"
                type="file"
                required
                accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
              />
              {fileName ? <span className="bulk-file-name">{fileName}</span> : null}
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
          <BulkImportSummary
            result={state.result}
            noun="contact"
            nounPlural="contacts"
            requiredLabel="school name"
          />
        ) : null}

        <details className="bulk-upload-help">
          <summary>Which columns can I include?</summary>
          <div className="bulk-help-body">
            <p>
              Every contact needs a <code>school</code> (or{" "}
              <code>school_name</code>) column. These optional columns are
              recognized — common spellings work too, and capitalization,
              spaces and underscores don&apos;t matter:
            </p>
            <ul>
              <li>
                <code>sport</code> — <code>baseball</code> or{" "}
                <code>softball</code>, to send a row to the other list
              </li>
              <li>
                <code>coach_name</code> / <code>coach</code>
              </li>
              <li>
                <code>title</code> / <code>role</code>
              </li>
              <li>
                <code>division_level</code> / <code>level</code> (e.g. NCAA D1)
              </li>
              <li>
                <code>conference</code>
              </li>
              <li>
                <code>cell_phone</code> / <code>phone</code>
              </li>
              <li>
                <code>email</code>
              </li>
              <li>
                <code>website</code> / <code>url</code>
              </li>
              <li>
                <code>city</code>, <code>state</code>
              </li>
              <li>
                <code>notes</code>
              </li>
            </ul>
            <p className="muted-note">
              Any other columns are ignored, and the import says which ones
              those were. A file downloaded with the CSV or Excel button above
              can be edited and uploaded straight back.
            </p>
          </div>
        </details>
      </div>
    </details>
  );
}
