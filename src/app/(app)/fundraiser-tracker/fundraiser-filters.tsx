"use client";

import { useMemo } from "react";
import ExportButtons from "../export-buttons";
import { DIVISIONS } from "../teams/divisions";
import {
  NO_FUNDRAISER_FILTERS,
  fundraiserFilterParams,
  isFiltering,
  type FundraiserEntryRow,
  type FundraiserFilters as Filters,
  type FundraiserOption,
} from "./fundraisers";

// The filter bar over the log: which fundraiser, and which division. Both are
// client-side — every entry is already on the page, so narrowing is instant.
//
// The two dropdowns are driven by what's actually in the log — a fundraiser or
// division only shows up once some entry uses it, and only when there's more
// than one to choose between (a program running a single fundraiser doesn't
// need a Fundraiser filter) *or* when it's the one currently narrowing the log.
// That second case is what keeps the bar honest: deleting the last Softball
// entry while filtered to Softball leaves a filter that's still applied, and
// hiding its dropdown would leave no way to see or undo it.
//
// `filters` arrives already normalized against the log, so a value no entry can
// satisfy at all is never left silently applied either.
//
// The download links carry the same filters as query params, so a CSV, Excel
// file or PDF holds exactly the rows on screen.
export default function FundraiserFilters({
  entries,
  fundraisers,
  filters,
  onChange,
  shownCount,
}: {
  entries: FundraiserEntryRow[];
  fundraisers: FundraiserOption[];
  /** Normalized by the caller (see normalizeFundraiserFilters). */
  filters: Filters;
  onChange: (next: Filters) => void;
  /** How many entries the filters are currently showing. */
  shownCount: number;
}) {
  // Only the fundraisers something has actually been raised toward, in the
  // order the cards above list them — an empty campaign has no rows to show.
  const used = useMemo(() => {
    const ids = new Set(entries.map((e) => e.fundraiser_id));
    return fundraisers.filter((f) => ids.has(f.id));
  }, [entries, fundraisers]);

  const divisions = useMemo(() => {
    const slugs = new Set(entries.map((e) => e.division));
    return DIVISIONS.filter((d) => slugs.has(d.slug));
  }, [entries]);

  // Offer a control when it has a choice to make, and keep it on screen while
  // it's the one doing the narrowing. Normalization guarantees a set value is
  // one some entry still carries, so it's always among the options below.
  const showFundraisers = used.length > 1 || filters.fundraiser !== "";
  const showDivisions = divisions.length > 1 || filters.division !== "";

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value });
  }

  const exportParams = fundraiserFilterParams(filters);
  const exportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(exportParams);
    params.set("format", format);
    return `/fundraiser-tracker/export?${params.toString()}`;
  };
  const printQuery = exportParams.toString();
  const printHref =
    printQuery === ""
      ? "/fundraiser-tracker/print"
      : `/fundraiser-tracker/print?${printQuery}`;

  const filtering = isFiltering(filters);

  return (
    <div className="dir-filters fund-filters">
      {showFundraisers ? (
        <div className="dir-filter">
          <label className="dir-filter-label" htmlFor="fund-fundraiser-filter">
            Fundraiser
          </label>
          <select
            id="fund-fundraiser-filter"
            className="dir-select"
            value={filters.fundraiser}
            onChange={(e) => set("fundraiser", e.target.value)}
          >
            <option value="">All fundraisers</option>
            {used.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {showDivisions ? (
        <div className="dir-filter">
          <label className="dir-filter-label" htmlFor="fund-division-filter">
            Division
          </label>
          <select
            id="fund-division-filter"
            className="dir-select"
            value={filters.division}
            onChange={(e) => set("division", e.target.value)}
          >
            <option value="">All divisions</option>
            {divisions.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {/* The count only. What the shown entries add up to reads on the line
          beside "Add Entry", a few pixels below — saying it twice is noise. */}
      <span className="dir-count">
        {shownCount === entries.length
          ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`
          : `${shownCount} of ${entries.length} entries`}
        {filtering ? (
          <>
            {" · "}
            <button
              type="button"
              className="dir-clear-all"
              onClick={() => onChange(NO_FUNDRAISER_FILTERS)}
            >
              Clear filters
            </button>
          </>
        ) : null}
      </span>

      <ExportButtons
        href={exportHref}
        pdfHref={printHref}
        count={shownCount}
        nounPlural="entries"
      />
    </div>
  );
}
