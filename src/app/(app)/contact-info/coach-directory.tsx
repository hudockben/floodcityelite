"use client";

import { useMemo, useState } from "react";
import { sportLabel } from "../teams/divisions";
import CoachRowItem from "./coach-row";
import {
  COACH_FIELDS,
  coachSearchText,
  coachValue,
  type CoachRow,
  type Sport,
} from "./coaches";

// The one sport's contact list: a search box and a division-level filter over a
// table of college coaches. Both filters are client-side — the whole list for
// the sport is already on the page, so narrowing it is instant.
export default function CoachDirectory({
  sport,
  coaches,
}: {
  sport: Sport;
  coaches: CoachRow[];
}) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");

  // Offer only the levels actually present in this sport's list, so the filter
  // can't land on an empty option.
  const levels = useMemo(() => {
    const found = new Set<string>();
    for (const coach of coaches) {
      const value = coachValue(coach, "division_level");
      if (value) found.add(value);
    }
    return [...found].sort((a, b) => a.localeCompare(b));
  }, [coaches]);

  // Everything on a contact, lowercased, so one box searches school, coach,
  // conference, level, city — whatever the coach remembers first.
  const searchText = useMemo(
    () => new Map(coaches.map((c) => [c.id, coachSearchText(c)])),
    [coaches],
  );

  // Removing the last school at a level (or editing its level away) drops that
  // option from the dropdown while it's still the selected one. Fall back to
  // "all levels" in that case, so the list can't sit silently empty behind a
  // filter the dropdown no longer shows.
  const activeLevel = levels.includes(level) ? level : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return coaches.filter((coach) => {
      if (activeLevel !== "" && coachValue(coach, "division_level") !== activeLevel) {
        return false;
      }
      if (q === "") return true;
      return (searchText.get(coach.id) ?? "").includes(q);
    });
  }, [coaches, query, activeLevel, searchText]);

  const filtering = query.trim() !== "" || activeLevel !== "";

  function clearFilters() {
    setQuery("");
    setLevel("");
  }

  if (coaches.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon" aria-hidden="true">
          🎓
        </div>
        <p className="empty-title">No {sportLabel(sport).toLowerCase()} coaches yet</p>
        <p className="empty-sub">
          Add a school above to start this list — school, coach, cell, email,
          website, level, and conference all live here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="coach-filters">
        <div className="coach-search">
          <svg
            className="coach-search-icon"
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
            className="coach-search-input"
            placeholder="Search school, coach, conference, city…"
            value={query}
            aria-label="Search contacts"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query !== "" ? (
            <button
              type="button"
              className="coach-search-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>

        {levels.length > 0 ? (
          <div className="coach-level-filter">
            <label className="coach-level-label" htmlFor="coach-level-filter">
              Division level
            </label>
            <select
              id="coach-level-filter"
              className="coach-select"
              value={activeLevel}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="">All levels</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <span className="coach-count">
          {filtered.length === coaches.length
            ? `${coaches.length} ${coaches.length === 1 ? "school" : "schools"}`
            : `${filtered.length} of ${coaches.length} schools`}
          {filtering ? (
            <>
              {" · "}
              <button type="button" className="coach-clear-all" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : null}
        </span>
      </div>

      <div className="coach-scroll">
        <table className="coach-table">
          <thead>
            <tr>
              {COACH_FIELDS.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={COACH_FIELDS.length + 1} className="coach-empty-row">
                  No contacts match these filters.{" "}
                  <button
                    type="button"
                    className="coach-clear-all"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            ) : (
              filtered.map((coach) => (
                <CoachRowItem key={coach.id} coach={coach} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
