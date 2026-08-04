"use client";

// The CSV / Excel download pair that sits with a directory's filters — plus an
// optional PDF, for the tabs that have a printable report. Plain links so the
// browser handles the file; the hrefs are built by the caller from its live
// filter state, so a download holds exactly the rows on screen.
//
// `count` is what those filters currently show — it goes into the accessible
// label so the buttons say what they'll actually produce.
export default function ExportButtons({
  href,
  pdfHref,
  pdfLabel,
  count,
  nounPlural,
}: {
  /** Builds the export URL for a format. */
  href: (format: "csv" | "xlsx") => string;
  /**
   * A printable report of the same rows, opened in a new tab where the browser
   * prints it or saves it as a PDF. Omitted on tabs that don't have one.
   */
  pdfHref?: string;
  /**
   * The PDF button's accessible label, for a report that covers more than the
   * rows beside it — a camp's whole report, say, rather than just its roster.
   * Without it the label describes the same rows the CSV and Excel do.
   */
  pdfLabel?: string;
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
      {pdfHref ? (
        // Not a `download`: it opens a report page that offers the browser's
        // own print / save-as-PDF dialog. A new tab keeps the filters you set
        // waiting behind it.
        <a
          className="btn-secondary subs-export-btn"
          href={pdfHref}
          target="_blank"
          rel="noopener"
          aria-label={pdfLabel ?? `Open a printable PDF of ${label}`}
        >
          ⬇ PDF
        </a>
      ) : null}
    </div>
  );
}
