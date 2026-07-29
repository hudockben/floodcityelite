"use client";

import { useMemo, useState } from "react";
import ExportButtons from "../export-buttons";
import { DIVISIONS, divisionLabel } from "../teams/divisions";
import { formatMoney } from "../schedules/events";
import HotelRowItem from "./hotel-row";
import {
  HOTEL_FIELDS,
  hotelSearchText,
  matchesHotelFilters,
  type HotelRow,
  type TournamentOption,
} from "./hotels";

// The travel list: a search box, a division filter, and a tournament filter
// over a table of hotels. All three are client-side — the whole list is already
// on the page, so narrowing it is instant.
//
// The filters are driven by what's actually in the list (only divisions and
// tournaments that some hotel uses are offered), and each falls back to "all"
// if its selected value disappears — otherwise deleting the last hotel at a
// tournament would leave the table empty behind a filter no longer shown.
export default function HotelDirectory({
  hotels,
  tournaments,
}: {
  hotels: HotelRow[];
  /** Every schedulable tournament — the row editor's dropdown offers these. */
  tournaments: TournamentOption[];
}) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("");
  const [tournament, setTournament] = useState("");

  const divisions = useMemo(() => {
    const used = new Set(hotels.map((h) => h.division).filter(Boolean));
    return DIVISIONS.filter((d) => used.has(d.slug));
  }, [hotels]);

  // Keyed by event id as a string (the <select> value); a stay whose tournament
  // was deleted keeps its snapshot name but can't be filtered on.
  const tournamentFilters = useMemo(() => {
    const found = new Map<string, string>();
    for (const h of hotels) {
      if (h.event_id != null && h.event_name) {
        found.set(String(h.event_id), h.event_name);
      }
    }
    return [...found].sort((a, b) => a[1].localeCompare(b[1]));
  }, [hotels]);

  const activeDivision = divisions.some((d) => d.slug === division) ? division : "";
  const activeTournament = tournamentFilters.some(([id]) => id === tournament)
    ? tournament
    : "";

  // Everything on a hotel, lowercased, so one box searches the hotel, the
  // tournament, the city — whatever comes to mind first.
  const searchText = useMemo(
    () =>
      new Map(
        hotels.map((h) => [
          h.id,
          hotelSearchText(h, h.division ? divisionLabel(h.division) : ""),
        ]),
      ),
    [hotels],
  );

  const filtered = useMemo(
    () =>
      hotels.filter((h) =>
        matchesHotelFilters(
          h,
          query,
          activeDivision,
          activeTournament,
          searchText.get(h.id),
        ),
      ),
    [hotels, query, activeDivision, activeTournament, searchText],
  );

  // The download carries the filters that are on screen, so the file holds the
  // rows the list is showing rather than the whole travel list.
  const exportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams({ format });
    if (query.trim() !== "") params.set("q", query.trim());
    if (activeDivision !== "") params.set("division", activeDivision);
    if (activeTournament !== "") params.set("tournament", activeTournament);
    return `/hotels/export?${params.toString()}`;
  };

  const filtering =
    query.trim() !== "" || activeDivision !== "" || activeTournament !== "";

  function clearFilters() {
    setQuery("");
    setDivision("");
    setTournament("");
  }

  // Average nightly rate across the hotels in view, over the ones that carry a
  // rate — a quick read on what a weekend costs per room.
  const rates = filtered
    .map((h) => Number(h.avg_cost_per_night))
    .filter((n) => Number.isFinite(n) && n > 0);
  const averageRate =
    rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

  if (hotels.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon" aria-hidden="true">
          🏨
        </div>
        <p className="empty-title">No hotels yet</p>
        <p className="empty-sub">
          Add one above to start the travel list — the tournament it&apos;s for,
          the address, the nightly rate, and the booking site all live here.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="dir-filters">
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
            placeholder="Search hotel, tournament, city…"
            value={query}
            aria-label="Search hotels"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query !== "" ? (
            <button
              type="button"
              className="dir-search-clear"
              aria-label="Clear search"
              onClick={() => setQuery("")}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>

        {divisions.length > 0 ? (
          <div className="dir-filter">
            <label className="dir-filter-label" htmlFor="hotel-division-filter">
              Division
            </label>
            <select
              id="hotel-division-filter"
              className="dir-select"
              value={activeDivision}
              onChange={(e) => setDivision(e.target.value)}
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

        {tournamentFilters.length > 0 ? (
          <div className="dir-filter">
            <label className="dir-filter-label" htmlFor="hotel-tournament-filter">
              Tournament
            </label>
            <select
              id="hotel-tournament-filter"
              className="dir-select"
              value={activeTournament}
              onChange={(e) => setTournament(e.target.value)}
            >
              <option value="">All tournaments</option>
              {tournamentFilters.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <span className="dir-count">
          {filtered.length === hotels.length
            ? `${hotels.length} ${hotels.length === 1 ? "hotel" : "hotels"}`
            : `${filtered.length} of ${hotels.length} hotels`}
          {averageRate != null ? ` · ${formatMoney(averageRate)} avg/night` : null}
          {filtering ? (
            <>
              {" · "}
              <button type="button" className="dir-clear-all" onClick={clearFilters}>
                Clear filters
              </button>
            </>
          ) : null}
        </span>

        <ExportButtons
          href={exportHref}
          count={filtered.length}
          nounPlural="hotels"
        />
      </div>

      <div className="dir-scroll">
        <table className="dir-table">
          <thead>
            <tr>
              <th>{HOTEL_FIELDS[0].label}</th>
              <th>Tournament</th>
              <th>Division</th>
              {HOTEL_FIELDS.slice(1).map((f) => (
                <th key={f.key} className={f.type === "money" ? "dir-num" : undefined}>
                  {f.label}
                </th>
              ))}
              <th className="col-actions">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={HOTEL_FIELDS.length + 3} className="dir-empty-row">
                  No hotels match these filters.{" "}
                  <button
                    type="button"
                    className="dir-clear-all"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            ) : (
              filtered.map((hotel) => (
                <HotelRowItem
                  key={hotel.id}
                  hotel={hotel}
                  tournaments={tournaments}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
