"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DIVISIONS } from "../teams/divisions";
import type { PlayerOption, TeamOption } from "./fundraisers";

// A player joined with its team and division label, plus the lowercased text we
// match against. Built once from the teams/players props.
export type PlayerMatch = {
  player: PlayerOption;
  team: TeamOption;
  divisionLabel: string;
};

function divisionLabel(slug: string): string {
  return DIVISIONS.find((d) => d.slug === slug)?.label ?? slug;
}

// Cap the dropdown so a broad query (e.g. a whole division) stays scannable.
const MAX_RESULTS = 8;

export default function FundraiserSearch({
  teams,
  players,
  onPick,
}: {
  teams: TeamOption[];
  players: PlayerOption[];
  onPick: (match: PlayerMatch) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Join each player to its team + division once. Players whose team is missing
  // (shouldn't happen given the query, but be defensive) are dropped.
  const catalog = useMemo<PlayerMatch[]>(() => {
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const out: PlayerMatch[] = [];
    for (const player of players) {
      const team = teamById.get(player.team_id);
      if (!team) continue;
      out.push({ player, team, divisionLabel: divisionLabel(team.division) });
    }
    return out;
  }, [teams, players]);

  // Match on player name, team name, or division label so typing any of the
  // three narrows to the right people.
  const results = useMemo<PlayerMatch[]>(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return [];
    const matches: PlayerMatch[] = [];
    for (const m of catalog) {
      if (
        m.player.player_name.toLowerCase().includes(q) ||
        m.team.name.toLowerCase().includes(q) ||
        m.divisionLabel.toLowerCase().includes(q)
      ) {
        matches.push(m);
        if (matches.length >= MAX_RESULTS) break;
      }
    }
    return matches;
  }, [query, catalog]);

  // Reset the highlight to the top whenever the result set changes.
  useEffect(() => {
    setActive(0);
  }, [results]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function pick(match: PlayerMatch) {
    onPick(match);
    // Reset so the field is ready for the next entry.
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      const match = results[active];
      if (match) {
        e.preventDefault();
        pick(match);
      }
    }
  }

  const showDropdown = open && query.trim() !== "";

  return (
    <div className="pay-search" ref={rootRef}>
      <div className="pay-search-field">
        <svg
          className="pay-search-icon"
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
          type="text"
          className="pay-search-input"
          placeholder="Search a player or team to log fundraising…"
          value={query}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="fund-search-list"
          aria-autocomplete="list"
          aria-activedescendant={
            showDropdown && results.length > 0
              ? `fund-search-opt-${active}`
              : undefined
          }
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query !== "" ? (
          <button
            type="button"
            className="pay-search-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setOpen(false);
            }}
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>

      {showDropdown ? (
        <ul className="pay-search-list" id="fund-search-list" role="listbox">
          {results.length === 0 ? (
            <li className="pay-search-empty" role="presentation">
              No players or teams match “{query.trim()}”.
            </li>
          ) : (
            results.map((m, i) => (
              <li
                key={m.player.id}
                id={`fund-search-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`pay-search-option${i === active ? " is-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                // Keep focus on the input during the click so the outside-click
                // handler doesn't fire before pick() runs.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m)}
              >
                <span className="pay-search-player">{m.player.player_name}</span>
                <span className="pay-search-meta">
                  {m.team.name} · {m.divisionLabel}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
