"use client";

// The CSV / Excel download pair that sits with a directory's filters. Plain
// links so the browser handles the file; the href is built by the caller from
// its live filter state, so a download holds exactly the rows on screen.
//
// `count` is what those filters currently show — it goes into the accessible
// label so the buttons say what they'll actually produce.
export default function ExportButtons({
  href,
  count,
  nounPlural,
}: {
  /** Builds the export URL for a format. */
  href: (format: "csv" | "xlsx") => string;
  count: number;
  nounPlural: string;
}) {
  const label = `${count} ${count === 1 ? nounPlural.replace(/s$/, "") : nounPlural}`;
  return (
    <div className="subs-export">
      <a
        className="btn-secondary subs-export-btn"
        href={href("csv")}
        download
        aria-label={`Download ${label} as CSV`}
      >
        ⬇ CSV
      </a>
      <a
        className="btn-secondary subs-export-btn"
        href={href("xlsx")}
        download
        aria-label={`Download ${label} as Excel`}
      >
        ⬇ Excel
      </a>
    </div>
  );
}
