"use client";

import { useActionState } from "react";
import { savePlayerCountAction, type FormState } from "./actions";

const initialState: FormState = {};

// The divisor: how many players the fixed cost is split across. Left blank it
// follows the rosters (players marked Paying on the active seasons' teams), the
// same way the Budgets tab's paying-player field does — type a number to pin it
// instead, e.g. when you're budgeting for a roster you haven't finished filling.
export default function PlayerCountForm({
  override,
  rosterCount,
}: {
  override: number | null;
  rosterCount: number;
}) {
  const [state, formAction, pending] = useActionState(
    savePlayerCountAction,
    initialState,
  );

  return (
    <form action={formAction} className="fx-count-form">
      <label className="fx-count-label" htmlFor="fx-player-count">
        Players
      </label>
      <input
        id="fx-player-count"
        name="player_count"
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        className="fx-input fx-input-count"
        defaultValue={override == null ? "" : String(override)}
        placeholder={String(rosterCount)}
        aria-label="Number of players to split the fixed cost across (leave blank to use the rosters)"
      />
      <button type="submit" className="row-save" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.error ? (
        <p className="error fx-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
