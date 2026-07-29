"use client";

import type { BulkImportResult } from "./bulk-import";

// What an import did, shown above the upload form once it finishes. Shared by
// the Contact Info and Hotels uploads — they report the same things, so they
// read the same way. `noun`/`nounPlural` name the records for this tab
// ("contact"/"contacts", "hotel"/"hotels").

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

export default function BulkImportSummary({
  result,
  noun,
  nounPlural,
  requiredLabel,
}: {
  result: BulkImportResult;
  noun: string;
  nounPlural: string;
  /** The column a row can't come in without, e.g. "school name". */
  requiredLabel: string;
}) {
  const {
    added,
    duplicates,
    missingRequired,
    addedNames,
    duplicateNames,
    ignoredColumns,
    warnings,
    unmatched,
  } = result;

  const headline =
    added === 0
      ? `No new ${nounPlural} were added.`
      : `Added ${added} ${added === 1 ? noun : nounPlural}.`;

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
        {missingRequired > 0 ? (
          <li>
            <strong>{missingRequired}</strong> skipped — no {requiredLabel}
          </li>
        ) : null}
      </ul>

      {unmatched && unmatched.items.length > 0 ? (
        <div className="bulk-unmatched">
          <p className="bulk-result-note">{unmatched.label}</p>
          <ul>
            {unmatched.items.map((u) => (
              <li key={u.name}>
                <strong>{u.name}</strong> — {u.rows} {u.rows === 1 ? "row" : "rows"}
              </li>
            ))}
          </ul>
          <p className="muted-note">{unmatched.note}</p>
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
