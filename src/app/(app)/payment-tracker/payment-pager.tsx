"use client";

// ---------------------------------------------------------------------------
// Payment Tracker — the ledger's pager
//
// The ledger arrives whole (the running Total column and the totals footer both
// need every payment to be right), so this pages through rows the browser
// already holds: no round trip, and the filter bar, the downloads and the
// printed report keep covering the whole slice rather than the page on screen.
// ---------------------------------------------------------------------------

/** Rows-per-page choices, smallest first. The first one is the default. */
export const PAGE_SIZES = [25, 50, 100];

/** The "All" choice — one page holding everything the filters show. */
export const ALL_ROWS = 0;

export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

/**
 * Below this the pager doesn't appear at all: a ledger that fits in the
 * smallest page has nothing to page through, and nothing to choose either.
 */
export const PAGER_MIN_ROWS = PAGE_SIZES[0];

// How many numbered buttons the bar draws before it starts eliding.
const MAX_NUMBERS = 7;

/**
 * The page numbers to draw, with `null` standing for a gap ("…").
 *
 * Always the first page, the last page, and the current one with a neighbour
 * either side, so the bar stays a fixed handful of buttons wide whether the
 * ledger runs to six pages or six hundred.
 */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  const numbers: number[] = [];
  if (pageCount <= MAX_NUMBERS) {
    for (let p = 1; p <= pageCount; p++) numbers.push(p);
  } else {
    const near = [page - 1, page, page + 1].filter(
      (p) => p > 1 && p < pageCount,
    );
    numbers.push(1, ...near, pageCount);
  }

  const out: (number | null)[] = [];
  let prev = 0;
  for (const p of numbers) {
    if (p - prev > 1) out.push(null);
    out.push(p);
    prev = p;
  }
  return out;
}

export default function PaymentPager({
  page,
  pageCount,
  pageSize,
  from,
  to,
  total,
  onPage,
  onPageSize,
}: {
  /** The page on screen, 1-based. */
  page: number;
  pageCount: number;
  /** One of PAGE_SIZES, or ALL_ROWS. */
  pageSize: number;
  /** The 1-based row numbers this page covers, and what it's a slice of. */
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <nav className="pay-pager" aria-label="Ledger pages">
      <span className="pay-pager-range">
        Showing {from}–{to} of {total} {total === 1 ? "payment" : "payments"}
      </span>

      {/* "All" leaves a single page — the buttons would have nowhere to go,
          but the rows-per-page control has to stay so it can be undone. */}
      {pageCount > 1 ? (
        <div className="pay-pager-pages">
          <button
            type="button"
            className="pay-page pay-page-step"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            <span aria-hidden="true">‹</span> Prev
          </button>

          {pageWindow(page, pageCount).map((p, i) =>
            p === null ? (
              <span
                key={`gap-${i}`}
                className="pay-pager-gap"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={`pay-page${p === page ? " is-current" : ""}`}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPage(p)}
              >
                {p}
              </button>
            ),
          )}

          <button
            type="button"
            className="pay-page pay-page-step"
            disabled={page >= pageCount}
            onClick={() => onPage(page + 1)}
          >
            Next <span aria-hidden="true">›</span>
          </button>
        </div>
      ) : null}

      {/* Reuses the filter bar's label + pill select, so the two rows of
          controls around the table read as the same kit. */}
      <label className="dir-filter pay-pager-size">
        <span className="dir-filter-label">Rows per page</span>
        <select
          className="dir-select"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          <option value={ALL_ROWS}>All</option>
        </select>
      </label>
    </nav>
  );
}
