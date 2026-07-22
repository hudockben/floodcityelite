"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { addCampPaymentAction } from "./actions";
import { PAYMENT_TYPES, type CampPlayerRow } from "./camps";

// Number of columns in the payments table (Date, Player, Type, Check #, Amount,
// Total, Actions) — used for the full-width error row's colSpan.
const COL_COUNT = 7;

// Today's date as YYYY-MM-DD in the browser's local time zone. Draft rows only
// ever render on the client (they appear after an "Add Payment" click), so this
// runs in the browser and cannot cause an SSR hydration mismatch.
function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function CampPaymentDraftRow({
  id,
  players,
  initialPlayerId,
  onRemove,
  onSaved,
}: {
  id: number;
  players: CampPlayerRow[];
  initialPlayerId?: string;
  onRemove: (id: number) => void;
  onSaved: (id: number) => void;
}) {
  const [date, setDate] = useState<string>(() => todayISO());
  const [playerId, setPlayerId] = useState(initialPlayerId ?? "");
  const [paymentType, setPaymentType] = useState("");
  const [checkNumber, setCheckNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // When the row is seeded from a roster row the player is already chosen, so
  // drop the user straight into the amount field and bring the row into view.
  const rowRef = useRef<HTMLTableRowElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!initialPlayerId) return;
    amountRef.current?.focus();
    rowRef.current?.scrollIntoView({ block: "nearest" });
    // Seed once on mount; later prop changes shouldn't yank focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amountValid =
    amount !== "" && Number.isFinite(Number(amount)) && Number(amount) >= 0;
  const canSave =
    date !== "" && playerId !== "" && paymentType !== "" && amountValid;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await addCampPaymentAction({
        campPlayerId: playerId,
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
      <tr className="pay-draft-row" ref={rowRef}>
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
            value={playerId}
            aria-label="Player name"
            onChange={(e) => setPlayerId(e.target.value)}
          >
            <option value="" disabled>
              {players.length === 0 ? "No players yet" : "Player…"}
            </option>
            {players.map((p) => (
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
            ref={amountRef}
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
          <td colSpan={COL_COUNT}>
            <p className="error pay-error" role="alert">
              {error}
            </p>
          </td>
        </tr>
      ) : null}
    </>
  );
}
