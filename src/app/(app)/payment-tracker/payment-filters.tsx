"use client";

import { useMemo } from "react";
import ExportButtons from "../export-buttons";
import { type Division } from "../teams/divisions";
import {
  NO_PAYMENT_FILTERS,
  PAYMENT_TYPES,
  isFiltering,
  paymentFilterParams,
  type PaymentFilters as Filters,
  type PaymentRow,
} from "./payments";

// The filter bar over the ledger: a search box that matches anything on a row,
// plus dropdowns for division and payment type, a check-# box, and a date
// range. All of it is client-side — every payment is already on the page, so
// narrowing is instant.
//
// The two dropdowns are driven by what's actually in the ledger — a division or
// payment type only shows up once some payment uses it, and only when there's
// more than one to choose between (a program that takes nothing but checks
// doesn't need a Type filter) *or* when it's the one currently narrowing the
// list. That second case is what keeps the bar honest: deleting the last
// Softball payment while filtered to Fall Baseball leaves a filter that's still
// applied, and hiding its dropdown would leave no way to see or undo it.
//
// `filters` arrives already normalized against the ledger, so a value no
// payment can satisfy at all is never left silently applied either.
//
// The download links carry the same filters as query params, so a CSV, Excel
// file or PDF holds exactly the rows on screen.
export default function PaymentFilters({
  payments,
  divisions: allDivisions,
  filters,
  onChange,
  shownCount,
}: {
  payments: PaymentRow[];
  /** The company's divisions; the dropdown offers the ones in the ledger. */
  divisions: Division[];
  /** Normalized by the caller (see normalizePaymentFilters). */
  filters: Filters;
  onChange: (next: Filters) => void;
  /** How many payments the filters are currently showing. */
  shownCount: number;
}) {
  const divisions = useMemo(() => {
    const used = new Set(payments.map((p) => p.division));
    return allDivisions.filter((d) => used.has(d.slug));
  }, [payments, allDivisions]);

  const types = useMemo(() => {
    const used = new Set(payments.map((p) => p.payment_type));
    return PAYMENT_TYPES.filter((t) => used.has(t.value));
  }, [payments]);

  const hasChecks = payments.some((p) => (p.check_number ?? "") !== "");

  // Offer a control when it has a choice to make, and keep it on screen while
  // it's the one doing the narrowing. Normalization guarantees a set value is
  // one some payment still carries, so it's always among the options below.
  const showDivisions = divisions.length > 1 || filters.division !== "";
  const showTypes = types.length > 1 || filters.paymentType !== "";
  const showChecks = hasChecks || filters.checkNumber.trim() !== "";

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value });
  }

  const exportParams = paymentFilterParams(filters);
  const exportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams(exportParams);
    params.set("format", format);
    return `/payment-tracker/export?${params.toString()}`;
  };
  const printQuery = exportParams.toString();
  const printHref =
    printQuery === ""
      ? "/payment-tracker/print"
      : `/payment-tracker/print?${printQuery}`;

  const filtering = isFiltering(filters);

  return (
    <div className="dir-filters pay-filters">
      <div className="dir-search">
        <svg
          className="dir-search-icon"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" />
          <line
            x1="14.5"
            y1="14.5"
            x2="18"
            y2="18"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <input
          type="search"
          className="dir-search-input"
          placeholder="Filter by player, team, check #, amount…"
          value={filters.query}
          aria-label="Filter payments"
          autoComplete="off"
          onChange={(e) => set("query", e.target.value)}
        />
        {filters.query !== "" ? (
          <button
            type="button"
            className="dir-search-clear"
            aria-label="Clear the payment filter"
            onClick={() => set("query", "")}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>

      {showDivisions ? (
        <div className="dir-filter">
          <label className="dir-filter-label" htmlFor="pay-division-filter">
            Division
          </label>
          <select
            id="pay-division-filter"
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

      {showTypes ? (
        <div className="dir-filter">
          <label className="dir-filter-label" htmlFor="pay-type-filter">
            Type
          </label>
          <select
            id="pay-type-filter"
            className="dir-select"
            value={filters.paymentType}
            onChange={(e) => set("paymentType", e.target.value)}
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {showChecks ? (
        <div className="dir-filter">
          <label className="dir-filter-label" htmlFor="pay-check-filter">
            Check #
          </label>
          <input
            id="pay-check-filter"
            type="text"
            inputMode="numeric"
            className="dir-input pay-check-input"
            placeholder="Any"
            value={filters.checkNumber}
            autoComplete="off"
            onChange={(e) => set("checkNumber", e.target.value)}
          />
        </div>
      ) : null}

      <div className="dir-filter">
        {/* Not a <label>: it heads two inputs, and each carries its own. */}
        <span className="dir-filter-label">Dates</span>
        {/* Each bound caps the other so the picker can't offer a range that
            reads backwards and would show nothing. */}
        <input
          type="date"
          className="dir-input dir-date"
          value={filters.from}
          max={filters.to || undefined}
          aria-label="Payments on or after"
          onChange={(e) => set("from", e.target.value)}
        />
        <span className="dir-range-sep" aria-hidden="true">
          –
        </span>
        <input
          type="date"
          className="dir-input dir-date"
          value={filters.to}
          min={filters.from || undefined}
          aria-label="Payments on or before"
          onChange={(e) => set("to", e.target.value)}
        />
      </div>

      <span className="dir-count">
        {shownCount === payments.length
          ? `${payments.length} ${payments.length === 1 ? "payment" : "payments"}`
          : `${shownCount} of ${payments.length} payments`}
        {filtering ? (
          <>
            {" · "}
            <button
              type="button"
              className="dir-clear-all"
              onClick={() => onChange(NO_PAYMENT_FILTERS)}
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
        nounPlural="payments"
      />
    </div>
  );
}
