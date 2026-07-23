"use client";

import { useEffect, useState } from "react";
import { togglePlayerPayingAction } from "./actions";

// The inline "Paying" checkbox shown in each roster row. Ticking or clearing it
// submits the (void) server action immediately; local state gives instant
// feedback while the page — and the linked paying-player count on the Budgets
// tab — revalidate. Mirrors the Budgets tab's inline ExpenseStatusSelect.
export default function PayingToggle({
  playerId,
  playerName,
  value,
}: {
  playerId: number;
  playerName: string;
  value: boolean;
}) {
  const [paying, setPaying] = useState(value);

  // Keep the checkbox in sync if the server value changes underneath us (e.g.
  // after editing the row or a revalidation).
  useEffect(() => {
    setPaying(value);
  }, [value]);

  return (
    <form action={togglePlayerPayingAction} className="paying-form">
      <input type="hidden" name="playerId" value={playerId} />
      <label className="paying-toggle">
        <input
          type="checkbox"
          name="is_paying"
          value="true"
          className="paying-checkbox"
          checked={paying}
          aria-label={`${playerName} — ${paying ? "Paying" : "Not paying"}`}
          onChange={(e) => {
            setPaying(e.currentTarget.checked);
            e.currentTarget.form?.requestSubmit();
          }}
        />
        <span className="paying-pill">{paying ? "Paying" : "Not paying"}</span>
      </label>
    </form>
  );
}
