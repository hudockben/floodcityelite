"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { divisionLabel } from "../teams/divisions";
import { formatRosterDate } from "@/lib/roster-format";
import type { RosterSubmissionRow } from "@/lib/roster-submissions";
import ConfirmButton from "../teams/confirm-button";
import {
  handednessLabel,
  haystackOf,
  matchesSearchAndTeam,
  matchesStatus,
  teamKeyOf,
  teamNameOf,
  type StatusFilter,
} from "./submissions";

// The interactive Roster Submissions list: a broad text search plus status and
// team filters over the already-loaded responses. All filtering is client-side
// (the whole company's responses are a small set), so narrowing is instant and
// needs no round-trip. The server page owns loading + the delete action, which
// is threaded through as a prop.
//
// The filter predicates themselves live in ./submissions, shared with the
// export route so a downloaded file holds exactly what the screen showed.

// The labeled detail fields shown on a submission card, in display order. Empty
// values are dropped so a decline (which carries almost nothing) stays compact.
function detailFields(s: RosterSubmissionRow): { label: string; value: string }[] {
  const rows: { label: string; value: string | null }[] = [
    { label: "Email", value: s.email },
    { label: "Grad year", value: s.grad_year != null ? String(s.grad_year) : null },
    { label: "High school", value: s.high_school },
    { label: "Date of birth", value: s.date_of_birth ? formatRosterDate(s.date_of_birth) : null },
    { label: "Parent's name", value: s.parent_name },
    { label: "Parent's cell", value: s.parent_phone },
    { label: "Secondary cell", value: s.secondary_phone },
    { label: "Height", value: s.height },
    { label: "Weight", value: s.weight != null ? String(s.weight) : null },
    { label: "Bats", value: handednessLabel(s.bats) },
    { label: "Throws", value: handednessLabel(s.throws) },
    { label: "Primary position", value: s.primary_position },
    { label: "Secondary position", value: s.secondary_position },
    { label: "Returning jersey #", value: s.returning_jersey },
    { label: "Jersey option #1", value: s.jersey_option_1 },
    { label: "Jersey option #2", value: s.jersey_option_2 },
    { label: "Jersey option #3", value: s.jersey_option_3 },
    {
      label: "Played in 2026",
      value: s.played_fce_2026 == null ? null : s.played_fce_2026 ? "Yes" : "No",
    },
    { label: "Hat size", value: s.hat_size },
  ];
  return rows.filter((r): r is { label: string; value: string } => r.value != null && r.value !== "");
}

// A distinct team appearing across the submissions, for the team dropdown.
type TeamOption = { key: string; name: string; division: string | null; removed: boolean };

export default function SubmissionsList({
  submissions,
  deleteAction,
}: {
  submissions: RosterSubmissionRow[];
  deleteAction: (formData: FormData) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [team, setTeam] = useState("");
  // The search input is never conditionally unmounted, so it's a stable anchor
  // to return focus to when a "clear" control removes itself on activation.
  const searchRef = useRef<HTMLInputElement>(null);

  // Precompute a search haystack and team key for each submission once.
  const indexed = useMemo(
    () =>
      submissions.map((s) => ({
        s,
        haystack: haystackOf(s),
        teamKey: teamKeyOf(s),
      })),
    [submissions],
  );

  // Distinct teams present in the submissions, grouped by division for the
  // dropdown. Sorted by division label then team name.
  const teamOptions = useMemo<TeamOption[]>(() => {
    const map = new Map<string, TeamOption>();
    for (const s of submissions) {
      const key = teamKeyOf(s);
      if (!key || map.has(key)) continue;
      const name = teamNameOf(s);
      if (!name) continue;
      map.set(key, {
        key,
        name,
        division: s.current_division ?? s.division,
        // The chosen team no longer exists (deleted since the parent submitted).
        removed: s.current_team_name == null,
      });
    }
    return [...map.values()].sort((a, b) => {
      const da = a.division ? divisionLabel(a.division) : "";
      const db = b.division ? divisionLabel(b.division) : "";
      return da.localeCompare(db) || a.name.localeCompare(b.name);
    });
  }, [submissions]);

  // Self-heal a selected team that's no longer present (e.g. its last matching
  // submission was just deleted): fall back to "all teams".
  const effectiveTeam = team && teamOptions.some((o) => o.key === team) ? team : "";

  // Apply search + team first; the status counts and the visible list are both
  // derived from this base so the segment counts reflect the current search.
  const base = useMemo(
    () =>
      indexed.filter(({ haystack, teamKey }) =>
        matchesSearchAndTeam(query, effectiveTeam, haystack, teamKey),
      ),
    [indexed, query, effectiveTeam],
  );

  const acceptedCount = base.filter(({ s }) => s.accepted).length;
  const declinedCount = base.length - acceptedCount;

  const visible = base.filter(({ s }) => matchesStatus(s.accepted, status));

  const total = submissions.length;
  const filtersActive = query.trim() !== "" || status !== "all" || effectiveTeam !== "";

  function clearFilters() {
    setQuery("");
    setStatus("all");
    setTeam("");
    // The button that triggered this unmounts (filtersActive → false / results
    // reappear), so pull focus back to the always-present search box rather than
    // letting it fall to <body>.
    searchRef.current?.focus();
  }

  // The export downloads what's on screen: the same search, status, and team
  // ride along as query params, and the route re-applies them with the shared
  // predicates above.
  const exportHref = (format: "csv" | "xlsx") => {
    const params = new URLSearchParams({ format });
    if (query.trim() !== "") params.set("q", query.trim());
    if (status !== "all") params.set("status", status);
    if (effectiveTeam !== "") params.set("team", effectiveTeam);
    return `/roster-submissions/export?${params.toString()}`;
  };

  // Division heading for the currently-grouped team option, to render optgroups.
  const grouped = useMemo(() => {
    const groups: { label: string; options: TeamOption[] }[] = [];
    for (const opt of teamOptions) {
      const label = opt.division ? divisionLabel(opt.division) : "Other";
      let group = groups.find((g) => g.label === label);
      if (!group) {
        group = { label, options: [] };
        groups.push(group);
      }
      group.options.push(opt);
    }
    return groups;
  }, [teamOptions]);

  return (
    <>
      <div className="subs-controls">
        <div className="subs-search">
          <svg className="subs-search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
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
            ref={searchRef}
            type="text"
            className="subs-search-input"
            placeholder="Search by player, email, team, position…"
            value={query}
            aria-label="Search submissions"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query !== "" ? (
            <button
              type="button"
              className="subs-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                // This button unmounts once the query is empty; keep focus on
                // the input instead of dropping it to <body>.
                searchRef.current?.focus();
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          ) : null}
        </div>

        <div className="subs-filters">
          <div className="subs-segment" role="group" aria-label="Filter by status">
            <button
              type="button"
              className={`subs-seg-btn${status === "all" ? " is-active" : ""}`}
              aria-pressed={status === "all"}
              onClick={() => setStatus("all")}
            >
              All <span className="subs-seg-count">{base.length}</span>
            </button>
            <button
              type="button"
              className={`subs-seg-btn${status === "accepted" ? " is-active" : ""}`}
              aria-pressed={status === "accepted"}
              onClick={() => setStatus("accepted")}
            >
              Accepted <span className="subs-seg-count">{acceptedCount}</span>
            </button>
            <button
              type="button"
              className={`subs-seg-btn${status === "declined" ? " is-active" : ""}`}
              aria-pressed={status === "declined"}
              onClick={() => setStatus("declined")}
            >
              Declined <span className="subs-seg-count">{declinedCount}</span>
            </button>
          </div>

          {teamOptions.length > 0 ? (
            <label className="subs-team-filter">
              <span className="subs-team-label">Team</span>
              <select
                className="subs-team-select"
                value={effectiveTeam}
                onChange={(e) => setTeam(e.target.value)}
              >
                <option value="">All teams</option>
                {grouped.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.name}
                        {o.removed ? " (removed)" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : null}

          {/* Downloads the filtered set, not the whole table — the summary line
              below says how many rows that is. Plain links so the browser
              handles the file. */}
          <div className="subs-export">
            <a
              className="btn-secondary subs-export-btn"
              href={exportHref("csv")}
              download
            >
              ⬇ CSV
            </a>
            <a
              className="btn-secondary subs-export-btn"
              href={exportHref("xlsx")}
              download
            >
              ⬇ Excel
            </a>
          </div>
        </div>
      </div>

      {/* Concise, control-free live region so assistive tech hears the running
          count without re-reading the "Clear filters" button on every change. */}
      <span className="sr-only" role="status" aria-live="polite">
        Showing {visible.length} of {total} responses
      </span>

      <p className="muted-note subs-summary">
        Showing <strong>{visible.length}</strong>
        {visible.length !== total ? (
          <>
            {" "}
            of <strong>{total}</strong>
          </>
        ) : null}{" "}
        {total === 1 ? "response" : "responses"} ·{" "}
        <strong>{visible.filter(({ s }) => s.accepted).length}</strong> accepted ·{" "}
        <strong>{visible.filter(({ s }) => !s.accepted).length}</strong> declined
        {filtersActive ? (
          <>
            {" · "}
            <button type="button" className="subs-clear-all" onClick={clearFilters}>
              Clear filters
            </button>
          </>
        ) : null}
      </p>

      {visible.length === 0 ? (
        <div className="empty">
          <div className="empty-icon" aria-hidden="true">
            🔍
          </div>
          <p className="empty-title">No matching submissions</p>
          <p className="empty-sub">
            No responses match your search or filters.{" "}
            <button type="button" className="subs-clear-all" onClick={clearFilters}>
              Clear filters
            </button>{" "}
            to see them all.
          </p>
        </div>
      ) : (
        <div className="subs-list">
          {visible.map(({ s }) => {
            const details = detailFields(s);
            // Carry the team's season year so the #team anchor lands on the
            // season the team actually belongs to (which may be an archived
            // season), not whichever season is currently active. Linked for
            // declines too — the form asks which team's spot was turned down, so
            // the anchor points at the roster that just reopened.
            const teamLink =
              s.team_id != null && s.current_division
                ? `/teams?division=${s.current_division}${
                    s.current_season_year != null
                      ? `&year=${s.current_season_year}`
                      : ""
                  }#team-${s.team_id}`
                : null;
            const teamName = s.current_team_name ?? s.team_name;

            return (
              <article key={s.id} className="sub-card">
                <div className="sub-head">
                  <div className="sub-head-main">
                    <span
                      className={`sub-status ${
                        s.accepted ? "sub-status-accepted" : "sub-status-declined"
                      }`}
                    >
                      {s.accepted ? "Accepted" : "Declined"}
                    </span>
                    <span className="sub-name">{s.player_name}</span>
                  </div>
                  <div className="sub-head-side">
                    <span className="sub-meta">{formatRosterDate(s.created_at.slice(0, 10))}</span>
                    <ConfirmButton
                      action={deleteAction}
                      hidden={{ id: s.id }}
                      confirmText={`Delete ${s.player_name}'s roster response? (This won't remove the player from the roster.)`}
                      className="row-delete"
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </div>

                {/* The team line shows on declines too (the form requires it),
                    so the office can see which spot was turned down. Declines
                    predating that change carry no team — skip the line then. */}
                {s.accepted || teamName ? (
                  <p className="sub-team">
                    {s.accepted ? "Roster spot on" : "Declined a spot on"}{" "}
                    {teamLink ? (
                      <Link href={teamLink} className="sub-team-link">
                        {teamName}
                      </Link>
                    ) : (
                      <span className="sub-team-name">{teamName ?? "a team"}</span>
                    )}
                    {s.division ? (
                      <span className="sub-team-div">
                        {" "}
                        · {divisionLabel(s.current_division ?? s.division)}
                      </span>
                    ) : null}
                    {!teamLink && teamName ? (
                      <span className="sub-team-removed"> (team removed)</span>
                    ) : null}
                  </p>
                ) : null}

                {details.length > 0 ? (
                  <dl className="sub-grid">
                    {details.map((d) => (
                      <div key={d.label} className="sub-field">
                        <dt className="sub-field-label">{d.label}</dt>
                        <dd className="sub-field-value">{d.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="sub-empty-detail">No additional details provided.</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
