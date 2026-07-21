"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { DIVISIONS, type DivisionSlug } from "../teams/divisions";
import { addFundraiserEntryAction } from "./actions";
import type { FundraiserOption, PlayerOption, TeamOption } from "./fundraisers";

// A Division → Team → Player selection used to seed a draft row (e.g. from the
// search bar). Ids are strings to match the <select> values.
export type DraftInitial = {
  division: DivisionSlug;
  teamId: string;
  playerId: string;
};

// Sentinel <option> value for a whole-team (team-based) entry, distinct from a
// real player id and from the empty "nothing picked yet" value.
const TEAM_LEVEL = "__team__";

// Today's date as YYYY-MM-DD in the browser's local time zone. Draft rows only
// ever render on the client (they appear after an "Add Entry" click), so this
// runs in the browser and cannot cause an SSR hydration mismatch.
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function EntryDraftRow({
  id,
  teams,
  players,
  fundraisers,
  initial,
  onRemove,
  onSaved,
}: {
  id: number;
  teams: TeamOption[];
  players: PlayerOption[];
  fundraisers: FundraiserOption[];
  initial?: DraftInitial;
  onRemove: (id: number) => void;
  onSaved: (id: number) => void;
}) {
  const [date, setDate] = useState<string>(() => todayISO());
  const [division, setDivision] = useState<DivisionSlug | "">(
    initial?.division ?? "",
  );
  const [teamId, setTeamId] = useState(initial?.teamId ?? "");
  const [playerId, setPlayerId] = useState(initial?.playerId ?? "");
  // Default to the only fundraiser when there's exactly one — a common case.
  const [fundraiserId, setFundraiserId] = useState(
    fundraisers.length === 1 ? String(fundraisers[0].id) : "",
  );
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // When the row is seeded from the search bar the player is already chosen, so
  // drop the user straight into the amount field and bring the row into view.
  const rowRef = useRef<HTMLTableRowElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!initial) return;
    amountRef.current?.focus();
    rowRef.current?.scrollIntoView({ block: "nearest" });
    // Seed once on mount; later prop changes shouldn't yank focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cascade: teams narrow to the chosen division, players to the chosen team.
  const teamsInDivision = division
    ? teams.filter((t) => t.division === division)
    : [];
  const teamIdNum = Number(teamId);
  const playersInTeam = teamId
    ? players.filter((p) => p.team_id === teamIdNum)
    : [];

  const amountValid =
    amount !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0;
  const canSave =
    date !== "" &&
    division !== "" &&
    teamId !== "" &&
    playerId !== "" &&
    fundraiserId !== "" &&
    amountValid;

  function save() {
    setError(null);
    // "Whole team" (the sentinel) logs a team-based entry with no player.
    const teamLevel = playerId === TEAM_LEVEL;
    startTransition(async () => {
      const res = await addFundraiserEntryAction({
        teamId,
        playerId: teamLevel ? "" : playerId,
        fundraiserId,
        raisedOn: date,
        amount,
      });
      if (res?.ok) onSaved(id);
      else setError(res?.error ?? "Could not save the entry.");
    });
  }

  return (
    <>
      <tr className="pay-draft-row" ref={rowRef}>
        <td>
          <input
            type="date"
            className="pay-input"
            value={date}
            aria-label="Date raised"
            onChange={(e) => setDate(e.target.value)}
          />
        </td>

        <td>
          <select
            className="pay-select"
            value={division}
            aria-label="Division"
            onChange={(e) => {
              setDivision(e.target.value as DivisionSlug | "");
              setTeamId("");
              setPlayerId("");
            }}
          >
            <option value="" disabled>
              Division…
            </option>
            {DIVISIONS.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.label}
              </option>
            ))}
          </select>
        </td>

        <td>
          <select
            className="pay-select"
            value={teamId}
            disabled={division === ""}
            aria-label="Team name"
            onChange={(e) => {
              setTeamId(e.target.value);
              setPlayerId("");
            }}
          >
            <option value="" disabled>
              {division === "" ? "Pick a division first" : "Team…"}
            </option>
            {teamsInDivision.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </td>

        <td>
          <select
            className="pay-select"
            value={playerId}
            disabled={teamId === ""}
            aria-label="Player or whole team"
            onChange={(e) => setPlayerId(e.target.value)}
          >
            <option value="" disabled>
              {teamId === "" ? "Pick a team first" : "Player or team…"}
            </option>
            {teamId !== "" ? (
              <option value={TEAM_LEVEL}>— Whole team —</option>
            ) : null}
            {playersInTeam.map((p) => (
              <option key={p.id} value={p.id}>
                {p.player_name}
              </option>
            ))}
          </select>
        </td>

        <td>
          <select
            className="pay-select"
            value={fundraiserId}
            aria-label="Fundraiser"
            onChange={(e) => setFundraiserId(e.target.value)}
          >
            <option value="" disabled>
              {fundraisers.length === 0 ? "No fundraisers yet" : "Fundraiser…"}
            </option>
            {fundraisers.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </td>

        <td className="pay-num">
          <input
            ref={amountRef}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className="pay-input pay-amount"
            value={amount}
            placeholder="0.00"
            aria-label="Amount raised"
            onChange={(e) => setAmount(e.target.value)}
          />
        </td>

        <td className="pay-num pay-draft-total" aria-hidden="true">
          —
        </td>

        <td className="col-actions">
          <div className="row-actions">
            <button
              type="button"
              className="row-save"
              onClick={save}
              disabled={!canSave || pending}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="row-delete"
              onClick={() => onRemove(id)}
              disabled={pending}
            >
              Remove
            </button>
          </div>
        </td>
      </tr>

      {error ? (
        <tr className="pay-error-row">
          <td colSpan={8}>
            <p className="error pay-error" role="alert">
              {error}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
