"use client";

import { useState, useTransition } from "react";
import { DIVISIONS, type DivisionSlug } from "../teams/divisions";
import { addPaymentAction } from "./actions";
import {
  PAYMENT_TYPES,
  type PlayerOption,
  type TeamOption,
} from "./payments";

// Today's date as YYYY-MM-DD in the browser's local time zone. Draft rows only
// ever render on the client (they appear after an "Add Payment" click), so this
// runs in the browser and cannot cause an SSR hydration mismatch.
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function PaymentDraftRow({
  id,
  teams,
  players,
  onRemove,
  onSaved,
}: {
  id: number;
  teams: TeamOption[];
  players: PlayerOption[];
  onRemove: (id: number) => void;
  onSaved: (id: number) => void;
}) {
  const [date, setDate] = useState<string>(() => todayISO());
  const [division, setDivision] = useState<DivisionSlug | "">("");
  const [teamId, setTeamId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [paymentType, setPaymentType] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
    paymentType !== "" &&
    amountValid;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await addPaymentAction({
        playerId,
        paidOn: date,
        paymentType,
        checkNumber,
        amount,
      });
      if (res?.ok) onSaved(id);
      else setError(res?.error ?? "Could not save the payment.");
    });
  }

  return (
    <>
      <tr className="pay-draft-row">
        <td>
          <input
            type="date"
            className="pay-input"
            value={date}
            aria-label="Payment date"
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
            aria-label="Player name"
            onChange={(e) => setPlayerId(e.target.value)}
          >
            <option value="" disabled>
              {teamId === ""
                ? "Pick a team first"
                : playersInTeam.length === 0
                  ? "No players on this team"
                  : "Player…"}
            </option>
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
            value={paymentType}
            aria-label="Payment type"
            onChange={(e) => {
              const next = e.target.value;
              setPaymentType(next);
              // A check number only applies to checks — clear it for cash.
              if (next !== "check") setCheckNumber("");
            }}
          >
            <option value="" disabled>
              Type…
            </option>
            {PAYMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </td>

        <td>
          <input
            type="text"
            inputMode="numeric"
            className="pay-input"
            value={checkNumber}
            placeholder={paymentType === "check" ? "e.g. 1024" : "—"}
            aria-label="Check number"
            disabled={paymentType !== "check"}
            maxLength={32}
            onChange={(e) => setCheckNumber(e.target.value)}
          />
        </td>

        <td className="pay-num">
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            className="pay-input pay-amount"
            value={amount}
            placeholder="0.00"
            aria-label="Amount"
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
          <td colSpan={9}>
            <p className="error pay-error" role="alert">
              {error}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
