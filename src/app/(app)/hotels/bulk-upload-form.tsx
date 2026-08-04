"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import BulkImportSummary from "../bulk-import-summary";
import type { BulkImportState } from "../bulk-import";
import { bulkUploadHotelsAction } from "./actions";
import { HOTEL_TEMPLATE_HEADERS } from "./hotel-export";

const initialState: BulkImportState = {};

// One example row under the template's headers, so the shape of a filled-in
// file is obvious. Order matches HOTEL_TEMPLATE_HEADERS.
const TEMPLATE_SAMPLE = [
  "Hampton Inn & Suites",
  "1235 Scalp Ave",
  "Johnstown",
  "PA",
  "129.00",
  "(814) 555-0110",
  "hilton.com/johnstown",
  "Ask for the team rate, breakfast included",
  "Fall Baseball",
  "Keystone Classic",
];

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function downloadTemplate() {
  const csv =
    HOTEL_TEMPLATE_HEADERS.map(csvCell).join(",") +
    "\n" +
    TEMPLATE_SAMPLE.map(csvCell).join(",") +
    "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "hotels-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function BulkUploadForm() {
  const [state, formAction, pending] = useActionState(
    bulkUploadHotelsAction,
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
          Bulk upload hotels (CSV or Excel)
        </span>
      </summary>

      <div className="bulk-upload-body">
        <p className="muted-note">
          Add a whole travel list at once from a spreadsheet — a tournament&apos;s
          hotel block list, a rate sheet, or your own file. Columns are matched
          to the hotel fields automatically, and any hotel already on the list
          (same name and city) is skipped, so re-uploading an updated file never
          creates duplicates. A <code>tournament</code> column ties each stay to
          a{" "}
          <Link className="inline-link" href="/schedules">
            Schedules
          </Link>{" "}
          tab tournament by name.
        </p>

        <form ref={formRef} action={formAction} className="bulk-upload-form">
          <div className="player-grid">
            <div className="field">
              <label htmlFor="hotel-bulk-file">CSV or Excel file *</label>
              <input
                id="hotel-bulk-file"
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
            noun="hotel"
            nounPlural="hotels"
            requiredLabel="hotel name"
          />
        ) : null}

        <details className="bulk-upload-help">
          <summary>Which columns can I include?</summary>
          <div className="bulk-help-body">
            <p>
              Every hotel needs a <code>hotel</code> (or <code>hotel_name</code>)
              column. These optional columns are recognized — common spellings
              work too, and capitalization, spaces and underscores don&apos;t
              matter:
            </p>
            <ul>
              <li>
                <code>address</code>, <code>city</code>, <code>state</code>
              </li>
              <li>
                <code>avg_cost_per_night</code> / <code>rate</code> — a plain
                amount; a leading <code>$</code> and commas are fine
              </li>
              <li>
                <code>phone</code>
              </li>
              <li>
                <code>website</code> / <code>booking_link</code>
              </li>
              <li>
                <code>notes</code>
              </li>
              <li>
                <code>division</code> — a Teams division, by name or slug
              </li>
              <li>
                <code>tournament</code> / <code>event</code> — matched to a
                Schedules tournament by name
              </li>
            </ul>
            <p className="muted-note">
              A tournament name that isn&apos;t on the Schedules tab still
              imports the hotel; the summary lists the names that didn&apos;t
              match. Any other columns are ignored, and the import says which
              ones those were. A file downloaded with the CSV or Excel button
              above can be edited and uploaded straight back.
            </p>
          </div>
        </details>
      </div>
    </details>
  );
}
